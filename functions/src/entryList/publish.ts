import { randomUUID } from 'node:crypto'

import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { logger } from 'firebase-functions'

import { renderEntryListPdf } from './pdf.js'
import { buildSnapshot } from './rows.js'

/** Folder the organiser asked for it to appear under. Matched case-insensitively. */
const FOLDER_NAME = 'Lists'

/*
 * Fixed ids, not generated ones.
 *
 * The document and the file are replaced in place on every rebuild, so the
 * list has one identity for the life of the event: one row in the library that
 * updates, rather than a new "Entry List" appearing beside the last one every
 * time somebody enters. It also means a link shared a month ago still resolves
 * to the current list.
 */
const DOCUMENT_ID = 'entry-list'
const FILE_NAME = 'entry-list.pdf'

/**
 * Find the Lists folder, or make one.
 *
 * Created if absent rather than failing, because the feature has to work on an
 * event nobody has set folders up on yet. Matched on name rather than a fixed
 * id so it adopts the folder an organiser already made and called Lists,
 * instead of creating a second one alongside it.
 */
async function resolveFolderId(eventCode: string): Promise<string> {
  const folders = getFirestore().collection('events').doc(eventCode).collection('folders')
  const existing = await folders.get()

  const match = existing.docs.find(
    (document) =>
      String(document.data().name ?? '').trim().toLowerCase() === FOLDER_NAME.toLowerCase(),
  )
  if (match) return match.id

  const position =
    existing.docs.reduce((highest, document) => {
      const value = Number(document.data().position ?? 0)
      return Number.isFinite(value) && value > highest ? value : highest
    }, -1) + 1

  const created = await folders.add({
    name: FOLDER_NAME,
    position,
    createdAt: FieldValue.serverTimestamp(),
  })
  logger.info('created Lists folder', { eventCode, folderId: created.id })
  return created.id
}

export type PublishResult = {
  /** False when the list was already current and nothing was written. */
  rebuilt: boolean
  /** Entries on the list as it now stands, rebuilt or not. */
  entries: number
}

/**
 * Rebuild the entry list and publish it, unless nothing on the page changed.
 */
export async function publishEntryList(eventCode: string): Promise<PublishResult> {
  const db = getFirestore()

  const eventSnap = await db.collection('events').doc(eventCode).get()
  if (!eventSnap.exists) {
    logger.warn('entry list skipped: no such event', { eventCode })
    return { rebuilt: false, entries: 0 }
  }
  const eventName = (eventSnap.data()?.name as string) ?? eventCode

  const documentRef = db
    .collection('events')
    .doc(eventCode)
    .collection('documents')
    .doc(DOCUMENT_ID)

  const [snapshot, current] = await Promise.all([buildSnapshot(eventCode), documentRef.get()])

  /*
   * The cheap exit, and the one that matters most. Entries are written on
   * every autosave while somebody fills the form, and almost none of those
   * writes change a line of this list.
   */
  if (current.exists && current.data()?.fingerprint === snapshot.fingerprint) {
    return { rebuilt: false, entries: snapshot.rows.length }
  }

  const generatedAt = new Date()
  const pdf = await renderEntryListPdf({
    rows: snapshot.rows,
    eventName,
    eventCode,
    generatedAt,
  })

  const bucket = getStorage().bucket()
  const filePath = `events/${eventCode}/documents/${FILE_NAME}`
  const file = bucket.file(filePath)

  /*
   * Keep whatever download token the file already has. A new token on every
   * rebuild would invalidate the URL in every copy of the link anyone has
   * already shared, which for a document that updates daily is most of them.
   */
  // Typed explicitly: randomUUID() returns a template-literal type that an
  // existing token read back from metadata cannot be assigned to.
  let token: string = randomUUID()
  if (current.exists) {
    const [metadata] = await file.getMetadata().catch(() => [null])
    const existing = metadata?.metadata?.firebaseStorageDownloadTokens
    if (typeof existing === 'string' && existing) token = existing.split(',')[0] ?? token
  }

  const body = Buffer.from(pdf)
  await file.save(body, {
    contentType: 'application/pdf',
    metadata: {
      // Updates land within the minute rather than after an hour of CDN cache.
      cacheControl: 'public, max-age=60',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  })

  const fileUrl =
    `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
    `${encodeURIComponent(filePath)}?alt=media&token=${token}`

  await documentRef.set(
    {
      name: 'Entry List',
      // Left blank: the organiser's numbering is theirs to assign, and a
      // generated document claiming "001" would collide with it.
      documentNumber: '',
      documentDate: Timestamp.fromDate(generatedAt),
      folderId: await resolveFolderId(eventCode),
      notes: `Generated automatically - ${snapshot.rows.length} ${
        snapshot.rows.length === 1 ? 'entry' : 'entries'
      }`,
      formType: null,

      fileName: FILE_NAME,
      fileUrl,
      filePath,
      contentType: 'application/pdf',
      size: body.length,

      uploadedAt: FieldValue.serverTimestamp(),
      uploadedBy: null,

      /*
       * Flags for anything that needs to treat this differently from a
       * document a person uploaded -- notably a publish notification, which
       * must not fire every time an entry arrives.
       */
      autoGenerated: true,
      fingerprint: snapshot.fingerprint,
    },
    { merge: true },
  )

  logger.info('entry list published', {
    eventCode,
    entries: snapshot.rows.length,
    bytes: body.length,
  })
  return { rebuilt: true, entries: snapshot.rows.length }
}
