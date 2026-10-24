import { useEffect, useRef, useState } from 'react'

import type { Sponsor } from './types'

/** How long a logo holds before the strip moves on. */
const ADVANCE_MS = 3000
/** How long a touch stops it for, so a reader is never fought. */
const RESUME_MS = 8000

/**
 * One labelled row of sponsor logos.
 *
 * Each logo sits on a white tile rather than straight on the page. Sponsor
 * artwork is overwhelmingly dark-on-transparent, which on this app's dark
 * theme renders as an invisible rectangle -- the one failure a sponsor board
 * absolutely cannot have.
 *
 * Scroll-snap rather than a carousel library: the strip is a scroll
 * container, so it swipes natively, keeps its keyboard and screen-reader
 * behaviour, and costs nothing in the bundle.
 */
export function SponsorStrip({ title, sponsors }: { title: string; sponsors: Sponsor[] }) {
  const track = useRef<HTMLUListElement>(null)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || sponsors.length < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const id = window.setInterval(() => {
      const node = track.current
      if (!node) return

      const first = node.firstElementChild as HTMLElement | null
      const step = first ? first.offsetWidth + 12 : node.clientWidth

      /*
       * Wrap when the next step would run past the end. Compared with a
       * pixel of slack because scrollWidth and clientWidth disagree by
       * fractions at some zoom levels, which otherwise leaves the strip
       * stuck one step short and twitching against the end.
       */
      const atEnd = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1
      node.scrollTo({ left: atEnd ? 0 : node.scrollLeft + step, behavior: 'smooth' })
    }, ADVANCE_MS)

    return () => window.clearInterval(id)
  }, [paused, sponsors.length])

  /* Any touch or pointer stops it for a while. Nothing is more irritating
   * than a strip that scrolls out from under the logo being looked at. */
  useEffect(() => {
    if (!paused) return
    const id = window.setTimeout(() => setPaused(false), RESUME_MS)
    return () => window.clearTimeout(id)
  }, [paused])

  if (sponsors.length === 0) return null

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[10px] font-bold tracking-wide text-fg-subtle uppercase">
        {title}
      </h2>

      <ul
        ref={track}
        onPointerDown={() => setPaused(true)}
        onFocusCapture={() => setPaused(true)}
        /*
         * scroll-pl-4 is not decoration. snap-start aligns an item with the
         * snapport's start edge, and the snapport ignores padding unless
         * scroll-padding says otherwise -- so the browser scrolled the strip
         * by exactly the padding and sat the first logo flush against the
         * screen edge, out of line with everything above it.
         *
         * The negative margin is reset from sm up: bleeding to the edge
         * signals "this scrolls" on a phone, but inside a centred max-width
         * container on a desktop it just hangs out of alignment.
         */
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 scroll-pl-4 [scrollbar-width:none] sm:mx-0 sm:scroll-pl-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {sponsors.map((sponsor) => (
          <li key={sponsor.id} className="flex-none snap-start">
            <SponsorTile sponsor={sponsor} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function SponsorTile({ sponsor }: { sponsor: Sponsor }) {
  const logo = (
    <img
      src={sponsor.logoUrl}
      alt={sponsor.name}
      loading="lazy"
      className="h-12 w-auto max-w-36 object-contain"
    />
  )

  const tile = 'flex h-16 min-w-28 items-center justify-center rounded-lg bg-white px-4'

  return sponsor.linkUrl ? (
    <a href={sponsor.linkUrl} target="_blank" rel="noreferrer" className={tile}>
      {logo}
    </a>
  ) : (
    <div className={tile}>{logo}</div>
  )
}
