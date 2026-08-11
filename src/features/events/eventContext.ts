import { createContext } from 'react'

import type { Event } from './types'

export type EventState = {
  /** Null while loading, or when the code in the URL matches no event. */
  event: Event | null
  loading: boolean
  error: Error | null
}

export const EventContext = createContext<EventState>({
  event: null,
  loading: true,
  error: null,
})
