import { Link } from 'react-router-dom'

import { useAuth } from '../../app/providers/useAuth'
import { signOut } from '../../lib/firebase/auth'
import { formatEventDates } from '../events/types'
import { useEvents } from '../events/useEvents'
import { EventEditor } from './EventEditor'

/** Admin landing: the events this account may manage. */
export function AdminEventList() {
  const { user, scope } = useAuth()
  const { events, loading } = useEvents()

  const mine = scope.superAdmin
    ? events
    : events.filter((event) => scope.events.includes(event.code))

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-fg">Admin</h1>
          <p className="truncate text-xs text-fg-subtle">
            {user?.email}
            {scope.superAdmin && ' · super admin'}
          </p>
        </div>
        <div className="flex flex-none items-center gap-3">
          <Link to="/" className="text-sm text-fg-muted hover:text-fg">
            View board
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

      <section>
        <h2 className="mb-2 font-semibold text-fg">Your events</h2>
        {loading ? (
          <div className="h-20 animate-pulse rounded-lg bg-surface" />
        ) : mine.length === 0 ? (
          <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
            No events assigned to this account yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {mine.map((event) => (
              <li key={event.code}>
                <Link
                  to={`/admin/e/${event.code}`}
                  className="flex items-center gap-3 rounded-lg border border-edge bg-surface p-3 transition-colors hover:border-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="truncate font-semibold text-fg">{event.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-fg-muted">
                      {event.sportType} · {event.countryName} · {formatEventDates(event)}
                    </span>
                  </span>
                  <span className="flex-none rounded border border-edge px-1.5 py-0.5 font-mono text-[11px] text-fg-subtle">
                    {event.code}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Creating an event provisions a namespace others get access to, so it
          stays a super-admin action rather than something any event admin can do. */}
      {scope.superAdmin && <EventEditor existingCodes={events.map((e) => e.code)} />}
    </div>
  )
}
