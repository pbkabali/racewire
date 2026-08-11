import type { Attachment } from '../../lib/firebase/storage'
import type { EventDocument } from '../events/types'

/**
 * Adapts a stored document to the shape the shared viewer and download helpers
 * take, so documents reuse the same PDF/image viewer as notice attachments.
 *
 * Its own module so DocumentRow.tsx exports only a component, which is what
 * React Fast Refresh needs to hot-reload it.
 */
export function toAttachment(document: EventDocument): Attachment {
  return {
    path: document.filePath,
    url: document.fileUrl,
    name: document.fileName,
    kind: document.contentType === 'application/pdf' ? 'pdf' : 'image',
    contentType: document.contentType,
    size: document.size,
  }
}
