import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import type { FormEntry, FormTypeId } from './types'

type EntryState = {
  entry: FormEntry | null
  loading: boolean
  error: Error | null
  /** Someone else already started an entry for this licence. */
  takenByAnother: boolean
}

/**
 * The filler's own entry for one document: loaded if they have started before,
 * created on first save.
 *
 * Resume works because the entry is keyed to the licence, so returning on any
 * device -- after verifying any phone -- finds the same draft, provided it is
 * the same person who started it.
 */
export function useFormEntry({
  eventCode,
  documentId,
  formType,
  uid,
  phone,
  licenceNumber,
}: {
  eventCode: string
  documentId: string
  formType: FormTypeId
  uid: string
  phone: string
  licenceNumber: string
}) {
  const [state, setState] = useState<EntryState>({
    entry: null,
    loading: true,
    error: null,
    takenByAnother: false,
  })

  /*
   * Keyed by LICENCE, not by uid.
   *
   * The entry belongs to a competitor, and the licence is who they are; the
   * phone is only how they were verified. Keying on uid meant one phone could
   * hold just one entry per form -- so a second licence verified from the same
   * phone reopened the first one's submitted entry -- while the same licence
   * filed from two phones would have produced two entries, defeating the gate
   * the licence check exists to provide.
   *
   * Both parts are safe as an id: the licence is normalised to A-Z0-9 upstream
   * and documentId is a Firestore auto-id.
   */
  const entryId = `${licenceNumber}_${documentId}`
  const entryRef = useCallback(
    () => doc(db, eventPath(eventCode, eventCollections.entries), entryId),
    [eventCode, entryId],
  )

  useEffect(() => {
    let cancelled = false

    /*
     * A one-off read rather than a live listener. A live entry would fight the
     * form: every keystroke saves, the snapshot echoes back, and the field the
     * person is typing in gets reset under them.
     */
    getDoc(entryRef())
      .then((snap) => {
        if (cancelled) return
        setState({
          entry: snap.exists() ? { ...(snap.data() as FormEntry), id: snap.id } : null,
          loading: false,
          error: null,
          takenByAnother: false,
        })
      })
      .catch((error: Error & { code?: string }) => {
        if (cancelled) return
        // Rules allow reading an entry only to its own filer or an admin, so a
        // denial here means the entry exists and belongs to somebody else.
        const denied = error.code === 'permission-denied'
        setState({
          entry: null,
          loading: false,
          error: denied ? null : error,
          takenByAnother: denied,
        })
      })

    return () => {
      cancelled = true
    }
  }, [entryRef])

  const saving = useRef(false)

  /** Persist the current answers. Creates the entry on first call. */
  const saveDraft = useCallback(
    async (values: Record<string, string>) => {
      if (saving.current) return
      saving.current = true
      try {
        await setDoc(
          entryRef(),
          {
            formType,
            documentId,
            values,
            status: 'draft',
            licenceNumber,
            phone,
            uid,
            updatedAt: serverTimestamp(),
            // Only on create; merge leaves the original in place afterwards.
            createdAt: serverTimestamp(),
          },
          { merge: true },
        )
      } finally {
        saving.current = false
      }
    },
    [entryRef, formType, documentId, licenceNumber, phone, uid],
  )

  /** Mark the entry submitted. Rules stop the filler editing it after this. */
  const markSubmitted = useCallback(
    async (extra: { signatures: Record<string, string>; pdfPath: string | null }) => {
      await updateDoc(entryRef(), {
        ...extra,
        status: 'submitted',
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    },
    [entryRef],
  )

  return { ...state, entryId, saveDraft, markSubmitted }
}
