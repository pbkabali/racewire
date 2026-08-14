import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { logger, setGlobalOptions } from 'firebase-functions'
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { sendEntryConfirmation } from './email/sendEntryConfirmation.js'
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
 * Email the entrant a copy of their entry when it is submitted.
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
    // Bind SENDGRID_API_KEY here once it exists in Secret Manager. Empty by
    // design: a bound-but-missing secret fails the entire deploy, hosting and
    // rules included. See docs/firebase-setup.md.
    secrets: [],
  },
  async (event) => {
    const before = event.data?.before.data()
    const after = event.data?.after.data()
    if (!after) return

    // Only the draft -> submitted transition. Later edits by an organiser must
    // not re-send, or a correction becomes a second confirmation.
    if (before?.status === 'submitted' || after.status !== 'submitted') return

    const values = (after.values ?? {}) as Record<string, string>

    /*
     * The entrant's address is the addressee -- it is required precisely so
     * this has somewhere to go. The crew are copied so a driver entered by a
     * team still gets their own copy.
     */
    const to = values['contact.email.entrant']?.trim() || values['contact.email.driver']?.trim()

    if (!to) {
      logger.warn('entry submitted with no email address', {
        entryId: event.params.entryId,
        licence: after.licenceNumber,
      })
      return
    }

    const name =
      [values['identity.firstName.driver'], values['identity.familyName.driver']]
        .filter(Boolean)
        .join(' ') || values['identity.entrantName.entrant'] || ''

    const eventSnap = await getFirestore()
      .collection('events')
      .doc(event.params.eventId)
      .get()

    try {
      await sendEntryConfirmation({
        to,
        cc: [values['contact.email.driver'], values['contact.email.codriver']],
        eventName: (eventSnap.data()?.name as string) ?? event.params.eventId,
        eventCode: event.params.eventId,
        licenceNumber: (after.licenceNumber as string) ?? '',
        competitorName: name,
        pdfPath: (after.pdfPath as string | null) ?? null,
      })
    } catch (cause) {
      // Never rethrow: a retry would re-send to anyone who did receive it, and
      // the entry itself is safely stored either way.
      logger.error('entry confirmation failed', {
        entryId: event.params.entryId,
        cause,
      })
    }
  },
)
