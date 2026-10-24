import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Brand } from '../../components/Brand'
import { SponsorStrip } from '../sponsors/SponsorStrip'
import { useAppSponsors } from '../sponsors/useSponsors'
import { InstallPrompt } from '../../components/InstallPrompt'
import { ThemeToggle } from '../../components/ThemeToggle'
import { formatEventDates, type Event, type EventStatus } from './types'
import { groupByStatus, STATUS_ORDER, useEvents } from './useEvents'

const STATUS_LABEL: Record<EventStatus, string> = {
  live: 'Happening now',
  upcoming: 'Upcoming',
  completed: 'Completed',
}

/** The landing screen. Everything else in the app hangs off choosing an event. */
export function EventPickerPage() {
  const { events, loading, fromCache, error } = useEvents()
  const appSponsors = useAppSponsors()
  const groups = groupByStatus(events)

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-edge bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <Brand />
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <InstallPrompt />
        <h1 className="text-xl font-bold tracking-tight text-fg">Choose an event</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Notices, schedule, documents and results are published per event.
        </p>
        {fromCache && <p className="mt-1 text-xs text-fg-subtle">Showing a saved copy.</p>}

        {error && (
          <p className="mt-4 rounded-lg border border-danger bg-surface p-4 text-sm text-danger-text">
            Could not load events: {error.message}
          </p>
        )}

        {loading && <LoadingEvents />}

        {!loading && !error && events.length === 0 && (
          <p className="mt-6 rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
            No events published yet.
          </p>
        )}

        {STATUS_ORDER.map((status) =>
          groups[status].length === 0 ? null : (
            <section key={status} className="mt-6">
              <h2 className="mb-2 flex items-center gap-2 text-xs font-bold tracking-wide text-fg-subtle uppercase">
                {status === 'live' && (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden />
                )}
                {STATUS_LABEL[status]}
              </h2>
              <ul className="space-y-2">
                {groups[status].map((event) => (
                  <li key={event.code}>
                    <EventCard event={event} />
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
        {/* Only the app's own sponsors here: no event is chosen yet. */}
        <SponsorStrip title="Racewire partners" sponsors={appSponsors} />
      </main>
    </div>
  )
}

function EventCard({ event }: { event: Event }) {
  return (
    <Link
      to={`/e/${event.code}`}
      className="flex items-center gap-3 rounded-lg border border-edge bg-surface p-3 transition-colors hover:border-accent"
    >
      {event.logoUrl ? (
        <img
          src={event.logoUrl}
          alt=""
          loading="lazy"
          className="h-12 w-12 flex-none rounded object-contain"
        />
      ) : (
        // Placeholder keeps the row height stable whether or not a logo exists.
        <span
          aria-hidden
          className="flex h-12 w-12 flex-none items-center justify-center rounded bg-surface-raised text-xs font-bold text-fg-subtle"
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
    </Link>
  )
}

/**
 * Shown while the first load is in flight.
 *
 * This replaced three pulsing placeholder bars. They were the better pattern
 * in principle -- a skeleton says what is coming, a spinner only says that
 * something is -- but in the dark theme `surface` sits a shade off `bg`, so
 * on a phone they read as an empty screen rather than as work in progress.
 *
 * Held back for a moment before appearing. Firestore serves this list from
 * IndexedDB on every launch after the first, which resolves in tens of
 * milliseconds, and a spinner that appears and vanishes inside a single frame
 * reads as a glitch. The delay costs nothing on the cold launch this exists
 * for -- reaching the network is never that quick -- and keeps every warm
 * launch perfectly still.
 */
const SPINNER_DELAY_MS = 250

function LoadingEvents() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SPINNER_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-10 flex flex-col items-center gap-3 py-8"
    >
      {/* Matches the spinner in PullToRefresh so the app has one of these,
          not two. Static under reduced motion -- the label still says it. */}
      <span
        aria-hidden
        className="h-8 w-8 animate-spin rounded-full border-2 border-edge border-t-accent motion-reduce:animate-none"
      />
      <p className="text-sm text-fg-muted">Loading events…</p>
    </div>
  )
}
