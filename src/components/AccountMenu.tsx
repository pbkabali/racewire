import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../app/providers/useAuth'
import { isAnyAdmin, signOut } from '../lib/firebase/auth'

/**
 * Who is signed in, and the way out.
 *
 * Sign out used to exist only on the two admin screens, so anybody who
 * wandered into the public board was stuck: no way to leave the session and
 * nothing on screen saying there was a session to leave. On a shared phone in
 * a service park that is worse than an inconvenience -- the next person to
 * pick it up is quietly still the last person's admin.
 *
 * Rendered only when somebody is signed in. A spectator sees nothing new;
 * they have no account and a Sign in button would just be clutter on a board
 * that is meant to be read, not logged into.
 */
export function AccountMenu({ eventCode }: { eventCode?: string }) {
  const { user, scope } = useAuth()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  /*
   * Close on anything that means "I am done here": a click elsewhere, or
   * Escape. Both listeners are bound only while the menu is open, so a closed
   * menu costs nothing on a page that is already listening for a lot.
   */
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Nothing to offer a signed-out visitor.
  if (!user) return null

  const email = user.email ?? 'Signed in'
  const initial = email.charAt(0).toUpperCase()
  const admin = isAnyAdmin(scope)

  /*
   * Where Manage goes depends on where you are. Inside an event, the useful
   * destination is that event's dashboard; anywhere else it is the list.
   */
  const manageTo = eventCode ? `/admin/e/${eventCode}` : '/admin'

  async function leave(thenSignIn: boolean) {
    setOpen(false)
    await signOut()

    /*
     * Signing out of an admin screen leaves you looking at a page you may no
     * longer read, so go somewhere public. From the board itself there is
     * nothing to flee -- the board is public -- so stay put and let the
     * header simply lose its menu.
     */
    if (thenSignIn) navigate('/admin/login', { replace: true })
    else if (location.pathname.startsWith('/admin')) navigate('/', { replace: true })
  }

  return (
    <div ref={box} className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        /* The initial, not a generic person glyph: on a device two officials
           share, the point of this control is telling you at a glance which
           of them the app currently thinks you are. */
        className="flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-surface-raised text-xs font-bold text-fg"
      >
        <span aria-hidden>{initial}</span>
        <span className="sr-only">Account: {email}</span>
      </button>

      {open && (
        /* Right-aligned and above everything: the header sits in a column
           that clips on the Live tab, but the menu stays inside the viewport
           so it overlays the page rather than being cut off by it. */
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-edge bg-surface shadow-lg"
        >
          <div className="border-b border-edge px-3 py-2">
            <p className="truncate text-xs font-semibold text-fg">{email}</p>
            <p className="mt-0.5 text-[10px] text-fg-subtle">
              {scope.superAdmin
                ? 'Super admin'
                : scope.events.length > 0
                  ? `Admin · ${scope.events.join(', ')}`
                  : 'Signed in'}
            </p>
          </div>

          {admin && (
            <Link
              to={manageTo}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-fg hover:bg-surface-raised"
            >
              Manage
            </Link>
          )}

          {/*
           * Switching is sign out followed by sign in, because Firebase keeps
           * one signed-in user per app and holding two at once would mean
           * holding two sets of credentials. Offered as its own item anyway:
           * "sign out, find the login page, sign in" is the same work done
           * blind, and the whole reason somebody signs out on a rally morning
           * is to become somebody else.
           */}
          <button
            type="button"
            role="menuitem"
            onClick={() => void leave(true)}
            className="block w-full px-3 py-2 text-left text-sm text-fg hover:bg-surface-raised"
          >
            Switch account
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => void leave(false)}
            className="block w-full border-t border-edge px-3 py-2 text-left text-sm text-danger-text hover:bg-surface-raised"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
