import { useState } from 'react'
import { Link } from 'react-router-dom'

import { AttachmentViewer } from '../../components/attachments/AttachmentViewer'
import { useEvent } from '../events/useEvent'
import type { EventDocument } from '../events/types'
import { DocumentRow } from './DocumentRow'
import { toAttachment } from './toAttachment'
import { getFormDefinition } from '../forms/rallyEntry'
import { groupDocuments, useDocuments } from './useDocuments'

/** Public documents list. Anyone can read; only event admins can publish. */
export function DocumentsPage() {
  const event = useEvent()
  const { documents, folders, loading, fromCache, error } = useDocuments(event.code)
  const [open, setOpen] = useState<EventDocument | null>(null)
  const [search, setSearch] = useState('')

  const needle = search.trim().toLowerCase()
  const filtered = needle
    ? documents.filter((d) =>
        `${d.documentNumber} ${d.name} ${d.notes}`.toLowerCase().includes(needle),
      )
    : documents

  const grouped = groupDocuments(filtered, folders)

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading documents">
        {[0, 1].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p className="rounded-lg border border-danger bg-surface p-4 text-sm text-danger-text">
        Could not load documents: {error.message}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight text-fg">Documents</h1>
        {fromCache && <span className="text-xs text-fg-subtle">saved copy</span>}
      </div>

      {documents.length > 0 && (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by number, name or note"
          aria-label="Search documents"
          className="w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
        />
      )}

      {documents.length === 0 && (
        <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
          No documents published yet. Bulletins, entry lists and regulations will appear here.
        </p>
      )}

      {documents.length > 0 && filtered.length === 0 && (
        <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
          Nothing matches “{search}”.
        </p>
      )}

      {grouped.map(({ folder, documents: docs }) => (
        <section
          key={folder?.id ?? 'ungrouped'}
          className="overflow-hidden rounded-lg border border-edge bg-surface"
        >
          <h2 className="border-b border-edge px-3 py-2 text-xs font-bold tracking-wide text-fg-subtle uppercase">
            {folder?.name ?? 'Other documents'}
            <span className="ml-2 font-normal normal-case text-fg-subtle">
              {docs.length} {docs.length === 1 ? 'file' : 'files'}
            </span>
          </h2>
          <ul>
            {docs.map((document) => (
              <DocumentRow key={document.id} document={document} onOpen={setOpen} />
            ))}
          </ul>
        </section>
      ))}

      {open && (
        <AttachmentViewer
          attachment={toAttachment(open)}
          onClose={() => setOpen(null)}
          action={
            getFormDefinition(open.formType) ? (
              <Link
                to={`/e/${event.code}/docs/fill/${open.id}`}
                className="flex-none rounded bg-accent px-3 py-1 text-xs font-bold text-accent-fg"
              >
                Fill out
              </Link>
            ) : null
          }
        />
      )}
    </div>
  )
}
