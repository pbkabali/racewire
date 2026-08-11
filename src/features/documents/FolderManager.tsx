import { deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore'
import { useState, type FormEvent } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import type { DocumentFolder, EventDocument } from '../events/types'

/**
 * Rename, reorder and delete folders.
 *
 * Ordering is an explicit `position` field rather than alphabetical, because
 * organisers want "Bulletins" above "Regulations" regardless of the alphabet.
 */
export function FolderManager({
  eventCode,
  folders,
  documents,
}: {
  eventCode: string
  folders: DocumentFolder[]
  documents: EventDocument[]
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const path = (id: string) => doc(db, eventPath(eventCode, eventCollections.folders), id)

  async function rename(event: FormEvent, folder: DocumentFolder) {
    event.preventDefault()
    const name = draftName.trim()
    if (!name) return

    setBusy(true)
    setError(null)
    try {
      await updateDoc(path(folder.id), { name })
      setEditingId(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not rename')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Swap this folder's position with its neighbour.
   *
   * Both writes go in one batch: two separate updates could interleave with
   * another admin's reorder and leave two folders sharing a position, which
   * then sorts unpredictably.
   */
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= folders.length) return

    setBusy(true)
    setError(null)
    try {
      const batch = writeBatch(db)
      // Written from array order rather than stored values, so a set of folders
      // that already share a position gets normalised rather than staying stuck.
      batch.update(path(folders[index].id), { position: target })
      batch.update(path(folders[target].id), { position: index })
      await batch.commit()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reorder')
    } finally {
      setBusy(false)
    }
  }

  async function remove(folder: DocumentFolder) {
    const inside = documents.filter((d) => d.folderId === folder.id)

    if (
      !window.confirm(
        inside.length
          ? `Delete the folder “${folder.name}”?\n\n` +
            `Its ${inside.length} document${inside.length === 1 ? '' : 's'} will move to ` +
            `“Other documents”. No files are deleted.`
          : `Delete the empty folder “${folder.name}”?`,
      )
    ) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      // Clear the reference before removing the folder. groupDocuments already
      // treats a dangling folderId as ungrouped, but leaving stale ids behind
      // means a later folder reusing that id would silently adopt them.
      if (inside.length) {
        const batch = writeBatch(db)
        for (const document of inside) {
          batch.update(
            doc(db, eventPath(eventCode, eventCollections.documents), document.id),
            { folderId: null },
          )
        }
        await batch.commit()
      }

      await deleteDoc(path(folder.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete')
    } finally {
      setBusy(false)
    }
  }

  if (!folders.length) return null

  return (
    <section className="rounded-lg border border-edge bg-surface">
      <h2 className="border-b border-edge px-3 py-2 text-xs font-bold tracking-wide text-fg-subtle uppercase">
        Folders
      </h2>

      <ul>
        {folders.map((folder, index) => {
          const count = documents.filter((d) => d.folderId === folder.id).length

          return (
            <li key={folder.id} className="border-b border-edge px-3 py-2 last:border-b-0">
              {editingId === folder.id ? (
                <form onSubmit={(e) => void rename(e, folder)} className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-edge bg-bg px-3 py-1.5 text-sm text-fg"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex-none rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-accent-fg disabled:opacity-60"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="flex-none rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-fg"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {folder.name}
                    <span className="ml-2 text-xs text-fg-subtle">
                      {count} {count === 1 ? 'file' : 'files'}
                    </span>
                  </span>

                  <button
                    type="button"
                    onClick={() => void move(index, -1)}
                    disabled={busy || index === 0}
                    aria-label={`Move ${folder.name} up`}
                    className="flex-none rounded border border-edge px-2 py-1 text-xs text-fg disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => void move(index, 1)}
                    disabled={busy || index === folders.length - 1}
                    aria-label={`Move ${folder.name} down`}
                    className="flex-none rounded border border-edge px-2 py-1 text-xs text-fg disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(folder.name)
                      setEditingId(folder.id)
                    }}
                    className="flex-none text-xs font-semibold text-fg-muted hover:text-fg"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(folder)}
                    className="flex-none text-xs font-semibold text-danger-text"
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {error && (
        <p role="alert" className="px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}
    </section>
  )
}
