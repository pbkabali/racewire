import type { Timestamp } from 'firebase/firestore'

/**
 * A sponsor's board entry.
 *
 * The same shape at both levels. An app sponsor lives in the top-level
 * `sponsors` collection and appears everywhere; an event sponsor lives under
 * its event and appears only there. Keeping one type means one upload path,
 * one admin row and one carousel, which is what stops the two drifting into
 * subtly different things.
 */
export type Sponsor = {
  id: string
  name: string
  /** Storage download URL. */
  logoUrl: string
  /** Storage path, kept so the logo can be replaced or deleted later. */
  logoPath: string
  /** Optional: the logo becomes a link when set. */
  linkUrl?: string
  /** Manual ordering. A sponsor board is never alphabetical. */
  position: number
  createdAt: Timestamp | null
}
