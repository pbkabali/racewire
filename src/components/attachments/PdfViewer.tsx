import { useEffect, useRef, useState } from 'react'
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
  const [visiblePage, setVisiblePage] = useState(1)
  const [width, setWidth] = useState(() => Math.min(window.innerWidth - 32, 900))
  const [error, setError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])

  // Re-fit on rotate/resize; a fixed width would overflow in landscape.
  useEffect(() => {
    const onResize = () => setWidth(Math.min(window.innerWidth - 32, 900))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /*
   * Track which page is in view for the counter.
   *
   * IntersectionObserver rather than a scroll handler: it fires only on
   * threshold crossings instead of on every frame of a scroll, which matters on
   * a phone rendering full-page canvases.
   */
  useEffect(() => {
    if (!pages) return

    const observer = new IntersectionObserver(
      (entries) => {
        // The most-visible page wins, so a partially-scrolled boundary does not
        // flicker the counter between two pages.
        const best = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (best) {
          const page = Number((best.target as HTMLElement).dataset.page)
          if (page) setVisiblePage(page)
        }
      },
      { root: scrollRef.current, threshold: [0.1, 0.5, 0.9] },
    )

    for (const element of pageRefs.current) {
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [pages])

  function jumpTo(page: number) {
    const target = Math.min(Math.max(page, 1), pages)
    pageRefs.current[target - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-danger-text">Could not display this PDF: {error}</p>
        <a
          href={url}
          download={name}
          className="mt-2 inline-block text-sm text-accent-text underline"
        >
          Download instead
        </a>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <Document
          file={url}
          onLoadSuccess={({ numPages }) => setPages(numPages)}
          onLoadError={(cause) => setError(cause.message)}
          loading={<div className="mx-auto h-96 w-full max-w-3xl animate-pulse rounded bg-white/10" />}
          className="flex flex-col items-center gap-4 py-2"
        >
          {Array.from({ length: pages }, (_, index) => (
            <div
              key={index}
              data-page={index + 1}
              ref={(element) => {
                pageRefs.current[index] = element
              }}
              className="scroll-mt-2"
            >
              <Page
                pageNumber={index + 1}
                width={width}
                renderTextLayer
                renderAnnotationLayer
                loading={
                  <div
                    className="animate-pulse rounded bg-white/10"
                    // Roughly A4 so the placeholder does not collapse and make
                    // the scroll position jump as pages resolve.
                    style={{ width, height: width * 1.414 }}
                  />
                }
              />
            </div>
          ))}
        </Document>
      </div>

      {pages > 1 && (
        <div className="flex flex-none items-center justify-center gap-4 py-2 text-sm text-white">
          <button
            type="button"
            onClick={() => jumpTo(visiblePage - 1)}
            disabled={visiblePage <= 1}
            className="rounded border border-white/30 px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="tabular-nums text-white/70">
            {visiblePage} / {pages}
          </span>
          <button
            type="button"
            onClick={() => jumpTo(visiblePage + 1)}
            disabled={visiblePage >= pages}
            className="rounded border border-white/30 px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
