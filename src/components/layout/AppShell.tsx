import { NavLink, Outlet } from 'react-router-dom'

import { OfflineBanner } from '../OfflineBanner'
import { ThemeToggle } from '../ThemeToggle'

const navItems = [
  { to: '/', label: 'Notices', end: true },
  { to: '/schedule', label: 'Schedule', end: false },
  { to: '/alerts', label: 'Alerts', end: false },
]

/**
 * Mobile-first chrome: bottom tab bar on phones (thumb reach), promoted to a
 * top bar from `sm` up where a bottom bar would look out of place.
 */
export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col overscroll-none-y">
      <OfflineBanner />

      <header className="hidden border-b border-edge bg-surface sm:block">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
          <Brand />
          <nav className="flex gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-accent text-accent-fg'
                      : 'text-fg-muted hover:text-fg'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex items-center border-b border-edge bg-surface px-4 py-3 sm:hidden">
        <Brand />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>

      {/* pb-20 clears the fixed mobile tab bar. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 pt-4 sm:px-6 sm:pb-8">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-edge bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `py-3 text-center text-xs font-semibold tracking-wide uppercase transition-colors ${
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

function Brand() {
  return (
    <span className="flex items-center gap-2 text-lg font-bold tracking-tight">
      <span className="h-5 w-1.5 rounded-sm bg-danger" aria-hidden />
      <span className="text-fg">
        race<span className="text-accent-text">wire</span>
      </span>
    </span>
  )
}
