import { useEffect, useState } from 'react'

import { getMessagingIfSupported, registerForPush } from '../../lib/firebase/messaging'

type PushState = 'unknown' | 'unsupported' | 'available' | 'enabled' | 'denied'

/**
 * Where spectators opt into alerts.
 *
 * In-browser push is wired up; WhatsApp and SMS sign-up are placeholders until
 * a provider is connected (see functions/src/notify/providers).
 */
export function AlertsPage() {
  const [state, setState] = useState<PushState>('unknown')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    getMessagingIfSupported().then((messaging) => {
      if (!active) return
      if (!messaging) return setState('unsupported')
      setState(Notification.permission === 'granted' ? 'enabled' : 'available')
    })
    return () => {
      active = false
    }
  }, [])

  async function enable() {
    setBusy(true)
    try {
      const token = await registerForPush()
      setState(token ? 'enabled' : 'denied')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-fg">Alerts</h1>

      <section className="rounded-lg border border-edge bg-surface p-4">
        <h2 className="font-semibold text-fg">Browser notifications</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Get notices pushed to this device, even when the app is closed.
        </p>

        <div className="mt-3">
          {state === 'enabled' && (
            <p className="text-sm font-semibold text-accent-text">Enabled on this device.</p>
          )}
          {state === 'denied' && (
            <p className="text-sm text-danger-text">
              Blocked. Re-enable notifications for this site in your browser settings.
            </p>
          )}
          {state === 'unsupported' && (
            <p className="text-sm text-fg-muted">
              Not available in this browser. On iPhone, add Racewire to your home screen first,
              or use SMS/WhatsApp below.
            </p>
          )}
          {state === 'available' && (
            <button
              type="button"
              onClick={enable}
              disabled={busy}
              className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-fg disabled:opacity-60"
            >
              {busy ? 'Enabling…' : 'Turn on notifications'}
            </button>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-edge bg-surface p-4 opacity-60">
        <h2 className="font-semibold text-fg">WhatsApp & SMS</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Coming soon — needs a messaging provider connected.
        </p>
      </section>
    </div>
  )
}
