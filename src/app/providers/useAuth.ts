import { useContext } from 'react'

import { AuthContext, type AuthState } from './authContext'

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
