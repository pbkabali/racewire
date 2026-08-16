import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

/** One line a person can pass on to the organiser; never a stack trace. */
function describe(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`
  if (error instanceof Error) return error.message
  return ''
}

/**
 * Friendly catch-all for anything a route throws.
 *
 * Without it, react-router renders its developer-facing default — a raw stack
 * trace and a "Hey developer" hint — which is what people saw when the PDF
 * viewer crashed on older iPhones. Whatever breaks, the person gets two ways
 * out that do not depend on the app's own state: a reload, and a plain
 * full-page link back to the start.
 */
export function ErrorScreen() {
  const error = useRouteError()
  const detail = describe(error)

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
      <p className="text-3xl font-bold text-accent-text">Something went wrong</p>
      <p className="max-w-sm text-sm text-fg-muted">
        This page hit an unexpected error. Reloading usually clears it — if it
        keeps happening, tell the organiser what you were trying to open.
      </p>

      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-2 rounded-md bg-accent px-5 py-2 text-sm font-bold text-accent-fg"
      >
        Reload
      </button>
      {/* A real navigation, not a router Link: it must work even when the
          crash left the router's own state broken. */}
      <a href="/" className="text-sm font-semibold text-accent-text underline">
        Back to the start
      </a>

      {detail && <p className="mt-4 max-w-sm text-xs text-fg-subtle">{detail}</p>}
    </div>
  )
}
