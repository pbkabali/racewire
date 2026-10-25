import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { db } from '../../lib/firebase/db'
import { deleteAttachment, uploadAttachment } from '../../lib/firebase/storage'
import type { Sponsor } from '../sponsors/types'

/**
 * Manages one sponsor board.
 *
 * Takes its collection and upload folder rather than knowing which board it
 * is, because the app-level and event-level boards differ in exactly those
 * two things. One component means the two cannot drift into subtly different
 * behaviour, which is what happens when a second board is built by copying
 * the first.
 */
export function AdminSponsorsPanel({
  path,
  uploadFolder,
  title,
  description,
}: {
  path: string
  uploadFolder: string
  title: string
  description: string
}) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([])
  const [name, setName] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return onSnapshot(query(collection(db, path), orderBy('position', 'asc')), (snap) =>
      setSponsors(snap.docs.map((d) => ({ ...(d.data() as Sponsor), id: d.id }))),
    )
  }, [path])

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !file) {
      setError('A name and a logo are both needed.')
      return
    }

    setError(null)
    let handle
    try {
      handle = uploadAttachment(file, uploadFolder)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file was rejected')
      return
    }

    setProgress(0)
    handle.task.on('state_changed', (snap) =>
      setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
    )

    try {
      const uploaded = await handle.done
      await addDoc(collection(db, path), {
        name: name.trim(),
        logoUrl: uploaded.url,
        logoPath: uploaded.path,
        linkUrl: linkUrl.trim(),
        position: sponsors.length,
        createdAt: serverTimestamp(),
      })
      setName('')
      setLinkUrl('')
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add that sponsor')
    } finally {
      setProgress(null)
    }
  }

  /*
   * Swap with the neighbour, both writes in one batch — the same shape the
   * folder manager uses. Two separate updates could interleave with another
   * admin's reorder and leave two sponsors sharing a position, which on a
   * board somebody paid for is not a cosmetic problem.
   */
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    const a = sponsors[index]
    const b = sponsors[target]
    if (!a || !b) return

    const batch = writeBatch(db)
    batch.update(doc(db, path, a.id), { position: target })
    batch.update(doc(db, path, b.id), { position: index })
    await batch.commit()
  }

  async function remove(sponsor: Sponsor) {
    if (!window.confirm(`Remove ${sponsor.name} from this board?`)) return
    try {
      // File first: a board entry with no logo is visibly broken and fixable,
      // an orphaned file in the bucket is neither.
      await deleteAttachment(sponsor.logoPath)
    } catch {
      // Already gone, or never stored. The row still has to go.
    }
    await deleteDoc(doc(db, path, sponsor.id))
  }

  async function rename(sponsor: Sponsor, value: string) {
    if (value.trim() && value.trim() !== sponsor.name) {
      await updateDoc(doc(db, path, sponsor.id), { name: value.trim() })
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold text-fg">{title}</h2>
        <p className="mt-1 text-xs text-fg-subtle">{description}</p>
      </div>

      <form onSubmit={(e) => void add(e)} className="space-y-2 rounded-lg border border-edge bg-surface p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sponsor name"
          className="w-full rounded-md border border-edge bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
        />
        <input
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://sponsor.example.com (optional)"
          className="w-full rounded-md border border-edge bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
        />
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-xs text-fg-muted"
        />
        {/* Said here rather than discovered on a dark phone: the tile behind
            each logo is white, so a transparent PNG is what you want. */}
        <p className="text-xs text-fg-subtle">
          Logos sit on a white tile. A transparent PNG works best.
        </p>

        {progress !== null && (
          <p className="text-xs text-fg-muted">Uploading… {progress}%</p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}

        <button
          type="submit"
          disabled={progress !== null}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-60"
        >
          Add sponsor
        </button>
      </form>

      {sponsors.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
          No sponsors on this board yet.
        </p>
      ) : (
        <ul className="divide-y divide-edge rounded-lg border border-edge">
          {sponsors.map((sponsor, index) => (
            <li key={sponsor.id} className="flex items-center gap-3 p-3">
              <span className="flex h-10 w-20 flex-none items-center justify-center rounded bg-white px-2">
                <img
                  src={sponsor.logoUrl}
                  alt=""
                  className="h-8 w-auto object-contain"
                />
              </span>

              <input
                defaultValue={sponsor.name}
                onBlur={(e) => void rename(sponsor, e.target.value)}
                aria-label="Sponsor name"
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-fg hover:border-edge focus:border-edge"
              />

              <div className="flex flex-none items-center gap-1">
                <button
                  type="button"
                  onClick={() => void move(index, -1)}
                  disabled={index === 0}
                  aria-label="Move up"
                  className="rounded border border-edge px-2 py-1 text-xs text-fg disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => void move(index, 1)}
                  disabled={index === sponsors.length - 1}
                  aria-label="Move down"
                  className="rounded border border-edge px-2 py-1 text-xs text-fg disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => void remove(sponsor)}
                  className="rounded border border-edge px-2 py-1 text-xs text-danger-text"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
