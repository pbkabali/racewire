import { useEffect, useRef, useState } from 'react'
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
  const container = useRef<HTMLDivElement>(null)

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
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function toggle() {
    const next = !open
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
          /* Right-anchored and width-capped to the viewport so it cannot push
             the page sideways on a 390px phone. */
          className="absolute right-0 z-50 mt-2 max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-edge bg-surface shadow-lg"
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
