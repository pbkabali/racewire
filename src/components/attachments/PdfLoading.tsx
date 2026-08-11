/**
 * Loading states for the PDF viewer, on the dark overlay scrim.
 *
 * Colours are fixed white here rather than theme tokens: the viewer always sits
 * on a black backdrop, so a theme-aware foreground would vanish in light mode.
 */

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-white/25 border-t-white/90 ${className}`}
    />
  )
}

/**
 * Shown while the file downloads, before any page can render.
 *
 * `percent` is null when the server sends no Content-Length, which happens
 * often enough that an indeterminate spinner has to be the fallback rather
 * than a progress bar stuck at zero.
 */
export function PdfDownloading({ percent }: { percent: number | null }) {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
      <Spinner className="h-8 w-8" />

      <div className="w-48 text-center">
        <p className="text-sm text-white/70">
          {percent === null ? 'Loading document…' : `Loading document… ${percent}%`}
        </p>

        {percent !== null && (
          <div className="mt-2 h-1 overflow-hidden rounded bg-white/15">
            <div
              className="h-full bg-white/80 transition-[width] duration-150"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Placeholder for a page that has not rendered yet.
 *
 * Sized to the real page box so the scroll position does not jump as pages
 * resolve beneath the reader.
 */
export function PdfPagePlaceholder({
  width,
  height,
  pageNumber,
}: {
  width: number
  height: number
  pageNumber: number
}) {
  return (
    <div
      className="flex animate-pulse flex-col items-center justify-center gap-3 rounded bg-white/10"
      style={{ width, height }}
    >
      <Spinner className="h-6 w-6" />
      <span className="text-xs text-white/50">Page {pageNumber}</span>
    </div>
  )
}
