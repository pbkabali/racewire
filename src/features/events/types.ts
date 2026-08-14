import type { Timestamp } from 'firebase/firestore'

/**
 * Where an event sits in its lifecycle. Drives grouping on the picker and the
 * badge on the event header; it is set by organisers rather than derived from
 * dates, because a postponed or abandoned event is not what the calendar says.
 */
export type EventStatus = 'live' | 'upcoming' | 'completed'

export const EVENT_STATUSES: EventStatus[] = ['live', 'upcoming', 'completed']

/** Common sports; the field is a plain string so an unlisted one still works. */
export const SPORT_TYPES = [
  'Rally',
  'Motocross',
  'Circuit racing',
  'Karting',
  'Cycling',
  'Athletics',
  'Motorcycling',
  'Other',
] as const

export type Event = {
  /**
   * Short code, uppercase, e.g. "KRC26". This is also the Firestore document
   * id and the URL segment (/e/KRC26), which is what makes it unique without
   * a separate uniqueness check -- creating a duplicate simply overwrites, and
   * the admin form guards against that explicitly.
   */
  code: string
  name: string
  countryCode: string
  countryName: string
  sportType: string
  status: EventStatus
  /**
   * Where a competitor should reach the organiser of *this* event.
   *
   * Optional because events created before these fields existed do not have
   * them, and because a new event is often set up before the organiser has
   * decided which address to publish.
   *
   * The email is what confirmation emails set as reply-to: they are sent from
   * a no-reply address on the app's own domain, and a competitor who replies
   * to that gets silence. Per-event rather than one global address because the
   * app carries several events at once and each has different organisers.
   *
   * Both are shown to the public, so use an address and number the organiser
   * is content to publish -- not a personal mobile.
   */
  contactEmail?: string
  contactPhone?: string
  /** Storage download URL. Empty string when no logo has been uploaded. */
  logoUrl: string
  /** Storage path, kept so the logo can be replaced or deleted later. */
  logoPath: string
  startsOn: Timestamp | null
  /** Same as startsOn for a single-day event. */
  endsOn: Timestamp | null
  createdAt: Timestamp | null
}

/** A single-level grouping for documents. Nesting is deliberately not supported. */
export type DocumentFolder = {
  id: string
  name: string
  /** Manual ordering; organisers care that "Bulletins" sits above "Results". */
  position: number
  createdAt: Timestamp | null
}

export type EventDocument = {
  id: string
  /** Organiser-assigned reference, e.g. "001" or "BUL-03". Shown before the name. */
  documentNumber: string
  name: string
  /** The date printed on the document, which is not the upload date. */
  documentDate: Timestamp | null
  /** Null means ungrouped; it still appears on the public page. */
  folderId: string | null
  /** Free text: revision note, applies-to, whatever the organiser needs. */
  notes: string
  /**
   * Set when this document is a fillable form, naming which one. Null for an
   * ordinary document. See src/features/forms/ for the definitions.
   */
  formType?: string | null

  fileName: string
  fileUrl: string
  filePath: string
  contentType: string
  size: number

  uploadedAt: Timestamp | null
  uploadedBy: string | null
}

export function formatEventDates(event: Event): string {
  if (!event.startsOn) return 'Dates to be confirmed'

  const start = event.startsOn.toDate()
  const end = event.endsOn?.toDate()

  const day = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const dayYear = (d: Date) =>
    d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

  if (!end || start.toDateString() === end.toDateString()) return dayYear(start)

  // Same month reads better collapsed: "12-14 Mar 2026" rather than repeating.
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  return sameMonth
    ? `${start.getDate()}–${dayYear(end)}`
    : `${day(start)} – ${dayYear(end)}`
}
