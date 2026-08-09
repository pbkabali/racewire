import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { setGlobalOptions } from 'firebase-functions'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { dispatchNotice } from './notify/dispatch.js'
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER,
} from './notify/providers/sms.js'
import { WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TOKEN } from './notify/providers/whatsapp.js'
import { SHEET_ID, SHEET_RANGE, syncRacesFromSheet } from './sheets/sync.js'

initializeApp()

// Keep everything in one region: cross-region hops add latency for no benefit
// here. Change to the region nearest the event.
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 })

const messagingSecrets = [
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER,
]

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

export { SHEET_ID, SHEET_RANGE }
