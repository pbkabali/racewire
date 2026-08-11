import { useEffect, useState } from 'react'

/**
 * Chrome fires this so a site can offer installation at a sensible moment
 * rather than the browser nagging. It is not in lib.dom, hence the local type.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'racewire:install-dismissed'

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS predates the standard and still reports through this.
    (navigator as { standalone?: boolean }).standalone === true
  )
}

function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports as a Mac; the touch check separates it from a real one.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/**
 * Offers "add to home screen", so the board opens in one tap.
 *
 * Two very different paths:
 *
 * - Chrome/Android gives us `beforeinstallprompt`, so we can install properly.
 * - iOS Safari has no install API at all. The only route is Share → Add to
 *   Home Screen, so all we can do is tell people where it is. Worth doing
 *   rather than skipping, because iOS ALSO gates web push behind installing —
 *   an iPhone user who never installs can never receive a notification.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosHint, setShowIosHint] = useState(false)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    // Never prompt inside the installed app itself.
    if (isStandalone()) return

    let wasDismissed = false
    try {
      wasDismissed = localStorage.getItem(DISMISSED_KEY) === '1'
    } catch {
      // Private mode with storage blocked: treat as not dismissed.
    }
    if (wasDismissed) return

    setDismissed(false)
    if (isIos()) setShowIosHint(true)

    const onPrompt = (event: Event) => {
      // Stop Chrome's own mini-infobar so ours is the only offer.
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  function close() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Nothing to do; it will simply offer again next visit.
    }
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    // Single-use: the event cannot be replayed, and Chrome will fire a fresh
    // one on a later visit if they declined.
    setDeferred(null)
    close()
  }

  if (dismissed || (!deferred && !showIosHint)) return null

  return (
    <div className="mb-3 flex items-start gap-3 rounded-lg border border-accent/40 bg-surface p-3">
      <img
        src="/icons/icon-192.png"
        alt=""
        width={36}
        height={36}
        className="mt-0.5 h-9 w-9 flex-none rounded"
      />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">Add Racewire to your home screen</p>

        {deferred ? (
          <p className="mt-0.5 text-xs text-fg-muted">
            Opens in one tap and keeps working without signal.
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-fg-muted">
            Tap <span aria-label="the Share button">Share</span> in Safari, then{' '}
            <strong className="font-semibold text-fg">Add to Home Screen</strong>.
          </p>
        )}

        {deferred && (
          <button
            type="button"
            onClick={() => void install()}
            className="mt-2 rounded-md bg-accent px-3 py-1.5 text-sm font-bold text-accent-fg"
          >
            Install
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="flex-none rounded p-1 text-fg-subtle hover:text-fg"
      >
        ✕
      </button>
    </div>
  )
}
