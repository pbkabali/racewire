import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { getMessagingIfSupported, registerForPush } from '../../lib/firebase/messaging'
import type { NoticeSeverity } from '../notices/types'
import { useNotificationFeed, type FeedItem } from './useNotificationFeed'

const severityChip: Record<NoticeSeverity, string> = {
  info: 'bg-surface-raised text-fg',
  warning: 'bg-accent text-accent-fg',
  urgent: 'bg-danger text-danger-fg',
}

/** Relative time, because "2h ago" is what matters at a rally, not the date. */
function ago(at: Date | null): string {
  if (!at) return 'just now'
  const seconds = Math.round((Date.now() - at.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

type PushState = 'unsupported' | 'off' | 'on' | 'denied' | 'working'

/**
 * The bell: what has been published, and whether this device gets told.
 *
 * It shows the same notices and documents as the tabs, which is the point --
 * somebody who was out on a stage when a bulletin landed needs one place that
 * says what they missed, without having to compare two lists against memory.
 */
export function NotificationCentre({ eventCode }: { eventCode: string }) {
  const { items, unread, markAllRead } = useNotificationFeed(eventCode)
  const [open, setOpen] = useState(false)
  const [push, setPush] = useState<PushState>('off')
  /** Viewport y the panel hangs from on phones, where it is position: fixed. */
  const [panelTop, setPanelTop] = useState(0)
  const container = useRef<HTMLDivElement>(null)

  const measure = useCallback(() => {
    const rect = container.current?.getBoundingClientRect()
    if (rect) setPanelTop(rect.bottom + 8)
  }, [])

  useEffect(() => {
    void getMessagingIfSupported().then((messaging) => {
      if (!messaging) return setPush('unsupported')
      if (Notification.permission === 'granted') return setPush('on')
      if (Notification.permission === 'denied') return setPush('denied')
      setPush('off')
    })
  }, [])

  // Close on outside click and on Escape: a panel that traps the next tap is
  // worse than no panel on a phone.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    /*
     * The header is not sticky, so it scrolls away under a fixed panel.
     * Re-measuring keeps the two together instead of leaving the panel
     * floating over the page with nothing above it.
     */
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [open, measure])

  function toggle() {
    const next = !open
    if (next) measure()
    setOpen(next)
    // Marked on open, not on close: opening is the act of reading, and a panel
    // dismissed by a stray tap should not silently clear a red flag.
    if (next) markAllRead()
  }

  async function enablePush() {
    setPush('working')
    try {
      const token = await registerForPush(eventCode)
      setPush(token ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off')
    } catch {
      setPush('off')
    }
  }

  return (
    <div ref={container} className="relative flex-none">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative rounded-md border border-edge px-2 py-1 text-sm text-fg"
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-danger px-1 text-[10px] leading-4 font-bold text-danger-fg"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          style={{ '--panel-top': `${panelTop}px` } as CSSProperties}
          /*
           * Fixed to the viewport on phones, absolute to the bell from `sm` up.
           *
           * `absolute right-0` alone put the panel's right edge against the
           * BELL's right edge, not the screen's -- and the bell is not the
           * last thing in the header, the theme toggle is. A 22rem panel hung
           * from there runs off the left of a 390px phone, which capping the
           * width cannot fix: the width was never the problem, the anchor was.
           *
           * Going fixed on small screens escapes that containing block
           * entirely and spans the viewport, inset to line up with the
           * header's own px-4 content edge. The vertical offset is measured
           * rather than hardcoded so it follows the header's real height,
           * safe-area inset included.
           */
          className="fixed inset-x-4 top-[var(--panel-top)] z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-edge bg-surface shadow-lg sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[22rem]"
        >
          {push !== 'on' && (
            <div className="border-b border-edge p-3 text-xs">
              {push === 'unsupported' ? (
                <p className="text-fg-subtle">
                  This browser cannot do push notifications. Install the app to your home
                  screen, or rely on SMS and WhatsApp.
                </p>
              ) : push === 'denied' ? (
                <p className="text-fg-subtle">
                  Notifications are blocked for this site. Re-enable them in your browser
                  settings to get alerts on this device.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => void enablePush()}
                  disabled={push === 'working'}
                  className="w-full rounded-md bg-accent px-3 py-2 font-semibold text-accent-fg disabled:opacity-60"
                >
                  {push === 'working' ? 'Enabling…' : 'Get alerts on this device'}
                </button>
              )}
            </div>
          )}

          {items.length === 0 ? (
            <p className="p-4 text-sm text-fg-subtle">Nothing published yet.</p>
          ) : (
            <ul className="divide-y divide-edge">
              {items.slice(0, 30).map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  eventCode={eventCode}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function NotificationRow({
  item,
  eventCode,
  onNavigate,
}: {
  item: FeedItem
  eventCode: string
  onNavigate: () => void
}) {
  return (
    <li>
      <Link
        to={`/e/${eventCode}/${item.to}`}
        onClick={onNavigate}
        className="block p-3 hover:bg-surface-raised"
      >
        <div className="mb-1 flex items-center gap-2">
          <span
            className={`flex-none rounded px-1.5 py-0.5 text-[10px] font-bold ${
              item.severity ? severityChip[item.severity] : 'bg-surface-raised text-fg'
            }`}
          >
            {item.type === 'document' ? 'DOC' : (item.severity ?? 'info').toUpperCase()}
          </span>
          <span className="ml-auto flex-none text-[11px] text-fg-subtle">{ago(item.at)}</span>
        </div>
        <p className="text-sm font-semibold text-fg">{item.title}</p>
        <p className="line-clamp-2 text-xs text-fg-muted">{item.body}</p>
      </Link>
    </li>
  )
}
