import { useState } from 'react'

import { useAuth } from '../../app/providers/useAuth'
import { canManageEvent } from '../../lib/firebase/auth'
import { refreshLiveResults } from '../../lib/firebase/functions'
import { useEvent } from '../events/useEvent'
import { ResultsTable } from './ResultsTable'
import { useLiveResults } from './useLiveResults'
import { SponsorStrip } from '../sponsors/SponsorStrip'
import { useAppSponsors, useEventSponsors } from '../sponsors/useSponsors'

/**
 * Live tracking and running results.
 *
 * Tracking is a link rather than a frame: the providers' pages assume a full
 * window, and a crew's family following a car wants it open on its own, not
 * inside a tab they might navigate away from.
 *
 * The results card is a placeholder with its labelling already in place. The
 * feed will arrive from an API later, and the one thing that must not be
 * bolted on afterwards is the word UNOFFICIAL -- a timing feed read as final
 * is how a crew celebrates a podium they did not get.
 */
export function LivePage() {
  const event = useEvent()
  const { scope } = useAuth()
  const { results } = useLiveResults(event.code)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventSponsors = useEventSponsors(event.code)
  const appSponsors = useAppSponsors()

  return (
    /* A column the height of the screen: heading and tracking take what
       they need, the results card takes the rest, the boards sit under it.
       Nothing here is position:fixed — the boards are simply last in a
       full-height column, which keeps them clear of the nav without
       anybody having to know how tall the nav is. */
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h1 className="flex-none text-xl font-bold tracking-tight text-fg">Live</h1>

      {event.trackingUrl ? (
        <a
          href={event.trackingUrl}
          target="_blank"
          rel="noreferrer"
          /* py-3 lands it at exactly 44px, which is the smallest tap target
             iOS asks for. Smaller looked tidier and would have been a worse
             button to hit in a moving service van. */
          className="block rounded-lg bg-accent px-4 py-3 text-center text-sm font-semibold text-accent-fg"
        >
          Open live tracking
        </a>
      ) : (
        /*
         * A line, not a card. With no link there is nothing to press, and a
         * full bordered box the size of a button spent a chunk of the screen
         * saying that nothing is here yet — on the one tab where the screen
         * is wanted for results. The card below already explains the wait.
         */
        <p className="text-center text-xs text-fg-subtle">
          Live tracking will be linked here once the event starts.
        </p>
      )}

      <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-edge bg-surface">
        <header className="flex flex-none items-center gap-2 border-b border-edge p-3">
          <h2 className="font-semibold text-fg">Live results</h2>
          {/* Permanent, not conditional on there being results: the label is
              the point of the card, and a badge that appears only sometimes
              is one people learn to stop reading. */}
          <span className="flex-none rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold text-danger-fg">
            UNOFFICIAL
          </span>
        </header>

        {/* Scrolls inside the card rather than moving the page, so the
            boards below stay where they are once times start arriving. */}
        {results && results.rows.length > 0 ? (
          <ResultsTable results={results} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center">
            <p className="text-sm text-fg-muted">
              Running times will appear here once the first stage is away.
            </p>
            <p className="mx-auto mt-2 max-w-sm text-xs text-fg-subtle">
              Unofficial and subject to penalties, protests and corrections. Provisional
              and final classifications are published as documents and are the only
              results that count.
            </p>
          </div>
        )}

        {/* Under the table, not over it: once there are results the caveat
            matters more than ever, and the badge above carries it anyway. */}
        <footer className="flex flex-none items-center gap-2 border-t border-edge px-3 py-1.5">
          <p className="min-w-0 flex-1 truncate text-[10px] text-fg-subtle">
            {results?.fetchedAt
              ? `Updated ${results.fetchedAt.toDate().toLocaleTimeString()} · unofficial`
              : 'Unofficial'}
          </p>

          {canManageEvent(scope, event.code) && (
            <button
              type="button"
              onClick={() => {
                setRefreshing(true)
                setError(null)
                refreshLiveResults({ eventId: event.code })
                  .catch((cause: Error) => setError(cause.message))
                  .finally(() => setRefreshing(false))
              }}
              disabled={refreshing}
              className="flex-none rounded border border-edge px-2 py-0.5 text-[10px] font-semibold text-fg disabled:opacity-60"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </footer>

        {error && (
          <p className="flex-none border-t border-edge px-3 py-2 text-[10px] text-danger-text">
            {error}
          </p>
        )}
      </section>

      {/* Always here, not only when there is something to show above them.
          Live is the screen people sit on during a rally, so it is the one
          where a board is actually seen. */}
      {/* flex-none so a short viewport squeezes the results card rather
          than the boards: a flex item may shrink below its content, and a
          squashed logo is worse than a shorter list. space-y-2 because the
          strip no longer carries a margin of its own. */}
      <div className="flex-none space-y-2">
        <SponsorStrip title="Event partners" sponsors={eventSponsors} />
        <SponsorStrip title="Racewire partners" sponsors={appSponsors} />
      </div>
    </div>
  )
}
