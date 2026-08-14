import { logger } from 'firebase-functions'

import { escapeHtml, mailtoLink, telLink } from './html.js'
import {
  isEmailConfigured,
  replyTo as fallbackReplyTo,
  sendEmail,
  type EmailAttachment,
} from './providers.js'

/*
 * Tells the organiser an entry has landed.
 *
 * A separate message from the entrant's confirmation rather than a cc on it.
 * The two audiences want different things: the competitor wants reassurance,
 * the organiser wants the details to act on and a way to reach the person. A
 * cc would also expose each side's address to the other, which is not the
 * organiser's to give away.
 */

export type EntryNotification = {
  /** The event's contact address. Falls back to ENTRY_EMAIL_REPLY_TO. */
  to: string
  eventName: string
  eventCode: string
  licenceNumber: string
  competitorName: string
  /** The number that passed OTP -- reachable by definition, unlike a typed one. */
  verifiedPhone: string
  /** Whatever the entrant typed; used as the reply-to so Reply reaches them. */
  entrantEmail: string
  /** Free-form label, e.g. "Subaru Impreza · UAX 123X". Blank if not given. */
  car: string
  attachment: EmailAttachment | null
}

export async function sendEntryNotification(entry: EntryNotification): Promise<void> {
  if (!isEmailConfigured()) {
    logger.warn('entry notification not sent: no email provider configured')
    return
  }

  // Deliberately loud. A silently un-notified organiser is the whole failure
  // this feature exists to prevent, and it looks identical to working.
  const to = entry.to.trim() || fallbackReplyTo()
  if (!to) {
    logger.error('NOBODY NOTIFIED of a new entry: the event has no contact email and ' +
      'ENTRY_EMAIL_REPLY_TO is unset', {
      event: entry.eventCode,
      licence: entry.licenceNumber,
    })
    return
  }

  await sendEmail({
    to,
    cc: [],
    // Front-loaded so it reads in a notification preview without opening:
    // which event, who, and that it is new.
    subject: `New entry — ${entry.eventCode} — ${entry.licenceNumber} ${entry.competitorName}`.trim(),
    text: plainBody(entry),
    html: htmlBody(entry),
    attachments: entry.attachment ? [entry.attachment] : [],
    // Reply goes to the competitor, not to no-reply@ and not back to the
    // organiser themselves. Chasing a missing licence or fee is the most
    // likely next action, and it should take one keystroke.
    replyTo: entry.entrantEmail.trim(),
  })

  logger.info('entry notification sent', {
    to,
    event: entry.eventCode,
    licence: entry.licenceNumber,
    usedFallback: !entry.to.trim(),
  })
}

/**
 * Where to review it.
 *
 * APP_BASE_URL when set, otherwise the project's default Firebase domain --
 * which is right for staging and wrong only where a custom domain is in use,
 * and a slightly-off link beats no link.
 */
function adminUrl(eventCode: string): string {
  const base = (
    process.env.APP_BASE_URL || `https://${process.env.GCLOUD_PROJECT ?? ''}.web.app`
  ).replace(/\/+$/, '')
  return `${base}/admin/e/${encodeURIComponent(eventCode)}`
}

/** Label / value pairs, blanks dropped, in the order an organiser scans them. */
function details(entry: EntryNotification): [string, string][] {
  return (
    [
      ['Competitor', entry.competitorName],
      ['Competition licence', entry.licenceNumber],
      ['Phone (verified)', entry.verifiedPhone],
      ['Email', entry.entrantEmail],
      ['Car', entry.car],
    ] as [string, string][]
  ).filter(([, value]) => Boolean(value?.trim()))
}

function plainBody(entry: EntryNotification): string {
  return [
    `A new entry has been submitted for ${entry.eventName}.`,
    '',
    ...details(entry).map(([label, value]) => `${label}: ${value}`),
    '',
    entry.attachment
      ? 'The completed entry form is attached.'
      : 'The entry form PDF could not be attached; it is on the entries screen.',
    '',
    `Review it: ${adminUrl(entry.eventCode)}`,
    '',
    'Replying to this email reaches the competitor.',
  ].join('\n')
}

function htmlBody(entry: EntryNotification): string {
  // Inline styles, no stylesheet: mail clients strip <style> blocks.
  const rows = details(entry)
    .map(([label, value]) => {
      const shown =
        label === 'Email'
          ? mailtoLink(value)
          : label.startsWith('Phone')
            ? telLink(value)
            : escapeHtml(value)
      return `<p style="margin:0 0 4px"><strong>${escapeHtml(label)}:</strong> ${shown}</p>`
    })
    .join('\n  ')

  return `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#111">
  <p style="font-size:16px;font-weight:600;margin:0 0 12px">
    New entry for ${escapeHtml(entry.eventName)}
  </p>
  ${rows}
  <p style="margin:16px 0">${
    entry.attachment
      ? 'The completed entry form is attached.'
      : 'The entry form PDF could not be attached; it is on the entries screen.'
  }</p>
  <p style="margin:0 0 16px">
    <a href="${escapeHtml(adminUrl(entry.eventCode))}"
       style="display:inline-block;padding:10px 16px;background:#ffd400;color:#111;
              font-weight:700;text-decoration:none;border-radius:6px">
      Review this entry
    </a>
  </p>
  <p style="font-size:12px;color:#666;margin:0">
    Replying to this email reaches the competitor.
  </p>
</div>`.trim()
}
