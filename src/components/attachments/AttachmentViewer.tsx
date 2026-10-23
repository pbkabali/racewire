import { Component, lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'

import { downloadAttachment, type Attachment } from '../../lib/firebase/storage'
import { Spinner } from './PdfLoading'

// pdf.js is heavy, so it loads only when a PDF is actually opened.
const PdfViewer = lazy(() =>
  import('./PdfViewer').then((m) => ({ default: m.PdfViewer })),
)

/**
 * Catches the pdf.js chunk failing to load or evaluate.
 *
 * Even its legacy build needs roughly iOS 16.4; on anything older the module
 * throws while parsing, and without a boundary that error escaped to the
 * router's error page and took the whole app down with it. A class, because
 * error boundaries have no hook equivalent.
 */
class PdfBoundary extends Component<
  { fallback: (stale: boolean) => ReactNode; children: ReactNode },
  { failed: boolean; stale: boolean }
> {
  state = { failed: false, stale: false }

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    /*
     * Two very different faults land here and used to read as one.
     *
     * A genuinely old engine throws while parsing the module. A deploy that
     * replaced the chunk this page was built against fails to fetch it at
     * all -- nothing to do with the browser, and fixed by reloading. Telling
     * somebody their phone cannot show PDFs when the real answer is "pull to
     * reload" sends them off to find another device.
     */
    const stale =
      /dynamically imported module|Importing a module script failed|Failed to fetch|error loading/i.test(
        message,
      )
    return { failed: true, stale }
  }

  render() {
    return this.state.failed ? this.props.fallback(this.state.stale) : this.props.children
  }
}

/** Full-screen viewer for one attachment. Escape and backdrop both close it. */
export function AttachmentViewer({
  attachment,
  onClose,
  action,
}: {
  attachment: Attachment
  onClose: () => void
  /**
   * Optional primary action for this attachment, shown before Download.
   *
   * A slot rather than a `formType` prop: the viewer is shared with notice
   * attachments and has no business knowing what a form is. The caller that
   * does know supplies the button.
   */
  action?: ReactNode
}) {
  const header = useRef<HTMLElement>(null)

  /*
   * Keep the toolbar on screen while the page is pinch-zoomed.
   *
   * `position: fixed` anchors to the LAYOUT viewport, but pinch-zoom moves
   * the VISUAL viewport inside it. Zoom into a document and pan, and the
   * toolbar stays pinned to a corner of the page you are no longer looking
   * at -- so Close becomes unreachable and the only way out is to zoom all
   * the way back first. On a phone, where Escape does not exist, that was
   * the only way out at all.
   *
   * Counter-transforming by the visual viewport's offset and scale pins the
   * bar to what the reader can actually see, at a constant on-screen size.
   * Width stays 100%: an element scaled by 1/scale needs an unscaled width of
   * visualWidth * scale to cover the visible area, and that is exactly the
   * layout width it already has.
   *
   * At scale 1 this resolves to the identity transform, so the ordinary case
   * pays nothing and the bar sits in normal flow.
   */
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const pin = () => {
      const node = header.current
      if (!node) return
      node.style.transformOrigin = 'top left'
      node.style.transform =
        `translate(${viewport.offsetLeft}px, ${viewport.offsetTop}px) ` +
        `scale(${1 / viewport.scale})`
    }

    pin()
    viewport.addEventListener('resize', pin)
    viewport.addEventListener('scroll', pin)
    return () => {
      viewport.removeEventListener('resize', pin)
      viewport.removeEventListener('scroll', pin)
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)

    // Stop the board behind the overlay from scrolling with it.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onClick={onClose}
    >
      {/* Opaque and above the content: once zoomed, the bar floats over the
          page rather than sitting above it, and white-on-white is no more
          reachable than off-screen. */}
      <header
        ref={header}
        className="relative z-10 flex shrink-0 items-center gap-3 bg-black/90 px-4 py-3 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{attachment.name}</p>

        {action}

        <button
          type="button"
          onClick={() => void downloadAttachment(attachment)}
          className="rounded border border-white/30 px-3 py-1 text-xs font-semibold"
        >
          Download
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded border border-white/30 px-3 py-1 text-xs font-semibold"
        >
          Close
        </button>
      </header>

      {/* min-h-0 lets the flex child actually shrink; without it the PDF
          viewer's own scroller can never be shorter than its content, and the
          overlay grows instead of scrolling. Images scroll here, PDFs scroll
          internally, so only one scrollbar exists either way. */}
      <div
        className={`min-h-0 flex-1 p-4 ${
          attachment.kind === 'image' ? 'overflow-auto' : 'overflow-hidden'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        {attachment.kind === 'image' ? (
          <img
            src={attachment.url}
            alt={attachment.name}
            className="mx-auto max-h-full max-w-full object-contain"
          />
        ) : (
          <PdfBoundary
            fallback={(stale) => (
              <div className="flex h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-white/80">
                  {stale
                    ? 'The app was updated while this was open. Reload to view the document.'
                    : 'This browser cannot display the PDF inside the app.'}
                </p>

                {/* Offered rather than done automatically: a reload the app
                    chose could land mid-entry-form, which holds its answers
                    until an explicit Save. */}
                {stale && (
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="rounded border border-white/30 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Reload
                  </button>
                )}

                {/* iOS renders PDFs natively when navigated to directly, so
                    the same file that will not open here opens in a tab. */}
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`rounded border border-white/30 px-4 py-2 text-sm font-semibold text-white ${
                    stale ? 'border-white/20 text-white/80' : ''
                  }`}
                >
                  Open in browser
                </a>
                <button
                  type="button"
                  onClick={() => void downloadAttachment(attachment)}
                  className="text-sm text-white/70 underline"
                >
                  or download it
                </button>
              </div>
            )}
          >
            <Suspense
              // Covers fetching the pdf.js chunk itself, which is the first wait
              // and separate from downloading the document.
              fallback={
                <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
                  <Spinner className="h-8 w-8" />
                  <p className="text-sm text-white/70">Preparing viewer…</p>
                </div>
              }
            >
              <PdfViewer url={attachment.url} name={attachment.name} />
            </Suspense>
          </PdfBoundary>
        )}
      </div>
    </div>
  )
}
