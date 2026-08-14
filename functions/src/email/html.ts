/**
 * Escaping for the HTML half of an email.
 *
 * Everything interpolated into a message body is competitor-supplied -- names,
 * addresses, car details typed into a form -- so it goes through here first.
 * A stray `<` would break the markup long before anyone tried anything worse.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** An email address as a clickable, escaped `mailto:` link. */
export function mailtoLink(address: string): string {
  return `<a href="mailto:${escapeHtml(address)}" style="color:#856800">${escapeHtml(address)}</a>`
}

/** A phone number as a clickable `tel:` link, spaces stripped from the href only. */
export function telLink(number: string): string {
  return `<a href="tel:${escapeHtml(number.replace(/\s+/g, ''))}" style="color:#856800">${escapeHtml(
    number,
  )}</a>`
}
