import { doc, onSnapshot, type Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'

export type LiveResults = {
  header: string[]
  rows: string[][]
  fetchedAt: Timestamp | null
  sourceRange: string
}

/**
 * The standings, as last mirrored from the organiser's sheet.
 *
 * A live listener rather than a fetch: the sync rewrites one document every
 * couple of minutes, and a snapshot means the table on a phone in a service
 * park updates without anybody pulling to refresh.
 */
export function useLiveResults(eventCode: string): {
  results: LiveResults | null
  loading: boolean
} {
  const [results, setResults] = useState<LiveResults | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    return onSnapshot(
      doc(db, eventPath(eventCode, eventCollections.liveResults), 'current'),
      (snap) => {
        setResults(snap.exists() ? (snap.data() as LiveResults) : null)
        setLoading(false)
      },
      () => {
        setResults(null)
        setLoading(false)
      },
    )
  }, [eventCode])

  return { results, loading }
}
