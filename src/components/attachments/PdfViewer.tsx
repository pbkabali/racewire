import { useEffect, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'

import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

/*
 * pdf.js renders to canvas, which is the only approach that reliably works
 * in-app on mobile: iOS Safari and Chrome on Android routinely refuse to
 * display a PDF in an iframe and force a download instead.
 *
 * The worker is resolved through `new URL(..., import.meta.url)` so Vite
 * fingerprints and serves it as a real asset -- a bare string path would break
 * once the app is deployed under a hashed filename.
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export function PdfViewer({ url, name }: { url: string; name: string }) {
  const [pages, setPages] = useState(0)
  const [page, setPage] = useState(1)
  const [width, setWidth] = useState(() => Math.min(window.innerWidth - 32, 900))
  const [error, setError] = useState<string | null>(null)

  // Re-fit on rotate/resize; a fixed width would overflow in landscape.
  useEffect(() => {
    const onResize = () => setWidth(Math.min(window.innerWidth - 32, 900))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-danger-text">Could not display this PDF: {error}</p>
        <a href={url} download={name} className="mt-2 inline-block text-sm underline text-accent-text">
          Download instead
        </a>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <Document
        file={url}
        onLoadSuccess={({ numPages }) => setPages(numPages)}
        onLoadError={(cause) => setError(cause.message)}
        loading={<div className="h-96 w-full animate-pulse rounded bg-surface-raised" />}
      >
        <Page
          pageNumber={page}
          width={width}
          renderTextLayer
          renderAnnotationLayer
          loading={<div className="h-96 w-full animate-pulse rounded bg-surface-raised" />}
        />
      </Document>

      {pages > 1 && (
        <div className="flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded border border-edge px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-fg-muted">
            {page} / {pages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="rounded border border-edge px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
