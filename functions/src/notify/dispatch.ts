import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'

import { DEAD_TOKEN_CODES, fcmProvider } from './providers/fcm.js'
import { smsProvider } from './providers/sms.js'
import { whatsappProvider } from './providers/whatsapp.js'
import type { Channel, NotificationProvider, SendResult } from './types.js'

const providers: Record<Channel, NotificationProvider> = {
  push: fcmProvider,
  sms: smsProvider,
  whatsapp: whatsappProvider,
}

type Subscriber = {
  token: string
  channel: Channel
  phone?: string
}

/**
 * Fan a notice out to every subscriber on every configured channel.
 *
 * Sends run concurrently and failures are collected rather than thrown: one bad
 * phone number must not stop the rest of the field from being told the race is
 * red-flagged.
 */
export async function dispatchNotice(notice: {
  id: string
  title: string
  body: string
}): Promise<SendResult[]> {
  const db = getFirestore()
  const snapshot = await db.collection('subscribers').get()

  const sends = snapshot.docs.flatMap((doc) => {
    const sub = doc.data() as Subscriber
    const provider = providers[sub.channel]

    if (!provider || !provider.isConfigured()) return []

    // Push addresses by FCM token; SMS and WhatsApp by phone number.
    const to = sub.channel === 'push' ? sub.token : sub.phone
    if (!to) return []

    return [
      provider.send({
        to,
        title: notice.title,
        body: notice.body,
        data: { noticeId: notice.id, path: '/' },
      }),
    ]
  })

  const results = await Promise.all(sends)

  await pruneDeadTokens(results)

  const failed = results.filter((r) => !r.ok)
  logger.info('notice dispatched', {
    noticeId: notice.id,
    sent: results.length - failed.length,
    failed: failed.length,
  })
  if (failed.length) {
    logger.warn('some sends failed', { noticeId: notice.id, failures: failed.slice(0, 10) })
  }

  return results
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
