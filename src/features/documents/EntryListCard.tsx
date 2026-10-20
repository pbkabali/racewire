import { useState } from 'react'

import { regenerateEntryList } from '../../lib/firebase/functions'

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; rebuilt: boolean; entries: number }
  | { kind: 'error'; message: string }

/**
 * The entry list, and a way to force it.
 *
 * The list rebuilds itself whenever an entry changes, so this button exists
 * for the cases that cannot reach: an event whose entries were all submitted
 * before this feature shipped and so have not been written since, a file
 * deleted by hand, or simply wanting to be certain before printing.
 */
export function EntryListCard({
  eventCode,
  online,
}: {
  eventCode: string
  online: boolean
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function rebuild() {
    setStatus({ kind: 'working' })
    try {
      const result = await regenerateEntryList({ eventId: eventCode })
      setStatus({
        kind: 'done',
        rebuilt: result.data.rebuilt,
        entries: result.data.entries,
      })
    } catch (cause) {
      setStatus({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'Could not rebuild the list',
      })
    }
  }

  return (
    <section className="rounded-lg border border-edge bg-surface p-4">
      <h2 className="font-semibold text-fg">Entry list</h2>
      <p className="mt-1 text-xs text-fg-subtle">
        Generated from submitted entries and republished automatically whenever one
        changes. It appears in the <strong className="font-semibold">Lists</strong> folder
        below. Rebuild by hand if entries were submitted before this existed, or to be
        certain before printing.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void rebuild()}
          disabled={status.kind === 'working' || !online}
          className="rounded-md border border-edge px-3 py-2 text-sm font-semibold text-fg disabled:opacity-60"
        >
          {status.kind === 'working' ? 'Rebuilding…' : 'Rebuild now'}
        </button>

        {/* "Already up to date" is a real answer, not a non-event: without it a
            button that correctly does nothing looks like a button that failed. */}
        {status.kind === 'done' && (
          <span className="text-xs text-fg-muted">
            {status.rebuilt
              ? `Rebuilt — ${status.entries} ${status.entries === 1 ? 'entry' : 'entries'}.`
              : `Already up to date — ${status.entries} ${
                  status.entries === 1 ? 'entry' : 'entries'
                }.`}
          </span>
        )}
        {status.kind === 'error' && <span className="text-xs text-danger">{status.message}</span>}
        {!online && <span className="text-xs text-fg-subtle">Offline.</span>}
      </div>
    </section>
  )
}
