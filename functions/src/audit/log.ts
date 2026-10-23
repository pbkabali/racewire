import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { logger } from 'firebase-functions'

/**
 * Collections under an event that are not worth auditing.
 *
 * `auditLog` above all: auditing the audit would recurse forever. The other
 * two are machine-written at volume -- notification delivery rows are already
 * their own record, and a licence import writes a document per competitor, so
 * logging those would bury every human action under three hundred rows nobody
 * asked about.
 */
const IGNORED = new Set(['auditLog', 'notifications', 'licences'])

/** Fields that change on every write and say nothing about intent. */
const NOISE = new Set(['updatedAt', 'uploadedAt', 'createdAt', 'sentAt', 'fingerprint'])

/**
 * The field that best says which record this is, per collection.
 *
 * A log reading "updated a document" is almost useless at a stewards'
 * hearing; "updated Bulletin 3" is the whole point.
 */
const LABEL: Record<string, string[]> = {
  notices: ['title'],
  documents: ['documentNumber', 'name'],
  folders: ['name'],
  schedule: ['activity'],
  entries: ['licenceNumber'],
  contacts: ['name'],
  races: ['name'],
}

/*
 * uid -> email, for the life of this instance.
 *
 * An audit row naming a uid is technically complete and practically useless;
 * an organiser reading it knows people by their address. Cached because
 * instances are reused and the same handful of admins act over and over.
 */
const emails = new Map<string, string>()

async function emailFor(uid: string): Promise<string> {
  const known = emails.get(uid)
  if (known !== undefined) return known

  try {
    const user = await getAuth().getUser(uid)
    const email = user.email ?? ''
    emails.set(uid, email)
    return email
  } catch {
    // Deleted account, or a uid from another project after a data copy.
    emails.set(uid, '')
    return ''
  }
}

function describe(collectionId: string, data: Record<string, unknown> | undefined): string {
  if (!data) return ''
  const fields = LABEL[collectionId] ?? ['name', 'title']
  return fields
    .map((field) => String(data[field] ?? '').trim())
    .filter(Boolean)
    .join(' · ')
}

/** Top-level fields whose value differs, ignoring the ones that always do. */
function changedFields(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): string[] {
  if (!before || !after) return []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []

  for (const key of keys) {
    if (NOISE.has(key)) continue
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key)
  }

  // A rewritten entry form can differ in eighty fields; the list is a hint
  // about what was touched, not a diff.
  return changed.sort().slice(0, 20)
}

export type AuditInput = {
  eventId: string
  collectionId: string
  documentId: string
  /** The signed-in user who made the write, from the trigger's auth context. */
  authId: string | undefined
  authType: string | undefined
  before: Record<string, unknown> | undefined
  after: Record<string, unknown> | undefined
}

/**
 * Record one admin action, if it is one.
 *
 * Written from a trigger rather than by the client that made the change: an
 * audit row a client could write is one it could also forge or omit, and the
 * whole value of this is that it cannot be. The trade is that it records what
 * Firestore saw, not what the admin screen intended -- so a bulk action shows
 * up as its individual writes.
 */
export function shouldRecord(input: AuditInput): boolean {
  const { collectionId, authId, before, after } = input

  // Auditing the audit would recurse; the other two are machine-written bulk.
  if (IGNORED.has(collectionId)) return false

  /*
   * No signed-in actor means the Admin SDK wrote it -- a Cloud Function or a
   * script, which bypasses rules and carries no user. The entry list rebuild
   * and every notification row land here, and none of them is an admin
   * deciding anything.
   */
  if (!authId) return false

  /*
   * An entry written by the competitor filling it is not an admin action, and
   * a draft is saved over and over while somebody types. Comparing the actor
   * against the entry's own uid separates the two exactly, with no claim
   * lookup: an organiser editing or deleting an entry is never its filer.
   */
  if (collectionId === 'entries' && (before?.uid === authId || after?.uid === authId)) {
    return false
  }

  // A write that changed nothing worth naming -- a touched timestamp alone.
  if (before && after && changedFields(before, after).length === 0) return false

  return true
}

export async function recordAudit(input: AuditInput): Promise<void> {
  const { eventId, collectionId, documentId, authId, authType, before, after } = input

  if (!shouldRecord(input)) return

  const action = !before ? 'create' : !after ? 'delete' : 'update'

  try {
    await getFirestore()
      .collection('events')
      .doc(eventId)
      .collection('auditLog')
      .add({
        at: FieldValue.serverTimestamp(),
        uid: authId as string,
        email: await emailFor(authId as string),
        authType: authType ?? 'unknown',
        action,
        collection: collectionId,
        documentId,
        // Taken from `before` on a delete: after is gone, and what was
        // removed is the only interesting thing about a deletion.
        summary: describe(collectionId, after ?? before),
        changed: action === 'update' ? changedFields(before, after) : [],
      })
  } catch (cause) {
    // Never rethrown. A retry would re-run the same write and duplicate the
    // row, and a missing audit entry must not break the action it describes.
    logger.error('audit write failed', {
      eventId,
      collectionId,
      documentId,
      error: cause instanceof Error ? cause.message : String(cause),
    })
  }
}
