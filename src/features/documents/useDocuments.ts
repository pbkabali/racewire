import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import type { DocumentFolder, EventDocument } from '../events/types'

type DocumentsState = {
  documents: EventDocument[]
  folders: DocumentFolder[]
  loading: boolean
  fromCache: boolean
  error: Error | null
}

/**
 * Documents and folders for one event, live.
 *
 * Two listeners rather than one join: Firestore has no joins, and folders are a
 * handful of tiny documents, so fetching both and grouping in memory is simpler
 * and cheaper than denormalising the folder name onto every document (which
 * would then need a fan-out update whenever a folder is renamed).
 */
export function useDocuments(eventCode: string): DocumentsState {
  const [state, setState] = useState<DocumentsState>({
    documents: [],
    folders: [],
    loading: true,
    fromCache: false,
    error: null,
  })

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }))

    const onError = (error: Error) => setState((s) => ({ ...s, loading: false, error }))

    const stopDocs = onSnapshot(
      query(
        collection(db, eventPath(eventCode, eventCollections.documents)),
        orderBy('documentNumber', 'asc'),
      ),
      (snap) => {
        setState((s) => ({
          ...s,
          documents: snap.docs.map((d) => ({ ...(d.data() as EventDocument), id: d.id })),
          loading: false,
          fromCache: snap.metadata.fromCache,
          error: null,
        }))
      },
      onError,
    )

    const stopFolders = onSnapshot(
      query(
        collection(db, eventPath(eventCode, eventCollections.folders)),
        orderBy('position', 'asc'),
      ),
      (snap) => {
        setState((s) => ({
          ...s,
          folders: snap.docs.map((d) => ({ ...(d.data() as DocumentFolder), id: d.id })),
        }))
      },
      onError,
    )

    return () => {
      stopDocs()
      stopFolders()
    }
  }, [eventCode])

  return state
}

export type GroupedDocuments = {
  folder: DocumentFolder | null
  documents: EventDocument[]
}[]

/** Folders in their configured order, then ungrouped documents last. */
export function groupDocuments(
  documents: EventDocument[],
  folders: DocumentFolder[],
): GroupedDocuments {
  const byFolder = new Map<string | null, EventDocument[]>()
  for (const document of documents) {
    // A document pointing at a deleted folder must still be reachable, so treat
    // a dangling folderId as ungrouped rather than dropping the document.
    const key = document.folderId && folders.some((f) => f.id === document.folderId)
      ? document.folderId
      : null
    const list = byFolder.get(key)
    if (list) list.push(document)
    else byFolder.set(key, [document])
  }

  const grouped: GroupedDocuments = folders
    .filter((folder) => byFolder.has(folder.id))
    .map((folder) => ({ folder, documents: byFolder.get(folder.id) ?? [] }))

  const ungrouped = byFolder.get(null)
  if (ungrouped?.length) grouped.push({ folder: null, documents: ungrouped })

  return grouped
}
