import type { Timestamp } from 'firebase/firestore'

/**
 * How loudly a notice presents. Maps onto the palette:
 * info -> neutral, warning -> yellow, urgent -> red.
 */
export type NoticeSeverity = 'info' | 'warning' | 'urgent'

export type Notice = {
  id: string
  title: string
  body: string
  severity: NoticeSeverity
  /** Optional link to a specific race; absent means event-wide. */
  raceId?: string
  /** Null while a locally-created notice waits for the server timestamp. */
  publishedAt: Timestamp | null
  pinned: boolean
}

export type Race = {
  id: string
  name: string
  category: string
  startsAt: Timestamp | null
  status: 'scheduled' | 'running' | 'finished' | 'cancelled'
}
