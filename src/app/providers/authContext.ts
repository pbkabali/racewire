import { createContext } from 'react'
import type { User } from 'firebase/auth'

export type AuthState = {
  user: User | null
  admin: boolean
  /** True until the first auth state resolves; routes must wait on this. */
  loading: boolean
}

/**
 * Lives apart from AuthProvider.tsx so that file exports only a component,
 * which is what keeps React Fast Refresh working for it.
 */
export const AuthContext = createContext<AuthState>({
  user: null,
  admin: false,
  loading: true,
})
