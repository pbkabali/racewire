import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

import { firebaseApp } from './app'
import { useEmulators } from './config'

/**
 * Firestore configured for offline-first operation.
 *
 * `persistentLocalCache` keeps documents in IndexedDB, so the app reads and
 * writes normally with no connection: queries resolve from cache and writes
 * queue locally, then flush automatically when the network returns. This is
 * what lets the noticeboard keep working trackside on unstable mobile data.
 *
 * `persistentMultipleTabManager` shares that cache across tabs rather than
 * letting the first tab take an exclusive lock and the rest fall back to
 * memory-only.
 */
export const db: Firestore = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})

if (useEmulators) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}

/** Firestore collection names, centralised so they are not stringly-typed at call sites. */
export const collections = {
  notices: 'notices',
  races: 'races',
  subscribers: 'subscribers',
  admins: 'admins',
} as const
