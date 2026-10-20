import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { logger, setGlobalOptions } from 'firebase-functions'
import { defineSecret } from 'firebase-functions/params'
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { loadEntryPdf } from './email/entryPdf.js'
import { sendEntryConfirmation } from './email/sendEntryConfirmation.js'
import { sendEntryNotification } from './email/sendEntryNotification.js'
import { describeError } from './errors.js'
import { dispatchNotification } from './notify/dispatch.js'
import { extractStatuses, isFromMeta } from './notify/metaWebhook.js'
import { claimPending, fallbackToSms, findExpired, markDelivered } from './notify/outbox.js'
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
 *      For the WhatsApp delivery receipts that drive the SMS fallback, also:
 *        firebase functions:secrets:set WHATSAPP_APP_SECRET    --project production
 *        firebase functions:secrets:set WHATSAPP_VERIFY_TOKEN  --project production
 *      (the app secret from Meta's app settings; the verify token is any
 *      string you choose and then type into Meta's webhook form)
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
/**
 * True when a newly-created document is historical rather than just published.
 *
 * Creation triggers cannot tell a publication from a migration: copy-event.mjs
 * writes a whole event's notices and documents into another project, and
 * without this guard restoring last year's rally into production would text
 * the entire field about bulletins from last year. A copied row keeps its
 * original timestamp, so an old one means a backfill.
 *
 * Offline publishing still works. A notice queued on a marshal's phone carries
 * serverTimestamp(), which resolves when the write finally commits -- so it
 * arrives fresh however long the device was out of signal, which is exactly
 * the case the trigger exists for.
 */
const BACKFILL_AFTER_MS = 60 * 60 * 1000

function isBackfill(stamp: unknown): boolean {
  const date = (stamp as { toDate?: () => Date } | null)?.toDate?.()
  if (!date) return false
  return Date.now() - date.getTime() > BACKFILL_AFTER_MS
}

export const onNoticeCreated = onDocumentCreated(
  {
    /*
     * events/{eventId}/notices, NOT the top-level notices/{noticeId} this
     * listened on until now.
     *
     * Notices moved under their event when the app became multi-event; this
     * trigger did not move with them, so it has been matching a collection
     * nothing writes to -- rules deny the top-level path outright. No notice
     * has ever been dispatched. The same migration is why storage.rules still
     * carries a /notices/{fileName} rule marked as predating event scoping.
     */
    document: 'events/{eventId}/notices/{noticeId}',
    secrets: messagingSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data) return
    if (isBackfill(data.publishedAt)) {
      logger.info('notice not dispatched: backfilled', {
        eventId: event.params.eventId,
        noticeId: event.params.noticeId,
      })
      return
    }

    await dispatchNotification(event.params.eventId, {
      type: 'notice',
      id: event.params.noticeId,
      title: String(data.title ?? ''),
      body: String(data.body ?? ''),
      path: `/e/${event.params.eventId}/notices`,
    })
  },
)

/**
 * Fan out every newly published document.
 *
 * A bulletin or a stewards' decision is as actionable as a notice -- often
 * more so -- and until now uploading one told nobody.
 *
 * The body is composed here rather than taken from a field because a document
 * has no prose: it has a number, a name and a file. What goes out has to read
 * as a sentence on a phone's lock screen.
 */
export const onDocumentPublished = onDocumentCreated(
  {
    document: 'events/{eventId}/documents/{documentId}',
    secrets: messagingSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data) return

    /*
     * Documents the system generates announce nothing.
     *
     * The entry list is written by a trigger and rewritten whenever entries
     * change, so its first appearance is whenever an organiser happens to
     * press Rebuild during setup -- not a moment anybody needs telling about.
     * Left unguarded, bootstrapping several events would text the whole field
     * once per event in the space of a minute.
     */
    if (data.autoGenerated === true) return

    if (isBackfill(data.uploadedAt)) {
      logger.info('document not dispatched: backfilled', {
        eventId: event.params.eventId,
        documentId: event.params.documentId,
      })
      return
    }

    const number = String(data.documentNumber ?? '').trim()
    const name = String(data.name ?? 'Untitled document').trim()

    await dispatchNotification(event.params.eventId, {
      type: 'document',
      id: event.params.documentId,
      title: number ? `Document ${number}: ${name}` : `New document: ${name}`,
      body: String(data.notes ?? '').trim() || 'Published to the event document library.',
      path: `/e/${event.params.eventId}/docs`,
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
        logger.error('entry confirmation failed', {
          entryId: event.params.entryId,
          ...describeError(cause),
        })
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
      logger.error('entry notification failed', {
        entryId: event.params.entryId,
        ...describeError(cause),
      })
    }
  },
)

/**
 * WhatsApp delivery receipts -- the trigger for the SMS fallback.
 *
 * Meta POSTs a status for every message: sent, delivered, read, failed. Only
 * two are acted on. `delivered` closes the message out. `failed` means the
 * number could not receive it, so the SMS goes immediately rather than waiting
 * for the timeout. `sent` says only that Meta accepted it, which we already
 * knew, and `read` is deliberately ignored and never stored -- whether a
 * competitor opened a message is not the organiser's business, and not knowing
 * it is one less piece of personal data to hold.
 *
 * Anything this does not recognise still gets a 200. A non-200 makes Meta
 * retry, and retrying a payload we will never understand just fills the logs.
 */
export const whatsappStatus = onRequest({ secrets: messagingSecrets }, async (request, response) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? ''
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? ''

  /*
   * Meta's one-time subscription handshake: it GETs with a token you chose and
   * expects the challenge echoed back verbatim.
   */
  if (request.method === 'GET') {
    const query = request.query as Record<string, string | undefined>
    if (verifyToken && query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
      response.status(200).send(query['hub.challenge'] ?? '')
      return
    }
    response.status(403).send('Verification failed')
    return
  }

  if (request.method !== 'POST') {
    response.status(405).send('Method not allowed')
    return
  }

  /*
   * Fails closed. This endpoint is public and acting on an unverified payload
   * would let anyone mark a message delivered -- suppressing the SMS to a
   * competitor who never got the WhatsApp. An unconfigured secret is a
   * misconfiguration, not a reason to trust the caller.
   */
  if (!appSecret || !isFromMeta(request.rawBody, request.get('x-hub-signature-256'), appSecret)) {
    logger.warn('rejected unverified whatsapp webhook')
    response.status(403).send('Bad signature')
    return
  }

  const statuses = extractStatuses(request.body)

  /*
   * Finish the work BEFORE responding.
   *
   * The tempting shape is to answer 200 immediately and process in the
   * background, since Meta retries slow callbacks. That silently loses sends
   * here: these are gen-2 functions, so CPU is only allocated while a request
   * is in flight, and anything still awaiting after response.send() may never
   * run. A competitor's fallback SMS would go missing with nothing in the log.
   *
   * Being slow is the safe failure instead. Meta retries, the retry finds the
   * message already claimed, and does nothing.
   */
  for (const { id, status, reason } of statuses) {
    try {
      // 'sent' tells us only what we already knew, and 'read' is ignored by
      // design -- it is never stored.
      if (status !== 'delivered' && status !== 'failed') continue

      const entry = await claimPending(id)
      // Already resolved -- by an earlier callback, or by the sweeper.
      if (!entry) continue

      if (status === 'delivered') await markDelivered(entry)
      else await fallbackToSms(entry, reason ?? 'WhatsApp reported the message failed')
    } catch (cause) {
      // Swallowed deliberately: a 500 makes Meta redeliver the whole batch,
      // re-doing the statuses that did work. The sweeper is the backstop for
      // anything left unclaimed.
      logger.error('whatsapp status handling failed', {
        messageId: id,
        status,
        ...describeError(cause),
      })
    }
  }

  response.status(200).send('OK')
})

/**
 * Send the SMS to anyone whose WhatsApp never came back.
 *
 * The receipt-driven path above covers an outright failure. This covers
 * silence -- a handset that is off, or data switched off -- which produces no
 * callback at all and would otherwise wait forever.
 *
 * Every five minutes against a ten-minute window, so a fallback lands 10-15
 * minutes after the notice. The cases that need to be fast (a number with no
 * WhatsApp account) are refused at the API and fall back immediately, so this
 * slower path only ever covers people who are not looking at a phone anyway.
 */
export const sweepWhatsappFallbacks = onSchedule(
  { schedule: 'every 5 minutes', secrets: messagingSecrets },
  async () => {
    const expired = await findExpired(Date.now())
    if (!expired.length) return

    let sent = 0
    for (const messageId of expired) {
      try {
        const entry = await claimPending(messageId)
        if (!entry) continue
        await fallbackToSms(entry, 'No WhatsApp delivery receipt within the wait window')
        sent++
      } catch (cause) {
        logger.error('fallback sweep failed for one message', {
          messageId,
          ...describeError(cause),
        })
      }
    }

    logger.info('whatsapp fallback sweep', { expired: expired.length, sent })
  },
)
