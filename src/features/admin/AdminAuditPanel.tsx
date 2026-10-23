import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'

type AuditEntry = {
  id: string
  at: Timestamp | null
  uid: string
  email: string
  action: 'create' | 'update' | 'delete'
  collection: string
  documentId: string
  summary: string
  changed: string[]
}

const ACTION_STYLE: Record<AuditEntry['action'], string> = {
  create: 'bg-surface-raised text-fg',
  update: 'bg-surface-raised text-fg',
  delete: 'bg-danger text-danger-fg',
}

/** Relative where it helps, absolute where it matters. */
function when(at: Timestamp | null): string {
  if (!at) return 'just now'
  const date = at.toDate()
  const minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h ago`
  return date.toLocaleString()
}

/**
 * Who changed what on this event.
 *
 * Super admins only — the rules enforce it, this is just the screen. An event
 * admin cannot read it, which is the point: it exists to be read about them,
 * and a log its subjects can inspect and act on is a weaker thing than one
 * they cannot.
 */
export function AdminAuditPanel({ eventCode }: { eventCode: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = query(
      collection(db, eventPath(eventCode, eventCollections.auditLog)),
      orderBy('at', 'desc'),
      limit(200),
    )
    return onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => ({ ...(d.data() as AuditEntry), id: d.id })))
        setError(null)
      },
      (cause) => setError(cause.message),
    )
  }, [eventCode])

  return (
    <section>
      <h2 className="mb-1 font-semibold text-fg">Audit log</h2>
      <p className="mb-3 text-xs text-fg-subtle">
        Every change an admin made to this event, newest first. Written by the server,
        not the app, so it cannot be edited or omitted from here. Licence imports and
        competitors' own entry edits are left out deliberately.
      </p>

      {error && (
        <p className="rounded-lg border border-danger bg-surface p-3 text-sm text-danger-text">
          {error}
        </p>
      )}

      {entries === null && !error && <div className="h-40 animate-pulse rounded-lg bg-surface" />}

      {entries?.length === 0 && (
        <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
          Nothing recorded yet.
        </p>
      )}

      {entries && entries.length > 0 && (
        <ul className="divide-y divide-edge rounded-lg border border-edge">
          {entries.map((entry) => (
            <li key={entry.id} className="p-3">
              <div className="flex items-center gap-2">
                <span
                  className={`flex-none rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    ACTION_STYLE[entry.action] ?? ACTION_STYLE.update
                  }`}
                >
                  {entry.action}
                </span>
                <span className="truncate text-xs font-semibold text-fg">
                  {entry.collection}
                </span>
                <span className="ml-auto flex-none text-[11px] text-fg-subtle">
                  {when(entry.at)}
                </span>
              </div>

              {entry.summary && (
                <p className="mt-1 truncate text-sm text-fg">{entry.summary}</p>
              )}

              <p className="mt-0.5 truncate text-xs text-fg-muted">
                {entry.email || entry.uid}
              </p>

              {entry.changed?.length > 0 && (
                <p className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle">
                  changed: {entry.changed.join(', ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
