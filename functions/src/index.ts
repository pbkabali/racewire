import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { logger, setGlobalOptions } from 'firebase-functions'
import { defineSecret } from 'firebase-functions/params'
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { loadEntryPdf } from './email/entryPdf.js'
import { publishEntryList } from './entryList/publish.js'
import { sendEntryConfirmation } from './email/sendEntryConfirmation.js'
import { sendEntryNotification } from './email/sendEntryNotification.js'
import { dispatchNotice } from './notify/dispatch.js'
import { syncRacesFromSheet } from './sheets/sync.js'

initializeApp()

// Keep everything in one region: cross-region hops add latency for no benefit
// here. Change to the region nearest the event.
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 })

/*
 * Secrets bound to onNoticeCreated. EMPTY ON PURPOSE.
 *
 * A bound secret must already exist in Secret Manager or the deploy fails --
 * and because a Firebase deploy is atomic, that failure takes hosting and rules
 * down with it. Binding secrets for channels nobody has configured yet would
 * mean the site cannot ship until Twilio and WhatsApp accounts exist.
 *
 * Push (FCM) needs nothing here; it uses the project's own credentials.
 *
 * To turn on SMS or WhatsApp:
 *   1. Create the secrets:
 *        firebase functions:secrets:set TWILIO_ACCOUNT_SID   --project production
 *        firebase functions:secrets:set TWILIO_AUTH_TOKEN    --project production
 *        firebase functions:secrets:set TWILIO_FROM_NUMBER   --project production
 *      (or WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)
 *   2. Add them here:
 *        import { defineSecret } from 'firebase-functions/params'
 *        const messagingSecrets = [defineSecret('TWILIO_ACCOUNT_SID'), ...]
 *   3. Deploy. The binding injects them into process.env, which is where
 *      functions/src/notify/providers/*.ts read them from.
 *
 * Until then each provider reports isConfigured() false and dispatch skips it.
 */
const messagingSecrets: never[] = []

/**
 * The one secret that is bound, because entry confirmations are in use.
 *
 * Postmark is deliberately not bound: providers.ts supports it, but binding a
 * secret nobody has created would fail every deploy. Create
 * POSTMARK_SERVER_TOKEN in each project first, then add it here.
 */
const sendgridApiKey = defineSecret('SENDGRID_API_KEY')

/**
 * Fan out every new notice.
 *
 * Triggered on write rather than called from the client, so a notice queued
 * offline still notifies everyone once the device syncs -- the trigger fires
 * when the document actually lands, not when the admin pressed publish.
 */
export const onNoticeCreated = onDocumentCreated(
  { document: 'notices/{noticeId}', secrets: messagingSecrets },
  async (event) => {
    const data = event.data?.data()
    if (!data) return

    await dispatchNotice({
      id: event.params.noticeId,
      title: String(data.title ?? ''),
      body: String(data.body ?? ''),
    })
  },
)

/** Scheduled Sheets import. */
export const syncSheetScheduled = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'UTC' },
  async () => {
    await syncRacesFromSheet()
  },
)

/** Manual Sheets import, for when an organiser wants the change live now. */
export const syncSheetNow = onCall(async (request) => {
  if (request.auth?.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin only.')
  }
  const count = await syncRacesFromSheet()
  return { synced: count }
})

/**
 * Grant or revoke the admin claim.
 *
 * Bootstrapping problem: the first admin cannot call this, because it requires
 * being an admin already. Grant that one from a trusted shell:
 *
 *   firebase functions:shell
 *   > getAuth().setCustomUserClaims('<uid>', { admin: true })
 *
 * or via the Admin SDK in a one-off script.
 */
export const grantAdmin = onCall(async (request) => {
  if (request.auth?.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin only.')
  }

  const { uid, admin } = request.data as { uid?: string; admin?: boolean }
  if (!uid) throw new HttpsError('invalid-argument', 'uid is required.')

  await getAuth().setCustomUserClaims(uid, { admin: admin !== false })
  return { uid, admin: admin !== false }
})

/**
 * Two emails when an entry is submitted: a copy to the entrant, and a
 * notification to the organiser.
 *
 * Server-side rather than from the browser, for three reasons: the API key must
 * never reach a client, the generated PDF lives behind admin-only Storage rules
 * that a competitor cannot read, and a confirmation should still be sent if the
 * person closes the tab the moment they press Submit.
 *
 * Fires on update rather than create because an entry is created as a draft and
 * becomes submitted later, so the transition is what matters.
 */
export const onEntrySubmitted = onDocumentUpdated(
  {
    document: 'events/{eventId}/entries/{entryId}',
    /*
     * Binding is what puts the key in process.env, where providers.ts reads it.
     * Creating the secret is not enough on its own.
     *
     * THE SECRET MUST EXIST IN EVERY PROJECT THIS DEPLOYS TO. A bound-but-
     * missing secret fails the whole deploy, and a Firebase deploy is atomic --
     * hosting and rules go down with it. Before this reaches a new project:
     *   npx firebase-tools functions:secrets:set SENDGRID_API_KEY --project <alias>
     */
    secrets: [sendgridApiKey],
  },
  async (event) => {
    const before = event.data?.before.data()
    const after = event.data?.after.data()
    if (!after) return

    // Only the draft -> submitted transition. Later edits by an organiser must
    // not re-send, or a correction becomes a second confirmation.
    if (before?.status === 'submitted' || after.status !== 'submitted') return

    const values = (after.values ?? {}) as Record<string, string>
    const licenceNumber = (after.licenceNumber as string) ?? ''

    /*
     * The entrant's address is the addressee -- it is required precisely so
     * this has somewhere to go. The crew are copied so a driver entered by a
     * team still gets their own copy.
     */
    const to = values['contact.email.entrant']?.trim() || values['contact.email.driver']?.trim()

    const name =
      [values['identity.firstName.driver'], values['identity.familyName.driver']]
        .filter(Boolean)
        .join(' ') || values['identity.entrantName.entrant'] || ''

    const eventSnap = await getFirestore()
      .collection('events')
      .doc(event.params.eventId)
      .get()
    const eventData = eventSnap.data() ?? {}
    const eventName = (eventData.name as string) ?? event.params.eventId

    // Fetched once and shared: two downloads of the same object would double
    // the egress and could hand the two recipients different attachments.
    const attachment = await loadEntryPdf((after.pdfPath as string | null) ?? null, licenceNumber)

    /*
     * Two independent sends, each in its own try/catch, and never rethrowing.
     *
     * Independent because a bounce on one address must not swallow the other:
     * a competitor left wondering whether their entry arrived, or an organiser
     * who never hears about it, are different failures and neither should be
     * caused by the other. Never rethrowing because a retry would re-send to
     * whoever did receive it, and the entry is safely stored regardless.
     */
    if (to) {
      try {
        await sendEntryConfirmation({
          to,
          cc: [values['contact.email.driver'], values['contact.email.codriver']],
          eventName,
          eventCode: event.params.eventId,
          licenceNumber,
          competitorName: name,
          attachment,
          // Set on the event by its organiser. Absent on events created before
          // the fields existed, in which case the reply-to falls back to
          // ENTRY_EMAIL_REPLY_TO.
          organiserEmail: (eventData.contactEmail as string | undefined) ?? '',
          organiserPhone: (eventData.contactPhone as string | undefined) ?? '',
        })
      } catch (cause) {
        logger.error('entry confirmation failed', { entryId: event.params.entryId, cause })
      }
    } else {
      // Not a reason to stop: the organiser still needs to know, and an entry
      // with no address is exactly the one they will want to chase.
      logger.warn('entry submitted with no email address', {
        entryId: event.params.entryId,
        licence: licenceNumber,
      })
    }

    try {
      await sendEntryNotification({
        to: (eventData.contactEmail as string | undefined) ?? '',
        eventName,
        eventCode: event.params.eventId,
        licenceNumber,
        competitorName: name,
        verifiedPhone: (after.phone as string) ?? '',
        entrantEmail: to ?? '',
        car: [values['car.make'], values['car.model'], values['car.registrationNo']]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join(' · '),
        attachment,
      })
    } catch (cause) {
      logger.error('entry notification failed', { entryId: event.params.entryId, cause })
    }
  },
)

/**
 * Keep the published entry list in step with the entries.
 *
 * Written on every change rather than built on demand, because the list is a
 * document in the library like any other: competitors download it, organisers
 * print it, and neither should have to ask for it to be refreshed first.
 *
 * onDocumentWritten covers create, update and delete -- a withdrawal has to
 * take a car off the list as surely as an entry puts one on.
 */
export const onEntryChanged = onDocumentWritten(
  'events/{eventId}/entries/{entryId}',
  async (event) => {
    const before = event.data?.before.data()
    const after = event.data?.after.data()

    /*
     * Drafts cannot change a list of submitted entries, and a draft is written
     * on every save while somebody fills the form. Checking the two statuses
     * costs nothing and skips that entire class of write before it reaches a
     * query. The content fingerprint downstream catches the rest -- an
     * organiser correcting a phone number on a submitted entry rebuilds
     * nothing, because no line of the page differs.
     */
    if (before?.status !== 'submitted' && after?.status !== 'submitted') return

    try {
      await publishEntryList(event.params.eventId)
    } catch (cause) {
      /*
       * Never rethrown. A retry would re-run against the same data and fail
       * the same way, and a stale entry list must not stop entries being
       * taken -- the next submission rebuilds it.
       */
      logger.error('entry list rebuild failed', {
        eventId: event.params.eventId,
        entryId: event.params.entryId,
        // Spelled out rather than passing `cause`: JSON.stringify of an Error
        // is {}, so logging the object records nothing but the word "failed".
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  },
)

/**
 * Rebuild the entry list on demand.
 *
 * The trigger covers every normal path, so this is for the abnormal ones:
 * a file deleted by hand, a rebuild that failed while a gateway was down, or
 * an organiser who simply wants to be certain before printing.
 */
export const regenerateEntryList = onCall(async (request) => {
  const { eventId } = (request.data ?? {}) as { eventId?: string }
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.')

  // The same test the Firestore rules apply: a super admin, or an admin whose
  // claim names this specific event.
  const token = request.auth?.token
  const manages =
    token?.superAdmin === true ||
    (Array.isArray(token?.events) && token.events.includes(eventId))
  if (!manages) throw new HttpsError('permission-denied', 'Not an admin for this event.')

  const rebuilt = await publishEntryList(eventId)
  return { rebuilt }
})
