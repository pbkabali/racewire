import { useState } from 'react'

import { formatBytes, type Attachment } from '../../lib/firebase/storage'
import { AttachmentViewer } from './AttachmentViewer'

/** Attachment strip under a notice: image thumbnails, PDFs as rows. */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null)

  if (!attachments.length) return null

  const images = attachments.filter((a) => a.kind === 'image')
  const files = attachments.filter((a) => a.kind !== 'image')

  return (
    <>
      {images.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((attachment) => (
            <li key={attachment.path}>
              <button
                type="button"
                onClick={() => setOpen(attachment)}
                className="block w-full overflow-hidden rounded border border-edge"
              >
                <img
                  src={attachment.url}
                  alt={attachment.name}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map((attachment) => (
            <li key={attachment.path}>
              <button
                type="button"
                onClick={() => setOpen(attachment)}
                className="flex w-full items-center gap-3 rounded border border-edge px-3 py-2 text-left"
              >
                <span
                  aria-hidden
                  className="rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold text-danger-fg"
                >
                  PDF
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{attachment.name}</span>
                <span className="text-xs text-fg-subtle">{formatBytes(attachment.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && <AttachmentViewer attachment={open} onClose={() => setOpen(null)} />}
    </>
  )
}
