import { defineSecret } from 'firebase-functions/params'

import type { NotificationProvider, OutboundMessage, SendResult } from '../types.js'

/*
 * SMS adapter -- NOT YET WIRED UP.
 *
 * Targets Twilio's REST API over plain fetch rather than the Twilio SDK, which
 * keeps the deployed function small. To connect:
 *
 *   firebase functions:secrets:set TWILIO_ACCOUNT_SID
 *   firebase functions:secrets:set TWILIO_AUTH_TOKEN
 *   firebase functions:secrets:set TWILIO_FROM_NUMBER
 */

export const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID')
export const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN')
export const TWILIO_FROM_NUMBER = defineSecret('TWILIO_FROM_NUMBER')

/** SMS is billed per 160-char segment, so long notices get trimmed, not split. */
const MAX_SMS_LENGTH = 320

export const smsProvider: NotificationProvider = {
  channel: 'sms',

  isConfigured(): boolean {
    return Boolean(
      TWILIO_ACCOUNT_SID.value() && TWILIO_AUTH_TOKEN.value() && TWILIO_FROM_NUMBER.value(),
    )
  },

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured()) {
      return {
        channel: 'sms',
        to: message.to,
        ok: false,
        error: 'SMS not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER',
      }
    }

    const text = truncate(`${message.title}: ${message.body}`, MAX_SMS_LENGTH)
    const sid = TWILIO_ACCOUNT_SID.value()

    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${sid}:${TWILIO_AUTH_TOKEN.value()}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: message.to,
            From: TWILIO_FROM_NUMBER.value(),
            Body: text,
          }),
        },
      )

      const payload = (await response.json()) as { sid?: string; message?: string }

      if (!response.ok) {
        return {
          channel: 'sms',
          to: message.to,
          ok: false,
          error: payload.message ?? `HTTP ${response.status}`,
        }
      }

      return { channel: 'sms', to: message.to, ok: true, id: payload.sid }
    } catch (cause) {
      return {
        channel: 'sms',
        to: message.to,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }
    }
  },
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
