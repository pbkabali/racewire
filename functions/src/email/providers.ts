import { logger } from 'firebase-functions'

/*
 * Transactional email, across providers.
 *
 * Two are supported because one of them locking you out should not stop entry
 * confirmations going. SendGrid blocks a lot of new free accounts before first
 * use; Postmark reviews accounts by hand but is quick and has the better
 * deliverability. Both are a single JSON POST, so supporting both costs almost
 * nothing and removes a single point of failure.
 *
 * Selected with EMAIL_PROVIDER; defaults to whichever key is present.
 */

export type EmailAttachment = {
  filename: string
  /** base64, no data: prefix. */
  content: string
  contentType: string
}

export type OutboundEmail = {
  to: string
  cc: string[]
  subject: string
  text: string
  html: string
  attachments: EmailAttachment[]
  /**
   * Overrides ENTRY_EMAIL_REPLY_TO. Per-message because the right address
   * depends on which event the mail is about, and one deployment carries
   * several events with different organisers.
   */
  replyTo?: string
}

export type ProviderName = 'sendgrid' | 'postmark'

const sendgridKey = () => process.env.SENDGRID_API_KEY ?? ''
const postmarkToken = () => process.env.POSTMARK_SERVER_TOKEN ?? ''

export const fromAddress = () => process.env.ENTRY_EMAIL_FROM ?? ''
export const fromName = () => process.env.ENTRY_EMAIL_FROM_NAME || 'Racewire'
/** Fallback reply-to, for mail with no better per-event address. */
export const replyTo = () => process.env.ENTRY_EMAIL_REPLY_TO ?? ''

const replyToFor = (message: OutboundEmail) => message.replyTo?.trim() || replyTo()

/** Explicit choice if given, otherwise whichever provider has a credential. */
export function activeProvider(): ProviderName | null {
  const explicit = (process.env.EMAIL_PROVIDER ?? '').toLowerCase()
  if (explicit === 'sendgrid') return sendgridKey() ? 'sendgrid' : null
  if (explicit === 'postmark') return postmarkToken() ? 'postmark' : null

  if (postmarkToken()) return 'postmark'
  if (sendgridKey()) return 'sendgrid'
  return null
}

export function isEmailConfigured(): boolean {
  return Boolean(activeProvider() && fromAddress())
}

export async function sendEmail(message: OutboundEmail): Promise<void> {
  const provider = activeProvider()
  if (!provider || !fromAddress()) {
    logger.warn('email not sent: no provider credential or ENTRY_EMAIL_FROM unset')
    return
  }

  if (provider === 'postmark') return sendViaPostmark(message)
  return sendViaSendgrid(message)
}

async function sendViaSendgrid(message: OutboundEmail): Promise<void> {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sendgridKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: message.to }],
          ...(message.cc.length ? { cc: message.cc.map((email) => ({ email })) } : {}),
        },
      ],
      from: { email: fromAddress(), name: fromName() },
      ...(replyToFor(message) ? { reply_to: { email: replyToFor(message) } } : {}),
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        { type: 'text/html', value: message.html },
      ],
      ...(message.attachments.length
        ? {
            attachments: message.attachments.map((a) => ({
              content: a.content,
              filename: a.filename,
              type: a.contentType,
              disposition: 'attachment',
            })),
          }
        : {}),
    }),
  })

  // The status alone cannot distinguish a bad key from an unverified sender,
  // and both are likely during setup, so the body goes into the error.
  if (!response.ok) {
    throw new Error(`SendGrid ${response.status}: ${await response.text()}`)
  }
  logger.info('email sent via SendGrid', { to: message.to })
}

async function sendViaPostmark(message: OutboundEmail): Promise<void> {
  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': postmarkToken(),
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      From: fromName() ? `${fromName()} <${fromAddress()}>` : fromAddress(),
      To: message.to,
      ...(message.cc.length ? { Cc: message.cc.join(',') } : {}),
      ...(replyToFor(message) ? { ReplyTo: replyToFor(message) } : {}),
      Subject: message.subject,
      TextBody: message.text,
      HtmlBody: message.html,
      // Postmark separates streams; transactional mail must not go out on a
      // broadcast stream or it is treated as marketing.
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM || 'outbound',
      ...(message.attachments.length
        ? {
            Attachments: message.attachments.map((a) => ({
              Name: a.filename,
              Content: a.content,
              ContentType: a.contentType,
            })),
          }
        : {}),
    }),
  })

  if (!response.ok) {
    throw new Error(`Postmark ${response.status}: ${await response.text()}`)
  }
  logger.info('email sent via Postmark', { to: message.to })
}
