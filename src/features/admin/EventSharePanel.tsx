import { useEffect, useState } from 'react'

import type { Event } from '../events/types'

/**
 * Share panel: the public link for an event plus a QR code for print.
 *
 * The URL is built from `window.location.origin`, so a QR generated on staging
 * points at staging and one generated on production points at production.
 * Hardcoding the domain is how a poster ends up sending five hundred spectators
 * to a test board.
 */
export function EventSharePanel({ event }: { event: Event }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const url = `${window.location.origin}/e/${event.code}`

  useEffect(() => {
    let cancelled = false

    // qrcode is only ever needed on this panel, so it is loaded on demand
    // rather than bundled into the admin chunk.
    import('qrcode')
      .then((QRCode) =>
        QRCode.toDataURL(url, {
          width: 1024, // large enough to print at poster size without blurring
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' },
        }),
      )
      .then((generated) => {
        if (!cancelled) setDataUrl(generated)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not generate the QR code')
        }
      })

    return () => {
      cancelled = true
    }
  }, [url])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy. Select the link and copy it manually.')
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-edge bg-surface p-4">
      <div>
        <h2 className="font-semibold text-fg">Share this event</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Print the code for the paddock, or send the link. Both open this event
          directly — no need to pick it from a list.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-edge bg-bg px-3 py-2 font-mono text-xs text-fg"
        />
        <button
          type="button"
          onClick={() => void copy()}
          className="flex-none rounded-md border border-edge px-3 py-2 text-sm font-semibold text-fg"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}

      {dataUrl ? (
        <div className="flex flex-col items-center gap-3">
          {/* White plate always: a QR must be dark-on-light to scan, so it
              cannot follow the theme the way the rest of the UI does. */}
          <img
            src={dataUrl}
            alt={`QR code linking to ${url}`}
            className="h-48 w-48 rounded bg-white p-2"
          />
          <a
            href={dataUrl}
            download={`racewire-${event.code}-qr.png`}
            className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-fg"
          >
            Download QR code
          </a>
          <p className="text-center text-xs text-fg-subtle">
            1024px PNG. Print it at least 3cm across, and larger if people will
            scan it from more than arm's length.
          </p>
        </div>
      ) : (
        !error && <div className="mx-auto h-48 w-48 animate-pulse rounded bg-surface-raised" />
      )}
    </section>
  )
}
