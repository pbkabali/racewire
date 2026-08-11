import { lazy, Suspense, useEffect } from 'react'

import { downloadAttachment, type Attachment } from '../../lib/firebase/storage'

// pdf.js is heavy, so it loads only when a PDF is actually opened.
const PdfViewer = lazy(() =>
  import('./PdfViewer').then((m) => ({ default: m.PdfViewer })),
)

/** Full-screen viewer for one attachment. Escape and backdrop both close it. */
export function AttachmentViewer({
  attachment,
  onClose,
}: {
  attachment: Attachment
  onClose: () => void
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
          <Suspense
            fallback={
              <p className="py-10 text-center text-sm text-white/70">Loading viewer…</p>
            }
          >
            <PdfViewer url={attachment.url} name={attachment.name} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
