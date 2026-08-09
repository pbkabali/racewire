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

/*
 * Read from the process environment rather than declaring defineSecret() params.
 *
 * A declared secret is a DEPLOY-TIME dependency: the CLI resolves it against
 * Secret Manager before deploying, so declaring one that has never been created
 * fails the whole deploy -- including hosting and rules. Reading process.env
 * instead means an unconfigured channel is simply skipped at runtime, which is
 * the behaviour this scaffold promises. Binding the secrets to the function
 * (see functions/src/index.ts) is what injects them here once they exist.
 */
const sid = () => process.env.TWILIO_ACCOUNT_SID ?? ''
const token = () => process.env.TWILIO_AUTH_TOKEN ?? ''
const from = () => process.env.TWILIO_FROM_NUMBER ?? ''

/** SMS is billed per 160-char segment, so long notices get trimmed, not split. */
const MAX_SMS_LENGTH = 320

export const smsProvider: NotificationProvider = {
  channel: 'sms',

  isConfigured(): boolean {
    return Boolean(sid() && token() && from())
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
    const accountSid = sid()

    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${accountSid}:${token()}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: message.to,
            From: from(),
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
