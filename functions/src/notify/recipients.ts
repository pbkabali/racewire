import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'

import { toE164 } from './phone.js'
import type { Channel } from './types.js'

/** Where a recipient came from, kept on the audit record so a send is explainable. */
export type RecipientSource = 'entry' | 'contact' | 'device'

export type Recipient = {
  /** E.164 phone number, or an FCM registration token for push. */
  to: string
  channel: Channel
  source: RecipientSource
  /** Who this is, for the organiser reading the log. Never shown to the public. */
  label: string
}

/** The three people an entry can name, in the order they are preferred. */
const PARTIES = ['entrant', 'driver', 'codriver'] as const

/**
 * One number per person, not every number they gave.
 *
 * The form asks for a Uganda number and a usual number, which for a visiting
 * crew are two different lines and for a local entrant are usually the same.
 * Taking both would text half the field twice; the local number is preferred
 * because it is the one that works at the stage.
 */
const PHONE_ROWS = ['phoneUganda', 'phoneUsual'] as const

type ContactDoc = {
  name?: string
  phone?: string
  role?: string
  /**
   * Per-contact channel opt-out. Absent means both, which is what an admin
   * adding a number to a notification list intends.
   */
  channels?: Channel[]
  /**
   * Reserved. Consent is currently implied by being on the list; when an
   * explicit opt-in is added, filtering on this field is the only change
   * needed here.
   */
  consent?: boolean
}

export type RecipientResolution = {
  recipients: Recipient[]
  /** Numbers that could not be read as a phone number, for the organiser to fix. */
  rejected: { raw: string; label: string }[]
  /** How many duplicates were collapsed, so a surprising count is explainable. */
  deduped: number
}

/**
 * Everyone who should hear about something happening at this event.
 *
 * Three sources, one deduplicated list:
 *   entries   every party named on a submitted entry
 *   contacts  officials, media and marshals an admin added by hand
 *   devices   browsers registered for push against this event
 *
 * Deduplication is by normalised number, and it matters more than it looks.
 * An entrant is very often also the driver, and a team manager's number
 * appears on every car they run -- without this, one notice arrives six times
 * and people start muting the channel that exists to tell them a stage is
 * closed.
 *
 * Drafts are excluded. A half-filled form is not yet a competitor, and the
 * number on it has not agreed to anything.
 */
export async function resolveRecipients(
  eventCode: string,
  countryCode: string | undefined,
): Promise<RecipientResolution> {
  const db = getFirestore()
  const eventRef = db.collection('events').doc(eventCode)

  const [entries, contacts, devices] = await Promise.all([
    eventRef.collection('entries').where('status', '==', 'submitted').get(),
    eventRef.collection('contacts').get(),
    db.collection('subscribers').where('events', 'array-contains', eventCode).get(),
  ])

  /** normalised number -> the first recipient claiming it */
  const byNumber = new Map<string, Recipient>()
  const rejected: { raw: string; label: string }[] = []
  let deduped = 0

  const addPhone = (raw: string | undefined, label: string, source: RecipientSource) => {
    if (!raw?.trim()) return
    const number = toE164(raw, countryCode)
    if (!number) {
      rejected.push({ raw: raw.trim(), label })
      return
    }
    if (byNumber.has(number)) {
      deduped++
      return
    }
    // One entry per number per channel; which channels actually run is decided
    // by dispatch, from what is configured.
    byNumber.set(number, { to: number, channel: 'sms', source, label })
  }

  for (const document of entries.docs) {
    const data = document.data()
    const values = (data.values ?? {}) as Record<string, string>
    const licence = String(data.licenceNumber ?? document.id)

    for (const party of PARTIES) {
      const raw = PHONE_ROWS.map((row) => values[`contact.${row}.${party}`]).find((v) =>
        v?.trim(),
      )
      const name =
        [values[`identity.firstName.${party}`], values[`identity.familyName.${party}`]]
          .filter(Boolean)
          .join(' ') ||
        values[`identity.entrantName.${party}`] ||
        party
      addPhone(raw, `${licence} ${party} ${name}`.trim(), 'entry')
    }

    /*
     * The OTP number, only if the form named none. It is whoever filled the
     * entry -- often a team manager rather than the crew -- so it is a
     * fallback for reaching the car at all, not a preferred address.
     */
    const named = PARTIES.some((party) =>
      PHONE_ROWS.some((row) => values[`contact.${row}.${party}`]?.trim()),
    )
    if (!named) addPhone(data.phone as string | undefined, `${licence} (form filler)`, 'entry')
  }

  for (const document of contacts.docs) {
    const data = document.data() as ContactDoc
    addPhone(data.phone, data.name ?? data.role ?? document.id, 'contact')
  }

  const recipients = [...byNumber.values()]

  for (const document of devices.docs) {
    const token = (document.data().token as string) ?? document.id
    recipients.push({ to: token, channel: 'push', source: 'device', label: 'device' })
  }

  if (rejected.length) {
    logger.warn('unusable phone numbers skipped', {
      eventCode,
      count: rejected.length,
      sample: rejected.slice(0, 5),
    })
  }

  return { recipients, rejected, deduped }
}
