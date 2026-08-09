import type { NotificationProvider, OutboundMessage, SendResult } from '../types.js'

/*
 * WhatsApp adapter -- NOT YET WIRED UP.
 *
 * The transport below targets the Meta WhatsApp Cloud API. It is written out
 * rather than left as a bare `throw` so that connecting it is a matter of
 * setting two secrets and approving a template, not writing the integration:
 *
 *   firebase functions:secrets:set WHATSAPP_TOKEN
 *   firebase functions:secrets:set WHATSAPP_PHONE_NUMBER_ID
 *
 * Note the 24-hour rule: outside a customer-initiated conversation window,
 * WhatsApp only permits pre-approved template messages, not free text. Race
 * alerts are business-initiated, so `sendTemplate` is the realistic path and
 * the template must be approved in Meta Business Manager first.
 */

/* See the note in sms.ts: declared secrets are deploy-time dependencies, so
 * these are read from the environment and injected by the binding in index.ts
 * only once the secrets actually exist. */
const token = () => process.env.WHATSAPP_TOKEN ?? ''
const phoneNumberId = () => process.env.WHATSAPP_PHONE_NUMBER_ID ?? ''

/** Name of the approved template used for race alerts. Two body params: title, body. */
const ALERT_TEMPLATE = 'racewire_alert'

export const whatsappProvider: NotificationProvider = {
  channel: 'whatsapp',

  isConfigured(): boolean {
    return Boolean(token() && phoneNumberId())
  },

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured()) {
      return {
        channel: 'whatsapp',
        to: message.to,
        ok: false,
        error: 'WhatsApp not configured: set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID',
      }
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId()}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: message.to,
            type: 'template',
            template: {
              name: ALERT_TEMPLATE,
              language: { code: 'en' },
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: message.title },
                    { type: 'text', text: message.body },
                  ],
                },
              ],
            },
          }),
        },
      )

      const payload = (await response.json()) as {
        messages?: { id: string }[]
        error?: { message: string }
      }

      if (!response.ok) {
        return {
          channel: 'whatsapp',
          to: message.to,
          ok: false,
          error: payload.error?.message ?? `HTTP ${response.status}`,
        }
      }

      return { channel: 'whatsapp', to: message.to, ok: true, id: payload.messages?.[0]?.id }
    } catch (cause) {
      return {
        channel: 'whatsapp',
        to: message.to,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }
    }
  },
}
