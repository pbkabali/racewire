import { logger } from 'firebase-functions'

import { escapeHtml, mailtoLink, telLink } from './html.js'
import { isEmailConfigured, sendEmail, type EmailAttachment } from './providers.js'

/*
 * Entry confirmation email.
 *
 * Composition only -- which provider actually delivers it is decided in
 * providers.ts, so being locked out of one account does not stop
 * confirmations going.
 *
 * Configured through the environment rather than firebase-functions params, for
 * the same reason as everything else here: an unset param prompts at deploy
 * time and a bound-but-missing secret fails the whole deploy. Unset simply
 * means no email is sent, and that is logged.
 */

export { isEmailConfigured } from './providers.js'

export type EntryConfirmation = {
  to: string
  /** Copied in, so the crew have it too. Blank entries are dropped. */
  cc?: (string | undefined)[]
  eventName: string
  eventCode: string
  licenceNumber: string
  competitorName: string
  /** The generated PDF, already fetched. Null if generation or download failed. */
  attachment: EmailAttachment | null
  /**
   * Contact details recorded on the event. The email becomes the reply-to --
   * this is sent from a no-reply address, and an entry confirmation is exactly
   * the sort of mail people reply to with questions.
   */
  organiserEmail?: string
  organiserPhone?: string
}

export async function sendEntryConfirmation(entry: EntryConfirmation): Promise<void> {
  if (!isEmailConfigured()) {
    logger.warn('entry confirmation not sent: no email provider configured')
    return
  }

  if (!entry.to) {
    logger.warn('entry confirmation not sent: no recipient address', {
      licence: entry.licenceNumber,
    })
    return
  }

  // Sent regardless of whether the PDF made it: knowing the entry arrived
  // matters more than the attachment, and the organiser has it either way.
  const attachments = entry.attachment ? [entry.attachment] : []

  // Deduplicated and self-excluded: providers reject the whole request if the
  // same address appears in both to and cc.
  const seen = new Set([entry.to.toLowerCase()])
  const cc = (entry.cc ?? [])
    .filter((address): address is string => Boolean(address?.trim()))
    .filter((address) => {
      const key = address.trim().toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((address) => ({ email: address.trim() }))

  await sendEmail({
    to: entry.to,
    cc: cc.map((recipient) => recipient.email),
    subject: `Entry received — ${entry.eventName}`,
    text: plainBody(entry, attachments.length > 0),
    html: htmlBody(entry, attachments.length > 0),
    attachments,
    replyTo: entry.organiserEmail?.trim(),
  })

  logger.info('entry confirmation sent', {
    to: entry.to,
    licence: entry.licenceNumber,
    attached: attachments.length > 0,
    replyTo: entry.organiserEmail?.trim() || '(env default)',
  })
}

/**
 * How to reach the organiser, as one sentence.
 *
 * Falls back to naming the event when neither detail is recorded, since
 * "contact the organiser" with no way to do so is not much help. Events created
 * before the contact fields existed hit this until someone fills them in.
 */
function contactLine(entry: EntryConfirmation): string {
  const email = entry.organiserEmail?.trim()
  const phone = entry.organiserPhone?.trim()
  const ways = [email, phone].filter(Boolean).join(' or ')

  return ways
    ? `This is an automated message. For any questions, contact the organiser on ${ways}.`
    : `This is an automated message — please contact the organisers of ${entry.eventName} with any questions.`
}

function plainBody(entry: EntryConfirmation, attached: boolean): string {
  return [
    `Your entry for ${entry.eventName} has been received.`,
    '',
    `Competitor: ${entry.competitorName || entry.licenceNumber}`,
    `Competition licence: ${entry.licenceNumber}`,
    '',
    attached
      ? 'A copy of the completed entry form is attached.'
      : 'A copy of the form will follow from the organiser.',
    '',
    'The entry is only valid once the entry fee is paid and the receipt reaches',
    'the organiser before the closing date.',
    '',
    contactLine(entry),
  ].join('\n')
}

function htmlBody(entry: EntryConfirmation, attached: boolean): string {
  // Inline styles and a table-free layout: email clients strip stylesheets and
  // support for modern layout is unreliable.
  return `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#111">
  <p style="font-size:16px;font-weight:600;margin:0 0 12px">
    Your entry for ${escapeHtml(entry.eventName)} has been received.
  </p>
  <p style="margin:0 0 4px"><strong>Competitor:</strong> ${escapeHtml(
    entry.competitorName || entry.licenceNumber,
  )}</p>
  <p style="margin:0 0 16px"><strong>Competition licence:</strong> ${escapeHtml(
    entry.licenceNumber,
  )}</p>
  <p style="margin:0 0 16px">${
    attached
      ? 'A copy of the completed entry form is attached to this email.'
      : 'A copy of the form will follow from the organiser.'
  }</p>
  <p style="margin:0 0 16px;padding:12px;background:#fff8e1;border-left:3px solid #ffd400">
    The entry is only valid once the entry fee is paid and the receipt reaches the
    organiser before the closing date.
  </p>
  <p style="font-size:12px;color:#666;margin:0">
    ${contactHtml(entry)}
  </p>
</div>`.trim()
}

/**
 * The contact line with the details made clickable.
 *
 * Built by escaping the plain sentence and then linking the details within it,
 * so the two versions of the email cannot drift apart. Escaping first means the
 * anchors are the only markup that survives.
 */
function contactHtml(entry: EntryConfirmation): string {
  const email = entry.organiserEmail?.trim()
  const phone = entry.organiserPhone?.trim()
  let line = escapeHtml(contactLine(entry))

  if (email) line = line.replace(escapeHtml(email), mailtoLink(email))
  if (phone) line = line.replace(escapeHtml(phone), telLink(phone))

  return line
}
