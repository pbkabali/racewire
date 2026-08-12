import { Link } from 'react-router-dom'

import { downloadAttachment, formatBytes } from '../../lib/firebase/storage'
import { getFormDefinition } from '../forms/rallyEntry'
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
  const form = getFormDefinition(document.formType)

  return (
    <li className="group flex items-center gap-3 border-b border-edge px-3 py-3 transition-colors last:border-b-0 hover:bg-surface-raised">
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
        title={`Open ${document.name}`}
        className="min-w-0 flex-1 cursor-pointer text-left"
      >
        <span className="flex items-baseline gap-2">
          {document.documentNumber && (
            <span className="flex-none font-mono text-xs text-accent-text">
              {document.documentNumber}
            </span>
          )}
          {/* Underlined on hover so a pointer user gets the usual cue that this
              is not just a label. Touch users have the explicit View button. */}
          <span className="truncate text-sm font-semibold text-fg group-hover:underline">
            {document.name}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-fg-subtle">
          {form && <span className="text-accent-text">{form.label} · </span>}
          {formatDocumentDate(document)} · {formatBytes(document.size)}
          {document.notes ? ` · ${document.notes}` : ''}
        </span>
      </button>

      {/* An explicit View button: on a desktop nothing signalled that the row
          itself opens the document, and a title that only reveals itself on
          hover is not an affordance. */}
      <button
        type="button"
        onClick={() => onOpen(document)}
        className="flex-none rounded border border-edge px-2 py-1 text-xs font-semibold text-fg"
      >
        View
      </button>

      {/* Filling is the action most people want when a form exists, so it leads
          and carries the accent; download stays for anyone who prefers paper. */}
      {form && (
        <Link
          to={`fill/${document.id}`}
          className="flex-none rounded bg-accent px-2 py-1 text-xs font-bold text-accent-fg"
        >
          Fill out
        </Link>
      )}

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
