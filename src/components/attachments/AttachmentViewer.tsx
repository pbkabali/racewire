import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react'

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
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
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
      <header
        className="flex items-center gap-3 px-4 py-3 text-white"
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
            fallback={
              <div className="flex h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-white/80">
                  This browser cannot display the PDF inside the app.
                </p>
                {/* iOS renders PDFs natively when navigated to directly, so
                    the same file that will not open here opens in a tab. */}
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-white/30 px-4 py-2 text-sm font-semibold text-white"
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
            }
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
