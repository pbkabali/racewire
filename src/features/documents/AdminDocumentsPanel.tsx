import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import { useRef, useState, type FormEvent } from 'react'

import { useAuth } from '../../app/providers/useAuth'
import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import {
  ALLOWED_MIME,
  deleteAttachment,
  formatBytes,
  MAX_UPLOAD_BYTES,
  uploadAttachment,
} from '../../lib/firebase/storage'
import { useOnlineStatus } from '../../lib/hooks/useOnlineStatus'
import type { EventDocument } from '../events/types'
import { DocumentAdminRow, type DocumentEdits } from './DocumentAdminRow'
import { groupDocuments, useDocuments } from './useDocuments'

export function AdminDocumentsPanel({ eventCode }: { eventCode: string }) {
  const { user } = useAuth()
  const online = useOnlineStatus()
  const { documents, folders } = useDocuments(eventCode)

  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [documentNumber, setDocumentNumber] = useState('')
  const [name, setName] = useState('')
  const [documentDate, setDocumentDate] = useState('')
  const [folderId, setFolderId] = useState('')
  const [notes, setNotes] = useState('')

  const [progress, setProgress] = useState<number | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [newFolder, setNewFolder] = useState('')

  async function createFolder(event: FormEvent) {
    event.preventDefault()
    const folderName = newFolder.trim()
    if (!folderName) return

    await addDoc(collection(db, eventPath(eventCode, eventCollections.folders)), {
      name: folderName,
      // Append to the end; ordering is manual and rarely changes.
      position: folders.length,
      createdAt: serverTimestamp(),
    })
    setNewFolder('')
  }

  async function publish(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setStatus(null)

    if (!file) {
      setError('Choose a file to upload.')
      return
    }

    // Storage has no offline queue, unlike Firestore. Say so rather than
    // letting the upload hang with no explanation.
    if (!online) {
      setError('Uploads need a connection. Firestore writes queue offline, file uploads do not.')
      return
    }

    let handle
    try {
      handle = uploadAttachment(file, `events/${eventCode}/documents`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed')
      return
    }

    setProgress(0)
    handle.task.on('state_changed', (snap) => {
      setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100))
    })

    try {
      const uploaded = await handle.done

      await addDoc(collection(db, eventPath(eventCode, eventCollections.documents)), {
        documentNumber: documentNumber.trim(),
        name: name.trim() || uploaded.name,
        // A date input has no timezone; parse as local midnight so the date
        // shown matches the one typed rather than shifting a day either way.
        documentDate: documentDate
          ? Timestamp.fromDate(new Date(`${documentDate}T00:00:00`))
          : null,
        folderId: folderId || null,
        notes: notes.trim(),
        fileName: uploaded.name,
        fileUrl: uploaded.url,
        filePath: uploaded.path,
        contentType: uploaded.contentType,
        size: uploaded.size,
        uploadedAt: serverTimestamp(),
        uploadedBy: user?.uid ?? null,
      })

      setStatus(`Published ${uploaded.name}.`)
      setFile(null)
      setDocumentNumber('')
      setName('')
      setDocumentDate('')
      setNotes('')
      if (fileRef.current) fileRef.current.value = ''
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed')
    } finally {
      setProgress(null)
    }
  }

  async function remove(document: EventDocument) {
    if (!window.confirm(`Delete “${document.name}”? This cannot be undone.`)) return

    // Storage object first: if this fails we keep the Firestore record and the
    // document stays visible, which is recoverable. The reverse would orphan
    // the file with nothing pointing at it.
    try {
      await deleteAttachment(document.filePath)
    } catch {
      // Already gone is fine; anything else surfaces when the doc delete fails.
    }
    await deleteDoc(doc(db, eventPath(eventCode, eventCollections.documents), document.id))
  }

  /** Metadata only: the stored file and its URL are deliberately untouched. */
  async function saveEdits(id: string, edits: DocumentEdits) {
    await updateDoc(doc(db, eventPath(eventCode, eventCollections.documents), id), edits)
  }

  const grouped = groupDocuments(documents, folders)

  return (
    <div className="space-y-6">
      <form onSubmit={publish} className="space-y-3 rounded-lg border border-edge bg-surface p-4">
        <h2 className="font-semibold text-fg">Upload a document</h2>

        <input
          ref={fileRef}
          type="file"
          accept={ALLOWED_MIME.join(',')}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-fg file:mr-3 file:rounded-md file:border file:border-edge file:bg-surface-raised file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-fg"
        />
        <p className="text-xs text-fg-subtle">
          PDF or image, up to {formatBytes(MAX_UPLOAD_BYTES)}
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
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Entry list"
            className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg placeholder:text-fg-subtle"
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
              Note (optional)
            </span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Revision 2"
              className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg placeholder:text-fg-subtle"
            />
          </label>
        </div>

        {progress !== null && (
          <div className="h-1 overflow-hidden rounded bg-surface-raised">
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={progress !== null}
          className="w-full rounded-md bg-accent py-2 font-bold text-accent-fg disabled:opacity-60"
        >
          {progress !== null ? `Uploading ${progress}%` : 'Publish document'}
        </button>

        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
        {status && <p className="text-sm text-accent-text">{status}</p>}
      </form>

      <form
        onSubmit={createFolder}
        className="flex items-end gap-2 rounded-lg border border-edge bg-surface p-4"
      >
        <label className="flex-1">
          <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            New folder
          </span>
          <input
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            placeholder="Bulletins"
            className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg placeholder:text-fg-subtle"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-edge px-3 py-2 text-sm font-semibold text-fg"
        >
          Create
        </button>
      </form>

      <section>
        <h2 className="mb-2 font-semibold text-fg">Published documents</h2>
        {documents.length === 0 ? (
          <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
            Nothing published yet.
          </p>
        ) : (
          grouped.map(({ folder, documents: docs }) => (
            <div
              key={folder?.id ?? 'ungrouped'}
              className="mb-3 overflow-hidden rounded-lg border border-edge bg-surface"
            >
              <h3 className="border-b border-edge px-3 py-2 text-xs font-bold tracking-wide text-fg-subtle uppercase">
                {folder?.name ?? 'Other documents'}
              </h3>
              <ul>
                {docs.map((document) => (
                  <DocumentAdminRow
                    key={document.id}
                    document={document}
                    folders={folders}
                    onSave={saveEdits}
                    onDelete={(d) => void remove(d)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
