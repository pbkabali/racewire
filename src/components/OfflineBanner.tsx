import { useOnlineStatus } from '../lib/hooks/useOnlineStatus'

/**
 * Persistent connectivity strip.
 *
 * Deliberately reassuring rather than alarming: the app genuinely keeps working
 * offline, so this explains the state instead of warning about it.
 */
export function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null

  return (
    <div
      role="status"
      className="sticky top-0 z-40 bg-flag-yellow px-4 py-2 text-center text-sm font-semibold text-track-black"
    >
      Offline — showing saved notices. New posts will send when you reconnect.
    </div>
  )
}
