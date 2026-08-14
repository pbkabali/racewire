import { useState } from 'react'
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
  // Collapsed by default: the list is what this page is for, creating is
  // occasional. Keeping the form shut also removes the ambiguity of a form
  // sitting in the same visual language as the records above it.
  const [creating, setCreating] = useState(false)

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
                  className="flex items-center gap-3 rounded-lg border border-edge bg-surface-raised p-3 shadow-sm transition-colors hover:border-accent"
                >
                  {event.logoUrl ? (
                    <img
                      src={event.logoUrl}
                      alt=""
                      loading="lazy"
                      className="h-10 w-10 flex-none rounded object-contain"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="flex h-10 w-10 flex-none items-center justify-center rounded bg-surface text-[11px] font-bold text-fg-subtle"
                    >
                      {event.code.slice(0, 3)}
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-fg">{event.name}</span>
                      {event.status === 'live' && (
                        <span className="flex-none rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold text-danger-fg">
                          LIVE
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-fg-muted">
                      {event.sportType} · {event.countryName} · {formatEventDates(event)}
                    </span>
                  </span>

                  <span className="flex-none rounded border border-edge px-1.5 py-0.5 font-mono text-[11px] text-fg-subtle">
                    {event.code}
                  </span>
                  <span aria-hidden className="flex-none text-fg-subtle">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Creating an event provisions a namespace others get access to, so it
          stays a super-admin action rather than something any event admin can do. */}
      {scope.superAdmin &&
        (creating ? (
          <section className="rounded-lg border-2 border-dashed border-accent/50 bg-bg p-1">
            <div className="flex items-center justify-between px-3 pt-2">
              <span className="text-xs font-bold tracking-wide text-accent-text uppercase">
                New event
              </span>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="text-xs font-semibold text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
            </div>
            <EventEditor existingCodes={events.map((e) => e.code)} />
          </section>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-edge py-3 text-sm font-semibold text-fg-muted transition-colors hover:border-accent hover:text-fg"
          >
            <span aria-hidden>+</span> New event
          </button>
        ))}
    </div>
  )
}
