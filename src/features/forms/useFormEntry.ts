import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import type { FormEntry, FormTypeId } from './types'

type EntryState = {
  entry: FormEntry | null
  loading: boolean
  error: Error | null
}

/**
 * The filler's own entry for one document: loaded if they have started before,
 * created on first save.
 *
 * Resume works because the entry is keyed to their verified phone uid, so
 * returning on any device after the same verification finds the same draft.
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
  const [state, setState] = useState<EntryState>({ entry: null, loading: true, error: null })

  // Deterministic id, so a second tab or a repeated visit cannot create a
  // second draft for the same person and document. Firestore ids allow this
  // charset; the licence is already normalised to A-Z0-9 upstream.
  const entryId = `${uid}_${documentId}`
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
    getDocs(
      query(
        collection(db, eventPath(eventCode, eventCollections.entries)),
        where('uid', '==', uid),
        where('documentId', '==', documentId),
        limit(1),
      ),
    )
      .then((snap) => {
        if (cancelled) return
        const found = snap.docs[0]
        setState({
          entry: found ? ({ ...(found.data() as FormEntry), id: found.id }) : null,
          loading: false,
          error: null,
        })
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ entry: null, loading: false, error })
      })

    return () => {
      cancelled = true
    }
  }, [eventCode, documentId, uid])

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
