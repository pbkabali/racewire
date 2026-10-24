import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import type { Sponsor } from './types'

/** The top-level collection of sponsors shown on every event and the picker. */
export const APP_SPONSORS = 'sponsors'

function useSponsorsAt(path: string): Sponsor[] {
  const [sponsors, setSponsors] = useState<Sponsor[]>([])

  useEffect(() => {
    const q = query(collection(db, path), orderBy('position', 'asc'))
    return onSnapshot(
      q,
      (snap) => setSponsors(snap.docs.map((d) => ({ ...(d.data() as Sponsor), id: d.id }))),
      // A sponsor board failing to load must never look like a broken page.
      // An empty board renders as nothing at all, which is the right fallback.
      () => setSponsors([]),
    )
  }, [path])

  return sponsors
}

/** Sponsors of the app itself, shown wherever the app is. */
export function useAppSponsors(): Sponsor[] {
  return useSponsorsAt(APP_SPONSORS)
}

/** Sponsors of one event, shown only within it. */
export function useEventSponsors(eventCode: string): Sponsor[] {
  return useSponsorsAt(eventPath(eventCode, eventCollections.sponsors))
}
