import { doc, onSnapshot, type Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'

export type LiveResults = {
  header: string[]
  /*
   * Rows arrive wrapped -- `{ cells }` rather than a bare array -- because
   * Firestore will not store an array of arrays. The wrapping is a storage
   * constraint, so it is unwrapped here and the table renders plain rows.
   */
  rows: { cells: string[] }[]
  fetchedAt: Timestamp | null
  sourceRange: string
}

/**
 * The standings, as last mirrored from the organiser's sheet.
 *
 * A live listener rather than a fetch: the sync rewrites one document every
 * 30 seconds, and a snapshot means the table on a phone in a service park
 * updates without anybody pulling to refresh.
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
