import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useAuth } from '../../app/providers/useAuth'
import { signOut } from '../../lib/firebase/auth'
import { collections, db } from '../../lib/firebase/db'
import { AdminDocumentsPanel } from '../documents/AdminDocumentsPanel'
import { formatEventDates, type Event } from '../events/types'
import { EventSharePanel } from './EventSharePanel'
import { AdminNoticesPanel } from './AdminNoticesPanel'
import { AdminLicencesPanel } from '../forms/AdminLicencesPanel'
import { EventEditor } from './EventEditor'

type Tab = 'notices' | 'documents' | 'licences' | 'share' | 'settings'

/**
 * Managing one event. Access is already checked by ProtectedRoute, which
 * verifies the claim covers this specific code, not just that the user is an
 * admin somewhere.
 */
export function AdminEventDashboard() {
  const { code } = useParams<{ code: string }>()
  const eventCode = (code ?? '').toUpperCase()
  const { user } = useAuth()
  const [event, setEvent] = useState<Event | null>(null)
  const [tab, setTab] = useState<Tab>('notices')

  useEffect(() => {
    if (!eventCode) return
    return onSnapshot(doc(db, collections.events, eventCode), (snap) => {
      setEvent(snap.exists() ? { ...(snap.data() as Event), code: snap.id } : null)
    })
  }, [eventCode])

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/admin" className="text-xs text-fg-muted hover:text-fg">
            ← All events
          </Link>
          <h1 className="mt-1 truncate text-xl font-bold text-fg">
            {event?.name ?? eventCode}
          </h1>
          <p className="truncate text-xs text-fg-subtle">
            {event ? `${event.sportType} · ${event.countryName} · ${formatEventDates(event)}` : ''}
          </p>
          <p className="truncate text-xs text-fg-subtle">{user?.email}</p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Link
            to={`/e/${eventCode}`}
            className="rounded-md border border-edge px-3 py-1.5 text-sm text-fg"
          >
            View
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md border border-edge px-3 py-1.5 text-sm text-fg"
          >
            Sign out
          </button>
        </div>
      </header>

      <div role="tablist" className="flex gap-1 border-b border-edge">
        {(['notices', 'documents', 'licences', 'share', 'settings'] as Tab[]).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold capitalize transition-colors ${
              tab === value
                ? 'border-accent text-fg'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {tab === 'notices' && <AdminNoticesPanel eventCode={eventCode} />}
      {tab === 'documents' && <AdminDocumentsPanel eventCode={eventCode} />}
      {tab === 'licences' && <AdminLicencesPanel eventCode={eventCode} />}
      {tab === 'share' &&
        (event ? (
          <EventSharePanel event={event} />
        ) : (
          <div className="h-64 animate-pulse rounded-lg bg-surface" />
        ))}
      {tab === 'settings' &&
        (event ? (
          // Keyed on the event so the form re-initialises from fresh data
          // rather than holding the values it mounted with.
          <EventEditor key={event.code} event={event} />
        ) : (
          <div className="h-64 animate-pulse rounded-lg bg-surface" />
        ))}
    </div>
  )
}
