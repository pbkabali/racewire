import { downloadAttachment, formatBytes } from '../../lib/firebase/storage'
import type { EventDocument } from '../events/types'
import { toAttachment } from './toAttachment'

export function DocumentRow({
  document,
  onOpen,
}: {
  document: EventDocument
  onOpen: (document: EventDocument) => void
}) {
  const isPdf = document.contentType === 'application/pdf'

  return (
    <li className="flex items-center gap-3 border-b border-edge px-3 py-3 last:border-b-0">
      <span
        aria-hidden
        className={`flex-none rounded px-1.5 py-0.5 text-[10px] font-bold ${
          isPdf ? 'bg-danger text-danger-fg' : 'bg-surface-raised text-fg'
        }`}
      >
        {isPdf ? 'PDF' : 'IMG'}
      </span>

      <button
        type="button"
        onClick={() => onOpen(document)}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex items-baseline gap-2">
          {document.documentNumber && (
            <span className="flex-none font-mono text-xs text-accent-text">
              {document.documentNumber}
            </span>
          )}
          <span className="truncate text-sm font-semibold text-fg">{document.name}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-fg-subtle">
          {formatDocumentDate(document)} · {formatBytes(document.size)}
          {document.notes ? ` · ${document.notes}` : ''}
        </span>
      </button>

      <button
        type="button"
        onClick={() => void downloadAttachment(toAttachment(document))}
        className="flex-none rounded border border-edge px-2 py-1 text-xs font-semibold text-fg"
      >
        Download
      </button>
    </li>
  )
}

function formatDocumentDate(document: EventDocument): string {
  const stamp = document.documentDate ?? document.uploadedAt
  if (!stamp) return 'Date pending'
  return stamp.toDate().toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
