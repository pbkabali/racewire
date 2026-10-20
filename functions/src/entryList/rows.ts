import { createHash } from 'node:crypto'

import { getFirestore } from 'firebase-admin/firestore'

/** One line of the published list. Three fields, and nothing else. */
export type EntryListRow = {
  driver: string
  codriver: string
  car: string
}

export type EntryListSnapshot = {
  rows: EntryListRow[]
  /**
   * Hash of exactly what will be printed.
   *
   * This is what stops the list being rebuilt constantly. Every keystroke on a
   * half-filled form writes the entry document, so a trigger that regenerated
   * on any write would re-render and re-upload a PDF while somebody types
   * their next of kin. Comparing the rendered content instead means a rebuild
   * happens only when a line on the page would actually differ -- and the same
   * check absorbs edits to fields this list does not show.
   */
  fingerprint: string
}

const PLACEHOLDER = '-'

/**
 * Names as they are read out, not as they are filed.
 *
 * First name first: "Joseph Mukasa", not "Mukasa, Joseph". A competitor
 * scanning for themselves looks for the name they are called by.
 */
function fullName(values: Record<string, string>, party: 'driver' | 'codriver'): string {
  const first = (values[`identity.firstName.${party}`] ?? '').trim()
  const family = (values[`identity.familyName.${party}`] ?? '').trim()
  return [first, family].filter(Boolean).join(' ')
}

function car(values: Record<string, string>): string {
  const make = (values['car.make'] ?? '').trim()
  const model = (values['car.model'] ?? '').trim()
  return [make, model].filter(Boolean).join(' ')
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
export async function buildSnapshot(eventCode: string): Promise<EntryListSnapshot> {
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

  const fingerprint = createHash('sha256').update(JSON.stringify(rows)).digest('hex')

  return { rows, fingerprint }
}
