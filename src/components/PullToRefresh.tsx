import { useEffect, useRef, useState } from 'react'

/** Pull distance, after resistance, that arms the refresh. */
const THRESHOLD = 70

/**
 * An installed app has no browser chrome, and with it loses the native
 * pull-to-refresh people reach for by habit. In a browser tab that gesture
 * still belongs to the browser, so this stays inert there — detection at
 * mount is enough, since install state cannot change mid-session.
 */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's pre-standard flag; still how an installed PWA reports itself.
    ('standalone' in navigator &&
      (navigator as { standalone?: boolean }).standalone === true)
  )
}

/**
 * Pull-to-refresh for the installed app: dragging down from the top of the
 * page shows an indicator and, past the threshold, reloads. A reload rather
 * than anything cleverer on purpose — the data is live already, so what a
 * refresh means to people is "give me a fresh copy of the app", and a reload
 * is also what picks up a waiting service-worker update.
 */
export function PullToRefresh() {
  const [enabled] = useState(isStandalone)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  // The touch handlers read these; state alone would go stale inside them.
  const pullRef = useRef(0)
  const startY = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    const atTop = () => (document.scrollingElement?.scrollTop ?? 0) <= 0

    /*
     * A pull that starts inside an open overlay (body scroll locked) or a
     * scrolled inner container belongs to that surface, not to the page —
     * without this, scrolling back up a long PDF would reload the app.
     */
    const claimedElsewhere = (target: EventTarget | null) => {
      if (document.body.style.overflow === 'hidden') return true
      for (let el = target as HTMLElement | null; el; el = el.parentElement) {
        if (el.scrollTop > 0) return true
      }
      return false
    }

    const onTouchStart = (event: TouchEvent) => {
      startY.current =
        atTop() && !claimedElsewhere(event.target)
          ? event.touches[0].clientY
          : null
    }

    const onTouchMove = (event: TouchEvent) => {
      if (startY.current === null) return
      const delta = event.touches[0].clientY - startY.current
      if (delta <= 0 || !atTop()) {
        startY.current = null
        pullRef.current = 0
        setPull(0)
        return
      }
      // Ours now: without this iOS spends the gesture on rubber-banding.
      if (event.cancelable) event.preventDefault()
      // Divided for resistance, so the indicator trails the finger like the
      // native gesture does instead of gluing to it.
      pullRef.current = Math.min(delta / 2.5, THRESHOLD + 26)
      setPull(pullRef.current)
    }

    const onTouchEnd = () => {
      if (startY.current !== null && pullRef.current >= THRESHOLD) {
        setRefreshing(true)
        window.location.reload()
      } else {
        setPull(0)
      }
      startY.current = null
      pullRef.current = 0
    }

    // touchmove must be non-passive or preventDefault above is ignored.
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd)
    document.addEventListener('touchcancel', onTouchEnd)
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [enabled])

  if (!enabled || (pull === 0 && !refreshing)) return null

  const armed = refreshing || pull >= THRESHOLD

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center"
      style={{ transform: `translateY(${Math.round(pull) - 44}px)` }}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-edge bg-surface shadow-lg">
        {refreshing ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        ) : (
          <svg
            viewBox="0 0 20 20"
            className={`h-5 w-5 text-accent-text transition-transform ${armed ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 4v12M5 11l5 5 5-5" />
          </svg>
        )}
      </div>
    </div>
  )
}
