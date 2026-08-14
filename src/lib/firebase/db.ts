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

/**
 * Firestore paths.
 *
 * Everything an event owns lives in a subcollection under it. That is what lets
 * a security rule scope to a single event by path -- `match /events/{eventId}/…`
 * -- so a query can never accidentally return another event's data. The
 * alternative, a flat collection with an eventId field, relies on every query
 * and every rule remembering to filter, and fails silently when one forgets.
 */
export const collections = {
  events: 'events',
  /** Global, not per-event: a push token belongs to a device, not an event. */
  subscribers: 'subscribers',
} as const

/** Subcollections beneath `events/{code}`. */
export const eventCollections = {
  notices: 'notices',
  races: 'races',
  documents: 'documents',
  folders: 'folders',
  /** Valid competition licences, keyed by normalised licence number. */
  licences: 'licences',
  /** Filled forms, draft and submitted. Personal data — never public. */
  entries: 'entries',
} as const

type EventCollection = (typeof eventCollections)[keyof typeof eventCollections]

/** `events/KRC26/documents` — built here so the path shape lives in one place. */
export function eventPath(eventCode: string, sub: EventCollection): string {
  return `${collections.events}/${eventCode}/${sub}`
}
