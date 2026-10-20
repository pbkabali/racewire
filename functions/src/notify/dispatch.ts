import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'

import { OUTBOX, type OutboxEntry } from './outbox.js'
import { DEAD_TOKEN_CODES, fcmProvider } from './providers/fcm.js'
import { smsProvider } from './providers/sms.js'
import { whatsappProvider } from './providers/whatsapp.js'
import { resolveRecipients, type Recipient } from './recipients.js'
import type { Channel, NotificationProvider, OutboundMessage, SendResult } from './types.js'

const providers: Record<Channel, NotificationProvider> = {
  push: fcmProvider,
  sms: smsProvider,
  whatsapp: whatsappProvider,
}

/*
 * Gateways rate-limit, and a 200-car rally is 200 requests arriving at once.
 * Capping in-flight sends trades a few seconds of wall clock for not being
 * throttled halfway through telling people a stage is closed -- and a
 * throttled send is indistinguishable from a lost one.
 */
const MAX_IN_FLIGHT = 20

/** What a notification is about. Notices and documents differ only in wording. */
export type Subject = {
  type: 'notice' | 'document'
  id: string
  title: string
  body: string
  /** Deep link path within the app, delivered with the push payload. */
  path: string
}

export type DispatchSummary = {
  sent: number
  failed: number
  skipped: number
  /** WhatsApp messages accepted and now waiting on a delivery receipt. */
  pending: number
  channels: Channel[]
}

type Attempt = { recipient: Recipient; channel: Channel; result: SendResult }

/**
 * Fan one notice or document out to everyone attached to the event.
 *
 * WhatsApp first, SMS only for those it does not reach.
 *
 * Sending both to everyone was the obvious thing and the wrong one: it is two
 * messages per person per notice, paid for twice, and it trains people to
 * ignore one of the two channels. Instead each phone gets WhatsApp, and an SMS
 * follows only where WhatsApp is not confirmed delivered -- at the API if the
 * number has no WhatsApp at all, from a failure receipt, or from the sweeper
 * when nothing comes back within the window. Most of the field costs one cheap
 * message; the unreachable minority still gets told.
 *
 * Failures are collected rather than thrown. One dead number must not stop the
 * rest of the field being told.
 */
export async function dispatchNotification(
  eventCode: string,
  subject: Subject,
): Promise<DispatchSummary> {
  const db = getFirestore()

  const eventSnap = await db.collection('events').doc(eventCode).get()
  if (!eventSnap.exists) {
    logger.warn('dispatch skipped: no such event', { eventCode, subject: subject.id })
    return { sent: 0, failed: 0, skipped: 0, pending: 0, channels: [] }
  }
  const event = eventSnap.data() ?? {}

  /*
   * Which channels this event uses. Absent means every channel that has
   * credentials -- the common case, and the one that needs no setup. An
   * organiser can narrow it without a deploy; narrowing to WhatsApp alone
   * simply means no fallback exists, not that sending breaks.
   */
  const allowed = (event.notifyChannels as Channel[] | undefined) ?? null
  const active = (Object.keys(providers) as Channel[]).filter(
    (channel) =>
      providers[channel].isConfigured() && (!allowed || allowed.includes(channel)),
  )

  if (!active.length) {
    logger.warn('dispatch skipped: no channel configured', { eventCode, subject: subject.id })
    return { sent: 0, failed: 0, skipped: 0, pending: 0, channels: [] }
  }

  const { recipients, rejected, deduped } = await resolveRecipients(
    eventCode,
    event.countryCode as string | undefined,
  )

  const payload = (to: string): OutboundMessage => ({
    to,
    title: subject.title,
    body: subject.body,
    data: { noticeId: subject.id, type: subject.type, path: subject.path },
  })

  const send = (channel: Channel) => async (recipient: Recipient): Promise<Attempt> => ({
    recipient,
    channel,
    result: await providers[channel].send(payload(recipient.to)),
  })

  const usesWhatsApp = active.includes('whatsapp')
  const usesSms = active.includes('sms')

  const attempts: Attempt[] = []

  if (active.includes('push')) {
    const devices = recipients.filter((recipient) => recipient.channel === 'push')
    attempts.push(...(await mapWithConcurrency(devices, MAX_IN_FLIGHT, send('push'))))
  }

  /*
   * One channel per phone on the first pass. WhatsApp when it is available,
   * otherwise SMS -- an event with WhatsApp switched off is still notified.
   */
  const phones = recipients.filter((recipient) => recipient.channel !== 'push')
  const first: Channel | null = usesWhatsApp ? 'whatsapp' : usesSms ? 'sms' : null

  const firstPass = first
    ? await mapWithConcurrency(phones, MAX_IN_FLIGHT, send(first))
    : []
  attempts.push(...firstPass)

  /*
   * Refused at the API, which is what a number with no WhatsApp account looks
   * like. There is nothing to wait for, so the SMS goes now rather than in ten
   * minutes -- on a red flag those ten minutes are the whole point.
   */
  const refused =
    usesWhatsApp && usesSms
      ? firstPass.filter((a) => a.channel === 'whatsapp' && !a.result.ok).map((a) => a.recipient)
      : []
  const immediate = await mapWithConcurrency(refused, MAX_IN_FLIGHT, send('sms'))
  attempts.push(...immediate)

  const auditIds = await recordSends(eventCode, subject, attempts, rejected)

  /*
   * Everything accepted by WhatsApp now waits on a receipt. Tracked only when
   * an SMS fallback is actually possible: with SMS off there is no second
   * attempt to make, so a pending row would be a write with nothing to do.
   */
  const pending =
    usesWhatsApp && usesSms
      ? await trackPending(eventCode, subject, attempts, auditIds)
      : 0

  await pruneDeadTokens(attempts.map((attempt) => attempt.result))

  const failed = attempts.filter((attempt) => !attempt.result.ok)
  const summary: DispatchSummary = {
    sent: attempts.length - failed.length,
    failed: failed.length,
    skipped: rejected.length,
    pending,
    channels: active,
  }

  logger.info('notification dispatched', {
    eventCode,
    subject: subject.id,
    type: subject.type,
    ...summary,
    deduped,
  })
  if (failed.length) {
    logger.warn('some sends failed', {
      eventCode,
      subject: subject.id,
      failures: failed.slice(0, 10).map((attempt) => ({
        channel: attempt.channel,
        label: attempt.recipient.label,
        error: attempt.result.error,
      })),
    })
  }

  return summary
}

/**
 * Write the audit trail, returning each attempt's row id.
 *
 * The ids matter: a WhatsApp row is amended later, when the receipt arrives or
 * the fallback fires, so the outbox has to be able to find it again.
 *
 * Numbers that could not be parsed are recorded too, as `skipped` rows. A
 * number quietly dropped at the normalising step is the one failure mode that
 * leaves no trace anywhere else, and it is the likeliest: somebody typed their
 * phone number into the entry form wrongly.
 */
async function recordSends(
  eventCode: string,
  subject: Subject,
  attempts: Attempt[],
  rejected: { raw: string; label: string }[],
): Promise<string[]> {
  const db = getFirestore()
  const collection = db.collection('events').doc(eventCode).collection('notifications')

  const common = { subjectType: subject.type, subjectId: subject.id, title: subject.title }

  const rows = [
    ...attempts.map(({ result, recipient, channel }) => ({
      ref: collection.doc(),
      data: {
        ...common,
        channel,
        to: recipient.to,
        label: recipient.label,
        source: recipient.source,
        status: result.ok ? 'sent' : 'failed',
        providerMessageId: result.id ?? null,
        error: result.error ?? null,
        sentAt: FieldValue.serverTimestamp(),
      },
    })),
    ...rejected.map(({ raw, label }) => ({
      ref: collection.doc(),
      data: {
        ...common,
        channel: null,
        to: raw,
        label,
        source: 'entry',
        status: 'skipped',
        providerMessageId: null,
        error: 'Not a phone number we could read',
        sentAt: FieldValue.serverTimestamp(),
      },
    })),
  ]

  // Batches cap at 500 writes.
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch()
    for (const row of rows.slice(i, i + 400)) batch.set(row.ref, row.data)
    await batch.commit()
  }

  return rows.slice(0, attempts.length).map((row) => row.ref.id)
}

/** Park every accepted WhatsApp message to await its receipt. */
async function trackPending(
  eventCode: string,
  subject: Subject,
  attempts: Attempt[],
  auditIds: string[],
): Promise<number> {
  const db = getFirestore()
  const now = Timestamp.now()
  let pending = 0

  const waiting = attempts
    .map((attempt, index) => ({ attempt, auditId: auditIds[index] }))
    .filter(
      ({ attempt }) =>
        attempt.channel === 'whatsapp' && attempt.result.ok && attempt.result.id,
    )

  for (let i = 0; i < waiting.length; i += 400) {
    const batch = db.batch()
    for (const { attempt, auditId } of waiting.slice(i, i + 400)) {
      const entry: OutboxEntry = {
        eventCode,
        subjectId: subject.id,
        subjectType: subject.type,
        title: subject.title,
        body: subject.body,
        to: attempt.recipient.to,
        label: attempt.recipient.label,
        source: attempt.recipient.source,
        auditId: auditId ?? '',
        sentAt: now,
      }
      // Keyed by the WhatsApp message id: the webhook arrives knowing only that.
      batch.set(db.collection(OUTBOX).doc(attempt.result.id as string), entry)
      pending++
    }
    await batch.commit()
  }

  return pending
}

/** Remove subscribers whose push token FCM has told us is permanently invalid. */
async function pruneDeadTokens(results: SendResult[]): Promise<void> {
  const dead = results.filter(
    (r) => r.channel === 'push' && !r.ok && r.error && isDeadToken(r.error),
  )
  if (!dead.length) return

  const db = getFirestore()
  const batch = db.batch()
  for (const result of dead) {
    batch.delete(db.collection('subscribers').doc(result.to))
  }
  await batch.commit()
  logger.info('pruned dead push tokens', { count: dead.length })
}

function isDeadToken(error: string): boolean {
  return [...DEAD_TOKEN_CODES].some((code) => error.includes(code))
}

/** Run `worker` over `items`, never more than `limit` at a time, in order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const queue = items.map((item, index) => ({ item, index }))
  let next = 0

  /*
   * Runners pull from one shared cursor rather than taking a slice each, so a
   * single slow send holds up only its own runner instead of leaving a whole
   * block of numbers waiting behind it. Reading past the end yields undefined,
   * which is the loop's termination condition.
   */
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let job = queue[next++]; job; job = queue[next++]) {
      results[job.index] = await worker(job.item)
    }
  })

  await Promise.all(runners)
  return results
}
