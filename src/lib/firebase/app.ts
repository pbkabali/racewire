import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'

import { firebaseConfig } from './config'

/**
 * Single shared FirebaseApp instance.
 *
 * Guarded against double-init, which HMR would otherwise trigger on every
 * edit to a module in this folder.
 */
export const firebaseApp: FirebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig)
