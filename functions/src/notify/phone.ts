/*
 * Turning what people typed into something a gateway will accept.
 *
 * Numbers reach us from three places with three different habits: an entry
 * form filled on a phone ("0772 123 456"), an admin pasting from a contact
 * list ("+256772123456"), and a championship registration export that may use
 * either. Twilio and Meta both want E.164 and reject anything else.
 *
 * The rule here is to normalise only what can be normalised unambiguously, and
 * to return null otherwise. A race notice sent to a misread number is worse
 * than one not sent at all: the competitor is not told, and nothing in the log
 * says so -- the send succeeded, just to somebody else. A null is visible.
 */

/*
 * Dial codes for the countries this is plausibly run in: all of Africa, plus
 * the places entrants and officials commonly travel from. An event in a
 * country not listed still works for anyone who typed a full +… number; only
 * the local "0…" shorthand needs the code, and adding one is a one-line change.
 */
const DIAL_CODES: Record<string, string> = {
  AO: '244', BF: '226', BI: '257', BJ: '229', BW: '267', CD: '243', CF: '236',
  CG: '242', CI: '225', CM: '237', CV: '238', DJ: '253', DZ: '213', EG: '20',
  ER: '291', ET: '251', GA: '241', GH: '233', GM: '220', GN: '224', GQ: '240',
  GW: '245', KE: '254', KM: '269', LR: '231', LS: '266', LY: '218', MA: '212',
  MG: '261', ML: '223', MR: '222', MU: '230', MW: '265', MZ: '258', NA: '264',
  NE: '227', NG: '234', RW: '250', SC: '248', SD: '249', SL: '232', SN: '221',
  SO: '252', SS: '211', ST: '239', SZ: '268', TD: '235', TG: '228', TN: '216',
  TZ: '255', UG: '256', ZA: '27', ZM: '260', ZW: '263',

  AE: '971', AU: '61', BE: '32', BR: '55', CA: '1', CH: '41', CN: '86',
  CZ: '420', DE: '49', DK: '45', ES: '34', FI: '358', FR: '33', GB: '44',
  IE: '353', IN: '91', IT: '39', JP: '81', NL: '31', NO: '47', NZ: '64',
  PL: '48', PT: '351', QA: '974', SA: '966', SE: '46', TR: '90', US: '1',
}

/** Shortest and longest a subscriber number runs to in E.164, excluding the +. */
const MIN_DIGITS = 8
const MAX_DIGITS = 15

/**
 * Normalise one number to E.164, or return null if it cannot be done safely.
 *
 * `countryCode` is the event's ISO country, used only to expand a local
 * "0…" number. Everything else is resolved from the number itself.
 */
export function toE164(raw: string | undefined | null, countryCode?: string): string | null {
  if (!raw) return null

  // Strip everything a human might have typed around the digits: spaces,
  // dashes, brackets, and the (0) some people write in international form.
  const cleaned = String(raw).trim().replace(/\(0\)/g, '').replace(/[^\d+]/g, '')
  if (!cleaned) return null

  const dial = DIAL_CODES[(countryCode ?? '').toUpperCase()]

  let digits: string

  if (cleaned.startsWith('+')) {
    digits = cleaned.slice(1)
  } else if (cleaned.startsWith('00')) {
    // International prefix as dialled from a landline.
    digits = cleaned.slice(2)
  } else if (cleaned.startsWith('0')) {
    // National format. Only resolvable if we know which country we are in.
    if (!dial) return null
    digits = dial + cleaned.slice(1)
  } else if (dial && cleaned.startsWith(dial)) {
    // Already carries the country code, just without the +.
    digits = cleaned
  } else {
    /*
     * A bare national number with no trunk zero ("772123456"). Guessing the
     * country here is exactly the misdelivery this function exists to avoid,
     * so it is refused even though it is usually obvious to a human.
     */
    return null
  }

  if (!/^\d+$/.test(digits)) return null
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null

  return `+${digits}`
}
