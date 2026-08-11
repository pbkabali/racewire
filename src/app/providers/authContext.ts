import { createContext } from 'react'
import type { User } from 'firebase/auth'

import { NO_ADMIN, type AdminScope } from '../../lib/firebase/auth'

export type AuthState = {
  user: User | null
  scope: AdminScope
  /** True until the first auth state resolves; routes must wait on this. */
  loading: boolean
}

export const AuthContext = createContext<AuthState>({
  user: null,
  scope: NO_ADMIN,
  loading: true,
})
