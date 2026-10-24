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
/*
 * Three different signals can conclude that the new worker is live, and any
 * of them may arrive first. Module scope rather than a ref, because a reload
 * tears the component down and the guard has to outlive it.
 */
let reloading = false

function reloadOnce() {
  if (reloading) return
  reloading = true
  window.location.reload()
}

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
      reloadOnce()
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

    /*
     * Reload when the new worker is actually running, rather than waiting for
     * controllerchange alone.
     *
     * controllerchange only fires for a page a worker already controls, and
     * an uncontrolled page is not an edge case: it is every first visit until
     * the worker activates and claims. Relying on it meant Reload did
     * everything right -- posted the message, activated the worker -- and
     * then sat there, which reads as a dead button.
     *
     * Watching the worker's own state covers both: controlled or not, it
     * reaches `activated`, and that is the moment the new assets are live.
     */
    const onStateChange = () => {
      if (waiting.state === 'activated') {
        waiting.removeEventListener('statechange', onStateChange)
        reloadOnce()
      }
    }

    if (waiting.state === 'activated') return reloadOnce()
    waiting.addEventListener('statechange', onStateChange)
    waiting.postMessage({ type: 'SKIP_WAITING' })

    /*
     * And a floor under it. Somebody who taps Reload has asked plainly; if
     * neither signal arrives -- a worker wedged mid-activation, a browser
     * that does not deliver the event -- reloading anyway is closer to what
     * they asked for than a button that quietly did nothing.
     */
    window.setTimeout(reloadOnce, 3000)
  }, [waiting])

  return { ready: waiting !== null, apply }
}
