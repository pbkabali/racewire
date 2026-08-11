import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'

import { canManageEvent, isAnyAdmin } from '../lib/firebase/auth'
import { useAuth } from './providers/useAuth'

/**
 * Gates the admin area.
 *
 * Convenience only — it hides UI, it does not protect data. Firestore and
 * Storage rules check the same claims server-side; see firestore.rules.
 */
export function ProtectedRoute() {
  const { user, scope, loading } = useAuth()
  const { code } = useParams<{ code: string }>()
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

  if (!isAnyAdmin(scope)) {
    return (
      <Denied detail="This account is signed in but has no admin access to any event." />
    )
  }

  // On a per-event route, being an admin somewhere is not enough.
  if (code && !canManageEvent(scope, code.toUpperCase())) {
    return (
      <Denied
        detail={`This account cannot manage ${code.toUpperCase()}. Ask a super admin to grant access.`}
      />
    )
  }

  return <Outlet />
}

function Denied({ detail }: { detail: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
      <h1 className="text-xl font-bold text-danger-text">Not authorised</h1>
      <p className="max-w-sm text-sm text-fg-muted">{detail}</p>
      <a href="/" className="mt-2 text-sm font-semibold text-accent-text underline">
        Back to events
      </a>
    </div>
  )
}
