import { onAuthStateChanged } from 'firebase/auth'
import { useEffect, useState, type ReactNode } from 'react'

import { auth, NO_ADMIN, readAdminScope } from '../../lib/firebase/auth'
import { AuthContext, type AuthState } from './authContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    scope: NO_ADMIN,
    loading: true,
  })

  useEffect(() => {
    // Claim resolution is async, so a fast sign-out immediately after sign-in
    // could otherwise let the earlier lookup land last and restore admin.
    // Every auth event takes a ticket; only the newest one may write state.
    let generation = 0

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const ticket = ++generation

      if (!user) {
        setState({ user: null, scope: NO_ADMIN, loading: false })
        return
      }

      // Resolve claims before reporting ready, so ProtectedRoute never sees a
      // signed-in-but-claims-unknown state and bounces a real admin.
      readAdminScope(user)
        .then((scope) => {
          if (ticket === generation) setState({ user, scope, loading: false })
        })
        .catch(() => {
          if (ticket === generation) setState({ user, scope: NO_ADMIN, loading: false })
        })
    })

    return () => {
      generation++ // invalidate any in-flight claim lookup
      unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}
