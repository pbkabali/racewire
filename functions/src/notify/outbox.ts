import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'

import { smsProvider } from './providers/sms.js'

/**
 * WhatsApp messages still waiting to find out whether they arrived.
 *
 * Transient working state, not a record. A row is written when a WhatsApp
 * message is accepted, and deleted the moment its fate is known -- delivered,
 * failed, or timed out into an SMS. At rest the collection is empty, so there
 * is nothing accumulating and nothing to prune.
 *
 * Keyed by the WhatsApp message id so a status webhook is a direct document
 * read rather than a query: no index to maintain, and no collection-group
 * lookup across events for a callback that does not know which event it
 * belongs to.
 */
export const OUTBOX = 'whatsappOutbox'

/**
 * How long to wait for a delivery receipt before giving up and sending SMS.
 *
 * Long enough that a phone briefly out of signal is not double-messaged --
 * which is the whole saving this approach exists for -- and short enough to
 * still matter for a notice about a stage closing. WhatsApp delivers in
 * seconds when it is going to; ten minutes of silence means data off, no
 * WhatsApp on that number, or a handset that is off.
 */
export const FALLBACK_AFTER_MS = 10 * 60 * 1000

export type OutboxEntry = {
  eventCode: string
  subjectId: string
  subjectType: 'notice' | 'document'
  title: string
  body: string
  to: string
  label: string
  source: string
  /** The audit row for the WhatsApp attempt, so its outcome can be amended. */
  auditId: string
  sentAt: Timestamp
}

/**
 * Take ownership of a pending message, if it is still pending.
 *
 * The delete IS the lock. A status webhook and the sweeper can reach the same
 * message at the same moment -- Meta retries callbacks, and a receipt arriving
 * exactly as the timeout expires is a race that will happen over a weekend of
 * racing. Whoever deletes the row first acts on it; the loser sees nothing and
 * does nothing, so the competitor gets one SMS rather than two.
 */
export async function claimPending(messageId: string): Promise<OutboxEntry | null> {
  const db = getFirestore()
  const ref = db.collection(OUTBOX).doc(messageId)

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return null
    transaction.delete(ref)
    return snapshot.data() as OutboxEntry
  })
}

/** Note on the log that WhatsApp arrived. No SMS needed, nothing more to do. */
export async function markDelivered(entry: OutboxEntry): Promise<void> {
  await auditRef(entry).set({ status: 'delivered' }, { merge: true })
}

/**
 * WhatsApp did not arrive, so send the SMS.
 *
 * The original WhatsApp row is amended rather than replaced, and the SMS gets
 * a row of its own: an organiser reading the log should see that both were
 * tried and why, not a single line that hides the first attempt.
 */
export async function fallbackToSms(entry: OutboxEntry, reason: string): Promise<void> {
  if (!smsProvider.isConfigured()) {
    logger.warn('whatsapp undelivered and SMS not configured', {
      eventCode: entry.eventCode,
      to: entry.to,
      reason,
    })
    await auditRef(entry).set({ status: 'undelivered', error: reason }, { merge: true })
    return
  }

  const result = await smsProvider.send({
    to: entry.to,
    title: entry.title,
    body: entry.body,
  })

  const db = getFirestore()
  const collection = db.collection('events').doc(entry.eventCode).collection('notifications')

  await Promise.all([
    auditRef(entry).set({ status: 'undelivered', error: reason }, { merge: true }),
    collection.add({
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      title: entry.title,
      channel: 'sms',
      to: entry.to,
      label: entry.label,
      source: entry.source,
      status: result.ok ? 'sent' : 'failed',
      providerMessageId: result.id ?? null,
      error: result.error ?? null,
      /** Marks this as the second attempt, not an independent send. */
      fallbackFor: 'whatsapp',
      sentAt: Timestamp.now(),
    }),
  ])

  logger.info('fell back to SMS', {
    eventCode: entry.eventCode,
    to: entry.to,
    reason,
    ok: result.ok,
  })
}

/**
 * Everything that has waited long enough. Ordered oldest first so a backlog
 * drains in the order people were messaged.
 */
export async function findExpired(now: number, max = 400): Promise<string[]> {
  const db = getFirestore()
  const cutoff = Timestamp.fromMillis(now - FALLBACK_AFTER_MS)

  const snapshot = await db
    .collection(OUTBOX)
    .where('sentAt', '<=', cutoff)
    .orderBy('sentAt', 'asc')
    .limit(max)
    .get()

  return snapshot.docs.map((document) => document.id)
}

function auditRef(entry: OutboxEntry) {
  return getFirestore()
    .collection('events')
    .doc(entry.eventCode)
    .collection('notifications')
    .doc(entry.auditId)
}
