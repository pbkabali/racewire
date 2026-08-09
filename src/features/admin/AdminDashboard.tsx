import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../../app/providers/useAuth'
import { signOut } from '../../lib/firebase/auth'
import { collections, db } from '../../lib/firebase/db'
import { useOnlineStatus } from '../../lib/hooks/useOnlineStatus'
import type { NoticeSeverity } from '../notices/types'

const severities: NoticeSeverity[] = ['info', 'warning', 'urgent']

export function AdminDashboard() {
  const { user } = useAuth()
  const online = useOnlineStatus()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [severity, setSeverity] = useState<NoticeSeverity>('info')
  const [pinned, setPinned] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function publish(event: FormEvent) {
    event.preventDefault()

    // Deliberately not awaited. Offline, Firestore resolves this promise only
    // once the server acknowledges -- which could be hours. The local write
    // lands immediately and listeners update, so the UI should not block.
    void addDoc(collection(db, collections.notices), {
      title,
      body,
      severity,
      pinned,
      publishedAt: serverTimestamp(),
      authorId: user?.uid ?? null,
    })

    setStatus(online ? 'Published.' : 'Saved — will publish when you reconnect.')
    setTitle('')
    setBody('')
    setSeverity('info')
    setPinned(false)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Admin</h1>
          <p className="text-xs text-zinc-500">{user?.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/" className="text-sm text-zinc-400 hover:text-zinc-100">
            View board
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md border border-asphalt-light px-3 py-1.5 text-sm text-zinc-300"
          >
            Sign out
          </button>
        </div>
      </header>

      <form
        onSubmit={publish}
        className="space-y-4 rounded-lg border border-asphalt-light bg-asphalt p-4"
      >
        <h2 className="font-semibold text-zinc-100">Post a notice</h2>

        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full rounded-md border border-asphalt-light bg-track-black px-3 py-2 text-zinc-100 placeholder:text-zinc-600"
        />

        <textarea
          required
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Details…"
          className="w-full rounded-md border border-asphalt-light bg-track-black px-3 py-2 text-zinc-100 placeholder:text-zinc-600"
        />

        <div className="flex flex-wrap items-center gap-2">
          {severities.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSeverity(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize ${
                severity === value
                  ? 'bg-flag-yellow text-track-black'
                  : 'border border-asphalt-light text-zinc-400'
              }`}
            >
              {value}
            </button>
          ))}

          <label className="ml-auto flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="accent-flag-yellow"
            />
            Pin
          </label>
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-flag-red py-2 font-bold text-white"
        >
          Publish
        </button>

        {status && <p className="text-sm text-flag-yellow">{status}</p>}
        {!online && (
          <p className="text-xs text-zinc-500">
            You are offline. Notices are queued locally and sent automatically.
          </p>
        )}
      </form>
    </div>
  )
}
