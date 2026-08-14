import {
  connectStorageEmulator,
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
  uploadBytesResumable,
  uploadString,
  type FirebaseStorage,
  type UploadTask,
} from 'firebase/storage'

import { firebaseApp } from './app'
import { useEmulators } from './config'

export const storage: FirebaseStorage = getStorage(firebaseApp)

if (useEmulators) {
  connectStorageEmulator(storage, '127.0.0.1', 9199)
}

/** What we allow onto the board. Enforced again in storage.rules. */
export const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024 // 15 MB

export type AttachmentKind = 'image' | 'pdf'

export type Attachment = {
  /** Storage path, used for deletion. */
  path: string
  /** Long-lived download URL, stored so viewers need no extra round trip. */
  url: string
  name: string
  kind: AttachmentKind
  contentType: string
  size: number
}

export function kindOf(contentType: string): AttachmentKind | null {
  if (contentType === 'application/pdf') return 'pdf'
  if (contentType.startsWith('image/')) return 'image'
  return null
}

export type UploadHandle = {
  task: UploadTask
  /** Resolves once the file is stored and its URL is known. */
  done: Promise<Attachment>
}

/**
 * Upload one file, reporting progress.
 *
 * Resumable rather than one-shot: race-day uploads happen on unreliable mobile
 * data, and a resumable session survives a dropped connection instead of
 * restarting a 15 MB course map from zero.
 *
 * Unlike Firestore writes, this genuinely requires connectivity -- Storage has
 * no offline write queue. Callers must handle failure while offline.
 */
export function uploadAttachment(file: File, folder = 'notices'): UploadHandle {
  const kind = kindOf(file.type)
  if (!kind) {
    throw new Error(`Unsupported file type: ${file.type || 'unknown'}`)
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`)
  }

  // Prefix with a timestamp so two marshals uploading "map.pdf" do not collide.
  const safeName = file.name.replace(/[^\w.-]+/g, '_')
  const path = `${folder}/${Date.now()}-${safeName}`
  const objectRef = ref(storage, path)

  const task = uploadBytesResumable(objectRef, file, {
    contentType: file.type,
    // Attachments are immutable once written, so let clients cache hard.
    cacheControl: 'public, max-age=31536000, immutable',
  })

  // Built from the event callbacks rather than `await task`: UploadTask is a
  // custom thenable whose `then` is typed as returning unknown, and subscribing
  // here leaves `task` free for the caller to attach its own progress handler.
  const done = new Promise<Attachment>((resolve, reject) => {
    task.on(
      'state_changed',
      undefined,
      reject,
      () => {
        getDownloadURL(task.snapshot.ref)
          .then((url) =>
            resolve({
              path,
              url,
              name: file.name,
              kind,
              contentType: file.type,
              size: file.size,
            }),
          )
          .catch(reject)
      },
    )
  })

  return { task, done }
}

/**
 * Upload raw bytes or a data URL to an exact path, returning that path.
 *
 * Used for generated artefacts -- signatures and entry PDFs -- which differ
 * from uploadAttachment in three ways: the caller chooses the path (so a resave
 * overwrites rather than accumulating), no download URL is produced (these live
 * behind admin-only rules and are fetched through the SDK), and the input is
 * generated rather than user-picked so the MIME allow-list does not apply.
 */
export async function uploadDataUrl(
  data: string | Uint8Array,
  path: string,
  contentType: string,
): Promise<string> {
  const objectRef = ref(storage, path)

  if (typeof data === 'string') {
    await uploadString(objectRef, data, 'data_url')
  } else {
    // Copied into a fresh ArrayBuffer: a Uint8Array view over a larger buffer
    // would upload the whole buffer, not just the view.
    await uploadBytes(objectRef, new Uint8Array(data).buffer as ArrayBuffer, { contentType })
  }

  return path
}

export function deleteAttachment(path: string): Promise<void> {
  return deleteObject(ref(storage, path))
}

/**
 * Force a download rather than a navigation.
 *
 * Fetching to a blob keeps the user inside the app -- pointing an anchor at the
 * Storage URL makes mobile browsers navigate away, losing the board.
 */
export async function downloadAttachment(attachment: Attachment): Promise<void> {
  const response = await fetch(attachment.url)
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`)

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = attachment.name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
