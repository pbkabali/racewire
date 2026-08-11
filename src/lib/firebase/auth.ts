import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth'

import { firebaseApp } from './app'
import { useEmulators } from './config'

export const auth: Auth = getAuth(firebaseApp)

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
}

export function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password)
}

export function signOut() {
  return firebaseSignOut(auth)
}

/**
 * What a signed-in user is allowed to administer.
 *
 * Backed by custom claims rather than a Firestore lookup: claims ride inside
 * the ID token, so they resolve offline and Firestore and Storage rules can
 * enforce exactly the same check server-side without a document read.
 */
export type AdminScope = {
  /** May administer every event, including creating and deleting them. */
  superAdmin: boolean
  /** Event codes this user may administer. Empty for a non-admin. */
  events: string[]
}

export const NO_ADMIN: AdminScope = { superAdmin: false, events: [] }

export async function readAdminScope(user: User | null): Promise<AdminScope> {
  if (!user) return NO_ADMIN

  const { claims } = await user.getIdTokenResult()

  // Defensive: claims are set by a script and could be malformed. A bad claim
  // should mean "no access", never a crash that leaves the UI stuck loading.
  const events = Array.isArray(claims.events)
    ? claims.events.filter((e): e is string => typeof e === 'string')
    : []

  return { superAdmin: claims.superAdmin === true, events }
}

/** Whether this scope may administer a specific event. */
export function canManageEvent(scope: AdminScope, eventCode: string | undefined): boolean {
  if (scope.superAdmin) return true
  if (!eventCode) return false
  return scope.events.includes(eventCode)
}

/** Whether this scope may administer anything at all — gates the admin area. */
export function isAnyAdmin(scope: AdminScope): boolean {
  return scope.superAdmin || scope.events.length > 0
}
