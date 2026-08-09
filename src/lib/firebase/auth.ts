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
 * Whether a signed-in user may reach admin routes.
 *
 * Backed by a custom claim rather than a Firestore lookup: claims ride along in
 * the ID token, so this resolves offline and Firestore rules can enforce the
 * same check server-side. Set it with the `grantAdmin` callable in functions/.
 */
export async function isAdmin(user: User | null): Promise<boolean> {
  if (!user) return false
  const token = await user.getIdTokenResult()
  return token.claims.admin === true
}
