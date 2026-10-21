import { getFirestore } from 'firebase-admin/firestore'

/** One line of the published list. Three fields, and nothing else. */
export type EntryListRow = {
  driver: string
  codriver: string
  car: string
}

const PLACEHOLDER = '-'

/** Trim, and collapse the double spaces that typed-in fields always collect. */
const tidy = (text: string | undefined) => (text ?? '').trim().replace(/\s+/g, ' ')

/**
 * Given names in title case.
 *
 * Entry forms are typed by hand on phones, so the same field arrives as
 * "JOSEPH", "joseph" and "Joseph" across three entries; printing them as
 * typed makes the list look like a mistake rather than a document.
 *
 * A word that already mixes case is left exactly as it was. Somebody who
 * wrote McDonald or O'Brien meant it, and "correcting" that to Mcdonald would
 * be the kind of wrong that is worse than inconsistent. Only all-caps or
 * all-lowercase words are reshaped, which is precisely the set that carries no
 * intent to preserve.
 */
export function titleCase(text: string): string {
  return text.replace(/\S+/g, (word) => {
    if (word !== word.toLowerCase() && word !== word.toUpperCase()) return word
    return word
      .toLowerCase()
      .replace(/(^|[-'\u2019])(\p{L})/gu, (_, boundary: string, letter: string) =>
        boundary + letter.toUpperCase(),
      )
  })
}

/**
 * Names as they are read out, not as they are filed.
 *
 * First name first: "Joseph MUKASA", not "Mukasa, Joseph". A competitor
 * scanning for themselves looks for the name they are called by, and the
 * capitalised family name is the long-standing entry-list convention for
 * showing which of several names is the surname -- which is not guessable
 * from order alone across the nationalities a rally draws.
 */
function fullName(values: Record<string, string>, party: 'driver' | 'codriver'): string {
  const first = titleCase(tidy(values[`identity.firstName.${party}`]))
  const family = tidy(values[`identity.familyName.${party}`]).toUpperCase()
  return [first, family].filter(Boolean).join(' ')
}

/** Make and model as one field, capitalised to match the family names. */
function car(values: Record<string, string>): string {
  const make = tidy(values['car.make'])
  const model = tidy(values['car.model'])
  return [make, model].filter(Boolean).join(' ').toUpperCase()
}

/**
 * Build the list from the entries that exist right now.
 *
 * Read fresh on every call rather than accumulated incrementally: a list
 * assembled from deltas drifts the first time a write is missed, and a rally
 * entry list that is quietly wrong is worse than one that is briefly late.
 *
 * Submitted entries only. A draft is not yet a competitor, and publishing the
 * name of somebody who never finished entering is not a correctable mistake.
 */
export async function buildRows(eventCode: string): Promise<EntryListRow[]> {
  const snapshot = await getFirestore()
    .collection('events')
    .doc(eventCode)
    .collection('entries')
    .where('status', '==', 'submitted')
    .get()

  const rows: EntryListRow[] = snapshot.docs.map((document) => {
    const values = (document.data().values ?? {}) as Record<string, string>
    return {
      driver: fullName(values, 'driver') || PLACEHOLDER,
      codriver: fullName(values, 'codriver') || PLACEHOLDER,
      car: car(values) || PLACEHOLDER,
    }
  })

  /*
   * Sorted by the driver's first name, which is how the organiser asked for it
   * and how a competitor will look for themselves. localeCompare with numeric
   * off and sensitivity 'base' so case and accents do not split names apart.
   */
  rows.sort((a, b) =>
    a.driver.localeCompare(b.driver, undefined, { sensitivity: 'base' }),
  )

  return rows
}
