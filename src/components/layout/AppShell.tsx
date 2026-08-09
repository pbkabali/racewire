import { NavLink, Outlet } from 'react-router-dom'

import { OfflineBanner } from '../OfflineBanner'

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

      <header className="hidden border-b border-asphalt-light bg-asphalt sm:block">
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
                      ? 'bg-flag-yellow text-track-black'
                      : 'text-zinc-400 hover:text-zinc-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <div className="border-b border-asphalt-light bg-asphalt px-4 py-3 sm:hidden">
        <Brand />
      </div>

      {/* pb-20 clears the fixed mobile tab bar. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 pt-4 sm:px-6 sm:pb-8">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-asphalt-light bg-asphalt pb-[env(safe-area-inset-bottom)] sm:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `py-3 text-center text-xs font-semibold tracking-wide uppercase transition-colors ${
                isActive ? 'text-flag-yellow' : 'text-zinc-500'
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
      <span className="h-5 w-1.5 rounded-sm bg-flag-red" aria-hidden />
      <span className="text-zinc-100">
        race<span className="text-flag-yellow">wire</span>
      </span>
    </span>
  )
}
