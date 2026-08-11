import { useEvent } from '../events/useEvent'

/**
 * Placeholder until timing integration exists. Deliberately a real page rather
 * than a hidden tab: spectators look for results, and a clear "not yet" beats a
 * missing menu that reads as a broken app.
 */
export function ResultsPage() {
  const event = useEvent()

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold tracking-tight text-fg">Results</h1>

      <div className="rounded-lg border border-edge bg-surface p-8 text-center">
        <p className="text-sm font-semibold text-fg">
          Live results for this event will be displayed here
        </p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-fg-muted">
          Check the Notices tab for updates from {event.name} in the meantime.
        </p>
      </div>
    </div>
  )
}
