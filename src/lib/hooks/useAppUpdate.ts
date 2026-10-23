import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Whether a new version is installed and waiting, and how to take it.
 *
 * The worker waits by design, so an update sits ready until every client of
 * the old one is gone -- which for an installed app means a full force-quit,
 * and in practice two cold starts before the new code runs. Nothing told
 * anybody that, so the only people who got an update promptly were the ones
 * whose phone happened to evict the app.
 *
 * `apply` is the only path to activation: it asks the waiting worker to take
 * over and reloads once it has. Never automatic. The entry form keeps its
 * answers in memory until an explicit Save, so a reload the app chose could
 * discard a half-filled entry at a moment of our choosing rather than the
 * competitor's.
 */
export function useAppUpdate(): { ready: boolean; apply: () => void } {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  /* Only a reload WE asked for should happen. A controller can change for
   * other reasons, and an unrequested reload is the behaviour being avoided. */
  const requested = useRef(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let cancelled = false

    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration || cancelled) return

      // Already waiting when this page loaded.
      if (registration.waiting) setWaiting(registration.waiting)

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return

        installing.addEventListener('statechange', () => {
          /*
           * `controller` is what separates an update from a first install.
           * Without it every first visit would be told a new version is
           * ready, which is true and useless.
           */
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(installing)
          }
        })
      })
    })

    const onControllerChange = () => {
      if (!requested.current) return
      requested.current = false
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  const apply = useCallback(() => {
    if (!waiting) return
    requested.current = true
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }, [waiting])

  return { ready: waiting !== null, apply }
}
