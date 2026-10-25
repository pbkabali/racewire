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
    <section className="mt-4">
      <h2 className="mb-1.5 text-[10px] font-bold tracking-wide text-fg-subtle uppercase">
        {title}
      </h2>

      <ul
        ref={track}
        onPointerDown={() => setPaused(true)}
        onFocusCapture={() => setPaused(true)}
        /*
         * No negative margin: the strip sits inside the content box, flush
         * with the cards above it. Bleeding to the screen edge hinted that
         * it scrolls, but it also made the board the one element on the
         * page that ignored the page's own margins.
         *
         * Nothing to scroll-pad either, now that there is no padding for
         * snap-start to scroll past.
         */
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
      className="h-10 w-auto max-w-32 object-contain"
    />
  )

  /*
   * Sized down from h-16/h-12 with a 36px gap between rows. Two boards were
   * taking close to a quarter of a phone screen on the Live tab, which is
   * more than a board earns on the screen people watch results on.
   *
   * The logo only came down a step. These are text-heavy marks -- club
   * crests and wordmarks rather than symbols -- and the first thing lost
   * when they shrink is the word, which is the part the sponsor is paying
   * for. The chrome around them gave up more than they did.
   */
  const tile = 'flex h-14 min-w-24 items-center justify-center rounded-lg bg-white px-3'

  return sponsor.linkUrl ? (
    <a href={sponsor.linkUrl} target="_blank" rel="noreferrer" className={tile}>
      {logo}
    </a>
  ) : (
    <div className={tile}>{logo}</div>
  )
}
