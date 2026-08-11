import { useContext } from 'react'

import { EventContext, type EventState } from './eventContext'
import type { Event } from './types'

export function useEventState(): EventState {
  return useContext(EventContext)
}

/**
 * The current event, for screens rendered inside an event route.
 *
 * Throws rather than returning null: EventLayout only renders its children once
 * the event has resolved, so a null here is a routing bug, and failing loudly
 * beats every child screen null-checking something that cannot be null.
 */
export function useEvent(): Event {
  const { event } = useContext(EventContext)
  if (!event) {
    throw new Error('useEvent() called outside a resolved event route')
  }
  return event
}
