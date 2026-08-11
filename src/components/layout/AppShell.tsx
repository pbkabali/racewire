import { Link, NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '../../app/providers/useAuth'
import { formatEventDates } from '../../features/events/types'
import { useEvent } from '../../features/events/useEvent'
import { canManageEvent } from '../../lib/firebase/auth'
import { Brand } from '../Brand'
import { InstallPrompt } from '../InstallPrompt'
import { OfflineBanner } from '../OfflineBanner'
import { ThemeToggle } from '../ThemeToggle'

const navItems = [
  { to: '', label: 'Notices', end: true },
  { to: 'schedule', label: 'Schedule', end: false },
  { to: 'docs', label: 'Docs', end: false },
  { to: 'results', label: 'Results', end: false },
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

  return (
    <div className="flex min-h-dvh flex-col overscroll-none-y">
      <OfflineBanner />

      <header className="border-b border-edge bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex-none" aria-label="Choose a different event">
            <Brand creditFrom="sm" />
          </Link>

          <span className="mx-1 h-5 w-px flex-none bg-edge" aria-hidden />

          <span className="min-w-0 flex-1">
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
          </span>

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
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-20 sm:px-6 sm:pb-8">
        <InstallPrompt />
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-edge bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `py-3 text-center text-[11px] font-semibold tracking-wide uppercase transition-colors ${
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
