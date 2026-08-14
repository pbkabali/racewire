import { getStorage } from 'firebase-admin/storage'
import { logger } from 'firebase-functions'

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
  /** Storage path of the generated PDF. Omitted if generation failed. */
  pdfPath: string | null
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

  const attachments: EmailAttachment[] = []

  if (entry.pdfPath) {
    try {
      const [buffer] = await getStorage().bucket().file(entry.pdfPath).download()
      attachments.push({
        content: buffer.toString('base64'),
        filename: `entry-${entry.licenceNumber}.pdf`,
        contentType: 'application/pdf',
      })
    } catch (cause) {
      // Send the confirmation anyway. Knowing the entry arrived matters more
      // than the attachment, and the organiser has the PDF regardless.
      logger.error('could not attach entry PDF', { path: entry.pdfPath, cause })
    }
  }

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
  })

  logger.info('entry confirmation sent', {
    to: entry.to,
    licence: entry.licenceNumber,
    attached: attachments.length > 0,
  })
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
    'This is an automated message — please contact the organiser with any questions.',
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
    This is an automated message — please contact the organiser with any questions.
  </p>
</div>`.trim()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
