import { useState, type FormEvent } from 'react'
import { Timestamp } from 'firebase/firestore'

import { formatBytes } from '../../lib/firebase/storage'
import type { DocumentFolder, EventDocument } from '../events/types'

export type DocumentEdits = {
  documentNumber: string
  name: string
  documentDate: Timestamp | null
  folderId: string | null
  notes: string
}

/** Firestore Timestamp -> the yyyy-mm-dd a date input expects, in local time. */
function toDateInput(stamp: Timestamp | null): string {
  if (!stamp) return ''
  const d = stamp.toDate()
  // Not toISOString(): that converts to UTC and can shift the date by a day
  // either side of midnight, silently changing what the organiser typed.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * One published document in the admin list, editable in place.
 *
 * Metadata only — the file itself is never touched. Replacing a file would
 * change its URL, and any link already printed on a bulletin or shared in a
 * WhatsApp group would break. Upload a new document for that.
 */
export function DocumentAdminRow({
  document,
  folders,
  onSave,
  onDelete,
}: {
  document: EventDocument
  folders: DocumentFolder[]
  onSave: (id: string, edits: DocumentEdits) => Promise<void>
  onDelete: (document: EventDocument) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [documentNumber, setDocumentNumber] = useState(document.documentNumber)
  const [name, setName] = useState(document.name)
  const [documentDate, setDocumentDate] = useState(toDateInput(document.documentDate))
  const [folderId, setFolderId] = useState(document.folderId ?? '')
  const [notes, setNotes] = useState(document.notes)

  function startEditing() {
    // Reset from the document each time, so a cancelled edit does not leave
    // stale values waiting in the form.
    setDocumentNumber(document.documentNumber)
    setName(document.name)
    setDocumentDate(toDateInput(document.documentDate))
    setFolderId(document.folderId ?? '')
    setNotes(document.notes)
    setError(null)
    setEditing(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('A name is required.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave(document.id, {
        documentNumber: documentNumber.trim(),
        name: name.trim(),
        documentDate: documentDate
          ? Timestamp.fromDate(new Date(`${documentDate}T00:00:00`))
          : null,
        folderId: folderId || null,
        notes: notes.trim(),
      })
      setEditing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <li className="flex items-center gap-3 border-b border-edge px-3 py-2 last:border-b-0">
        <span className="min-w-0 flex-1 truncate text-sm text-fg">
          {document.documentNumber && (
            <span className="mr-2 font-mono text-xs text-accent-text">
              {document.documentNumber}
            </span>
          )}
          {document.name}
        </span>
        <span className="flex-none text-xs text-fg-subtle">{formatBytes(document.size)}</span>
        <button
          type="button"
          onClick={startEditing}
          className="flex-none text-xs font-semibold text-fg-muted hover:text-fg"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(document)}
          className="flex-none text-xs font-semibold text-danger-text"
        >
          Delete
        </button>
      </li>
    )
  }

  return (
    <li className="border-b border-edge px-3 py-3 last:border-b-0">
      <form onSubmit={save} className="space-y-3">
        <p className="truncate text-xs text-fg-subtle">
          Editing details for <span className="text-fg">{document.fileName}</span> — the file
          itself is unchanged
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              Document number
            </span>
            <input
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              placeholder="001"
              className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg placeholder:text-fg-subtle"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              Document date
            </span>
            <input
              type="date"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Name
          </span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              Folder
            </span>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg"
            >
              <option value="">No folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              Note
            </span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Revision 2"
              className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg placeholder:text-fg-subtle"
            />
          </label>
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-bold text-accent-fg disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md border border-edge px-4 py-1.5 text-sm font-semibold text-fg"
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  )
}
