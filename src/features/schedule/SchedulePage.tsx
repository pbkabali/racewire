import { useEvent } from '../events/useEvent'
import { groupByDay, isLink, type ScheduleItem } from './types'
import { useSchedule } from './useSchedule'

/**
 * The rally programme.
 *
 * A list rather than the four-column table the printed regulations use: that
 * table needs horizontal scrolling on a 390px phone, and a schedule people
 * check in a service park with one hand should not need panning.
 */
export function SchedulePage() {
  const event = useEvent()
  const { items, loading, error } = useSchedule(event.code)
  const groups = groupByDay(items)

  if (loading) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold tracking-tight text-fg">Schedule</h1>
        <div className="h-40 animate-pulse rounded-lg bg-surface" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold tracking-tight text-fg">Schedule</h1>

      {error && (
        <p className="rounded-lg border border-danger bg-surface p-4 text-sm text-danger-text">
          Could not load the schedule: {error.message}
        </p>
      )}

      {!error && items.length === 0 && (
        <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
          To be published soon
        </p>
      )}

      {groups.map((group, index) => (
        // Indexed because a day can legitimately appear twice: the organiser
        // owns the order, and grouping must never rearrange it to tidy up.
        <section key={`${group.day}-${index}`}>
          <h2 className="mb-2 text-xs font-bold tracking-wide text-fg-subtle uppercase">
            {group.day}
          </h2>
          <ul className="overflow-hidden rounded-lg border border-edge bg-surface">
            {group.items.map((item) => (
              <ScheduleRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ScheduleRow({ item }: { item: ScheduleItem }) {
  return (
    <li className="border-b border-edge p-3 last:border-b-0">
      <p className="text-sm font-semibold text-fg">{item.activity}</p>

      {/* The time leads, because somebody checking a schedule is asking when,
          not what. Tabular numerals so the column of times lines up. */}
      {item.when && (
        <p className="mt-0.5 font-mono text-xs tracking-tight text-accent-text tabular-nums">
          {item.when}
        </p>
      )}

      {item.place &&
        (isLink(item.place) ? (
          <a
            href={item.place}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 block truncate text-xs text-fg-muted underline"
          >
            {item.place.replace(/^https?:\/\//i, '')}
          </a>
        ) : (
          <p className="mt-0.5 text-xs text-fg-muted">{item.place}</p>
        ))}
    </li>
  )
}
