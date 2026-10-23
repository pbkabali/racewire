import { useState } from 'react'

import { useAppUpdate } from '../lib/hooks/useAppUpdate'

/**
 * Offers a waiting update, rather than leaving people to find it.
 *
 * The worker waits on purpose, so without this an update reaches an installed
 * app only after it is fully closed and reopened -- and nobody is told to do
 * that. A spectator could read last week's board all rally weekend and have
 * no way to know.
 *
 * Dismissible, and that matters more than it looks: somebody halfway through
 * the entry form must be able to finish it. The form holds its answers until
 * an explicit Save, so reloading is the competitor's decision to make, not
 * ours. Dismissing lasts the session -- the next launch offers it again, by
 * which point whatever they were doing is done.
 */
export function UpdateBanner() {
  const { ready, apply } = useAppUpdate()
  const [dismissed, setDismissed] = useState(false)

  if (!ready || dismissed) return null

  return (
    <div
      role="status"
      /* Fixed and above everything, including the viewer overlay: the update
         is worth seeing wherever somebody happens to be. The inset keeps it
         clear of the notch on a phone. */
      className="fixed inset-x-0 top-0 z-[60] flex items-center gap-3 bg-accent px-4 text-accent-fg"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)', paddingBottom: '0.5rem' }}
    >
      <p className="min-w-0 flex-1 text-sm font-semibold">A new version is ready.</p>

      <button
        type="button"
        onClick={apply}
        className="flex-none rounded border border-accent-fg/40 px-3 py-1 text-xs font-bold"
      >
        Reload
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Not now"
        className="flex-none rounded px-2 py-1 text-sm font-bold"
      >
        ✕
      </button>
    </div>
  )
}
