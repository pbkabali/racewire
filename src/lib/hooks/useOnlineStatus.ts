import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/**
 * Tracks browser connectivity.
 *
 * Note this reports whether the device has a network interface, not whether
 * Firestore has actually reached the backend -- a phone showing one bar at a
 * racecourse reads as "online" while requests still time out. Treat it as a
 * hint for the UI, and let Firestore's own cache handle correctness.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true, // assume online during SSR/prerender
  )
}
