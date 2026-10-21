import { createHash, randomUUID } from 'node:crypto'

import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { logger } from 'firebase-functions'

import { renderEntryListPdf, type EntryListLogo } from './pdf.js'
import { buildRows } from './rows.js'

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
 * Fetch the event's logo, ready to embed.
 *
 * Read through the Admin SDK by storage path rather than over HTTP from
 * logoUrl: the bytes are wanted, not a web request, and a download token that
 * has been rotated would turn a working logo into a silent 403.
 *
 * Format is sniffed from the file itself rather than trusted from metadata,
 * because PDF carries only PNG and JPEG while Storage rules accept any
 * image/*. An SVG or WebP logo uploads perfectly well and simply cannot go in
 * -- so it is skipped, loudly in the log and invisibly on the page.
 */
async function loadLogo(logoPath: string | undefined): Promise<EntryListLogo | null> {
  if (!logoPath) return null

  try {
    const [bytes] = await getStorage().bucket().file(logoPath).download()

    if (bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50) {
      return { bytes, format: 'png' }
    }
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      return { bytes, format: 'jpg' }
    }

    logger.warn('event logo is not a PNG or JPEG, so it is left off the entry list', {
      logoPath,
    })
    return null
  } catch (cause) {
    // A missing logo must never cost the list. The organiser gets a plain
    // heading and a log line, not an empty Lists folder.
    logger.warn('could not read the event logo', {
      logoPath,
      error: cause instanceof Error ? cause.message : String(cause),
    })
    return null
  }
}

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
  const event = eventSnap.data() ?? {}
  const eventName = (event.name as string) ?? eventCode
  const logoPath = (event.logoPath as string | undefined) ?? ''

  const documentRef = db
    .collection('events')
    .doc(eventCode)
    .collection('documents')
    .doc(DOCUMENT_ID)

  const [rows, current] = await Promise.all([buildRows(eventCode), documentRef.get()])

  /*
   * Hash of everything that reaches the page, which now includes which logo
   * is on it. Rows alone would mean swapping the event logo left the list
   * looking current and reporting "already up to date" while still carrying
   * the old badge -- a change that silently does nothing is worse than one
   * that visibly costs a rebuild.
   *
   * This is also what stops the list being rebuilt constantly: every keystroke
   * on a half-filled form writes the entry document, and comparing rendered
   * content means a rebuild happens only when the page would actually differ.
   */
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ rows, logoPath }))
    .digest('hex')

  /*
   * The cheap exit, and the one that matters most. Entries are written on
   * every autosave while somebody fills the form, and almost none of those
   * writes change a line of this list.
   */
  if (current.exists && current.data()?.fingerprint === fingerprint) {
    return { rebuilt: false, entries: rows.length }
  }

  const generatedAt = new Date()
  const pdf = await renderEntryListPdf({
    rows,
    eventName,
    eventCode,
    generatedAt,
    logo: await loadLogo(logoPath),
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
      notes: `Generated automatically - ${rows.length} ${
        rows.length === 1 ? 'entry' : 'entries'
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
      fingerprint,
    },
    { merge: true },
  )

  logger.info('entry list published', {
    eventCode,
    entries: rows.length,
    bytes: body.length,
  })
  return { rebuilt: true, entries: rows.length }
}
