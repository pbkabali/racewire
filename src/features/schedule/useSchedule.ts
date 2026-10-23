import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import type { ScheduleItem } from './types'

type ScheduleState = {
  items: ScheduleItem[]
  loading: boolean
  error: Error | null
}

/** The event's programme, live and in the organiser's own order. */
export function useSchedule(eventCode: string): ScheduleState {
  const [state, setState] = useState<ScheduleState>({
    items: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    const q = query(
      collection(db, eventPath(eventCode, eventCollections.schedule)),
      orderBy('position', 'asc'),
    )
    return onSnapshot(
      q,
      (snap) => {
        setState({
          items: snap.docs.map((d) => ({ ...(d.data() as ScheduleItem), id: d.id })),
          loading: false,
          error: null,
        })
      },
      (error) => setState({ items: [], loading: false, error }),
    )
  }, [eventCode])

  return state
}
