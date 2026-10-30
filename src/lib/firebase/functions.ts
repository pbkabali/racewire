import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'

import { firebaseApp } from './app'
import { useEmulators } from './config'

/**
 * Callable functions, pinned to the region they are deployed in.
 *
 * The region argument is load-bearing. getFunctions() defaults to
 * us-central1, while functions/src/index.ts sets europe-west1 globally, so
 * omitting it produces calls to a URL that does not exist -- surfacing as an
 * opaque "internal" error rather than anything that points at the cause.
 */
export const functions = getFunctions(firebaseApp, 'europe-west1')

if (useEmulators) {
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}

/**
 * Rebuild and republish an event's entry list now.
 *
 * The list is normally rebuilt by a trigger whenever an entry changes, so
 * this is for the cases that trigger cannot cover: an event whose entries all
 * arrived before the feature existed and so have never been written since, a
 * file removed by hand, or an organiser who wants to be certain before
 * printing.
 *
 * Resolves `{ rebuilt: false }` when the list was already current -- not an
 * error, and worth telling the organiser plainly rather than leaving them
 * wondering whether the button did anything.
 */
export const regenerateEntryList = httpsCallable<
  { eventId: string },
  { rebuilt: boolean; entries: number }
>(
  functions,
  'regenerateEntryList',
)

/**
 * Pull one event's live results from its sheet now.
 *
 * The schedule runs every two minutes; this is for the moment somebody has
 * just recomputed a classification and wants to see whether it published.
 * Errors come back with the Sheets message intact, because the two likely
 * faults -- a sheet never shared with the service account, a tab name that
 * does not exist -- are fixed in seconds by somebody who can read them.
 */
export const refreshLiveResults = httpsCallable<{ eventId: string }, { rows: number }>(
  functions,
  'refreshLiveResults',
)
