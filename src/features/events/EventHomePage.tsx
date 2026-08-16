import { Link } from 'react-router-dom'

import { formatEventDates } from './types'
import { useEvent } from './useEvent'

/**
 * The tabs, restated as choices for someone who has just arrived. Each card
 * says what is BEHIND the tab, which the one-word tab labels cannot.
 */
const SECTIONS = [
  {
    to: 'notices',
    title: 'Notices',
    description: 'Announcements from the organiser, live as they publish.',
    icon: <path d="M3 9v4l4 1 9 4V4L7 8l-4 1Zm13-2.5v9M19 8a4 4 0 0 1 0 6" />,
  },
  {
    to: 'schedule',
    title: 'Schedule',
    description: 'The running order and timings for each day.',
    icon: (
      <path d="M5 4h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm-1 5h14M8 2.5v3M14 2.5v3" />
    ),
  },
  {
    to: 'docs',
    title: 'Documents',
    description: 'Regulations, bulletins and forms — including the entry form.',
    icon: <path d="M6 2.5h7l4 4V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Zm7 0V7h4M8 11h6M8 15h6" />,
  },
  {
    to: 'results',
    title: 'Results',
    description: 'Times and standings as they come in.',
    icon: <path d="M4 3.5h9v9H4zM4 3.5v16M4 12.5l9-.01M13 6h7l-2 3 2 3h-7" />,
  },
]

/**
 * Landing screen for an event: one card per section.
 *
 * A person following a shared link has never seen the tab bar before, and
 * dropping them straight into Notices made every other section look like it
 * did not exist. Cards give the whole map in one screen; the tabs stay as the
 * fast path once people know their way around.
 */
export function EventHomePage() {
  const event = useEvent()

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {event.logoUrl && (
          <img
            src={event.logoUrl}
            alt=""
            className="h-14 w-14 flex-none rounded-lg border border-edge bg-surface object-contain p-1"
          />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-fg">{event.name}</h1>
          <p className="text-sm text-fg-muted">
            {event.countryName} · {formatEventDates(event)}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            className="group flex items-start gap-3 rounded-lg border border-edge bg-surface p-4 transition-colors hover:border-accent/60"
          >
            <span
              aria-hidden
              className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-bg text-accent-text"
            >
              <svg
                viewBox="0 0 22 22"
                className="h-5.5 w-5.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {section.icon}
              </svg>
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-fg">{section.title}</span>
                <span
                  aria-hidden
                  className="text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent-text"
                >
                  →
                </span>
              </span>
              <span className="mt-0.5 block text-sm text-fg-muted">{section.description}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
