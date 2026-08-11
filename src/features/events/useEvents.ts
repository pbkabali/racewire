import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { collections, db } from '../../lib/firebase/db'
import type { Event, EventStatus } from './types'

type EventsState = {
  events: Event[]
  loading: boolean
  /** True when served from the offline cache rather than the server. */
  fromCache: boolean
  error: Error | null
}

/** Live list of all events, ordered soonest-first. */
export function useEvents(): EventsState {
  const [state, setState] = useState<EventsState>({
    events: [],
    loading: true,
    fromCache: false,
    error: null,
  })

  useEffect(() => {
    const q = query(collection(db, collections.events), orderBy('startsOn', 'desc'))

    return onSnapshot(
      q,
      (snap) => {
        setState({
          // The document id IS the event code, so it is spread last to win over
          // any stale `code` field that drifted in the stored document.
          events: snap.docs.map((d) => ({ ...(d.data() as Event), code: d.id })),
          loading: false,
          fromCache: snap.metadata.fromCache,
          error: null,
        })
      },
      (error) => setState({ events: [], loading: false, fromCache: false, error }),
    )
  }, [])

  return state
}

/** Live first, then upcoming, then completed — how an organiser scans the list. */
export const STATUS_ORDER: EventStatus[] = ['live', 'upcoming', 'completed']

export function groupByStatus(events: Event[]): Record<EventStatus, Event[]> {
  const groups: Record<EventStatus, Event[]> = { live: [], upcoming: [], completed: [] }
  for (const event of events) {
    // An unrecognised status must not vanish from the picker.
    ;(groups[event.status] ?? groups.upcoming).push(event)
  }
  return groups
}
