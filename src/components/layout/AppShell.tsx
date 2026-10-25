import { Link, NavLink, Outlet, useMatch } from 'react-router-dom'

import { useAuth } from '../../app/providers/useAuth'
import { EventContact } from '../../features/events/EventContact'
import { formatEventDates } from '../../features/events/types'
import { useEvent } from '../../features/events/useEvent'
import { NotificationCentre } from '../../features/notifications/NotificationCentre'
import { canManageEvent } from '../../lib/firebase/auth'
import { Brand } from '../Brand'
import { InstallPrompt } from '../InstallPrompt'
import { OfflineBanner } from '../OfflineBanner'
import { ThemeToggle } from '../ThemeToggle'

const navItems = [
  /*
   * Home earns a slot of its own.
   *
   * The event name in the header has always linked here, but it reads as a
   * title rather than a control, so in practice the card home was reachable
   * only by guessing. That did not matter while every card merely duplicated
   * a tab — it started mattering the moment the route map lived there and
   * nowhere else, leaving it unreachable from any other screen.
   *
   * `end` because '.' resolves to the event root, which every other tab is
   * nested under: without it, Home would light up on all of them.
   */
  { to: '.', label: 'Home', end: true },
  { to: 'notices', label: 'Notices', end: false },
  { to: 'schedule', label: 'Schedule', end: false },
  { to: 'docs', label: 'Docs', end: false },
  { to: 'live', label: 'Live', end: false },
]

/**
 * Event chrome: bottom tab bar on phones (thumb reach), promoted to a top bar
 * from `sm` up. All nav links are relative to /e/:code, so the shell knows
 * nothing about which event it is rendering.
 */
export function AppShell() {
  const event = useEvent()
  const { scope } = useAuth()
  const canManage = canManageEvent(scope, event.code)

  /*
   * The organiser's contact details live in the layout, so every tab gets
   * them. Live is the exception: it ends in sponsor boards, and a contact
   * block under those reads as part of the last one.
   */
  const onLive = useMatch('/e/:code/live') !== null

  return (
    <div className="flex min-h-dvh flex-col overscroll-none-y">
      <OfflineBanner />

      <header className="border-b border-edge bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex-none" aria-label="Choose a different event">
            <Brand creditFrom="sm" />
          </Link>

          <span className="mx-1 h-5 w-px flex-none bg-edge" aria-hidden />

          {/* Absolute, matching FillFormPage's lesson: relative paths from a
              layout are easy to get subtly wrong. The name is the way back to
              the event's card home from any tab. */}
          <Link to={`/e/${event.code}`} className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-fg">{event.name}</span>
              {event.status === 'live' && (
                <span className="flex-none rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold text-danger-fg">
                  LIVE
                </span>
              )}
            </span>
            <span className="hidden truncate text-xs text-fg-subtle sm:block">
              {event.countryName} · {formatEventDates(event)}
            </span>
          </Link>

          {canManage && (
            <Link
              to={`/admin/e/${event.code}`}
              className="flex-none rounded border border-edge px-2 py-1 text-xs font-semibold text-fg"
            >
              Manage
            </Link>
          )}
          <div className="flex-none">
            <ThemeToggle />
          </div>
          {/* Last in the row, hard against the right edge. The bell is the one
              control here that changes on its own and carries an unread count,
              so it gets the corner the eye goes to; the theme toggle is set
              once and then ignored. */}
          <NotificationCentre eventCode={event.code} />
        </div>

        <nav className="mx-auto hidden max-w-5xl gap-1 px-6 pb-2 sm:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* pb-20 clears the fixed mobile tab bar. */}
      {/* flex-col so a page can claim the full height and scroll inside itself
          rather than growing the document. min-h-0 is what lets it shrink:
          a flex item defaults to min-height:auto and would refuse to be
          shorter than its content, so the inner scroller never scrolls. */}
      <main className="mx-auto flex w-full max-w-5xl min-h-0 flex-1 flex-col px-4 pt-4 pb-20 sm:px-6 sm:pb-8">
        <InstallPrompt />
        <Outlet />
        {!onLive && <EventContact />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-edge bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `px-0.5 py-3 text-center text-[10px] font-semibold tracking-tight uppercase transition-colors ${
                isActive ? 'text-accent-text' : 'text-fg-subtle'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
