import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from './providers/useAuth'

/**
 * Gate for the admin section.
 *
 * This is a usability boundary, not a security one -- anyone can read the
 * bundle and render these components. Firestore rules are what actually
 * protect the data; see firestore.rules, which checks the same `admin` claim.
 */
export function ProtectedRoute() {
  const { user, admin, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <span className="animate-pulse text-sm tracking-widest text-accent-text uppercase">
          Checking access
        </span>
      </div>
    )
  }

  if (!user) {
    // Remember where they were headed so login can bounce them back.
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />
  }

  if (!admin) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <h1 className="text-xl font-bold text-danger-text">Not authorised</h1>
        <p className="text-sm text-fg-muted">
          This account is signed in but has no admin access.
        </p>
      </div>
    )
  }

  return <Outlet />
}
