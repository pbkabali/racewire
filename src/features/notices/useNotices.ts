import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { collections, db } from '../../lib/firebase/db'
import type { Notice } from './types'

export type NoticesState = {
  notices: Notice[]
  loading: boolean
  /**
   * True when the current results came from the local cache rather than the
   * server. Drives the "showing saved copy" hint so a marshal knows whether
   * they are looking at live data or the last-synced snapshot.
   */
  fromCache: boolean
  error: Error | null
}

export function useNotices(max = 100): NoticesState {
  const [state, setState] = useState<NoticesState>({
    notices: [],
    loading: true,
    fromCache: false,
    error: null,
  })

  useEffect(() => {
    const q = query(
      collection(db, collections.notices),
      orderBy('pinned', 'desc'),
      orderBy('publishedAt', 'desc'),
      limit(max),
    )

    // includeMetadataChanges lets the UI react when the same data flips from
    // cached to server-confirmed, which is invisible otherwise.
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setState({
          notices: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Notice),
          loading: false,
          fromCache: snap.metadata.fromCache,
          error: null,
        })
      },
      (error) => setState((s) => ({ ...s, loading: false, error })),
    )
  }, [max])

  return state
}
