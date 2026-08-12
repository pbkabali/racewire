import { collection, doc, getDoc, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import type { Licence } from './types'

/**
 * Licence numbers are normalised before use as document ids: organisers type
 * them inconsistently ("UG/123", "ug 123") and a competitor will not reproduce
 * the punctuation exactly. Stripping to alphanumerics and upper-casing makes
 * the lookup forgiving without making it loose.
 */
export function normaliseLicence(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Live list of licences for an event. Admin-only in practice; rules enforce it. */
export function useLicences(eventCode: string) {
  const [licences, setLicences] = useState<Licence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const q = query(
      collection(db, eventPath(eventCode, eventCollections.licences)),
      orderBy('holderName', 'asc'),
    )
    return onSnapshot(
      q,
      (snap) => {
        setLicences(snap.docs.map((d) => ({ ...(d.data() as Licence), number: d.id })))
        setLoading(false)
      },
      (cause) => {
        setError(cause)
        setLoading(false)
      },
    )
  }, [eventCode])

  return { licences, loading, error }
}

export type LicenceCheck =
  | { ok: true; licence: Licence }
  | { ok: false; reason: 'not-found' | 'inactive' | 'expired' }

/**
 * Check one licence, by direct document read rather than a query.
 *
 * A competitor is not an admin and cannot list the collection — the rules allow
 * reading a single licence by id and nothing else. That is deliberate: the list
 * is personal data, and a query would hand over every competitor's name.
 */
export async function checkLicence(
  eventCode: string,
  rawNumber: string,
): Promise<LicenceCheck> {
  const number = normaliseLicence(rawNumber)
  if (!number) return { ok: false, reason: 'not-found' }

  const snap = await getDoc(doc(db, eventPath(eventCode, eventCollections.licences), number))
  if (!snap.exists()) return { ok: false, reason: 'not-found' }

  const licence = { ...(snap.data() as Licence), number: snap.id }
  if (!licence.active) return { ok: false, reason: 'inactive' }

  if (licence.expiresOn && licence.expiresOn.toDate() < new Date()) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true, licence }
}
