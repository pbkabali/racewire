import { deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import { deleteAttachment } from '../../lib/firebase/storage'
import type { Notice } from '../notices/types'
import { useNotices } from '../notices/useNotices'
import { NoticeAdminRow, type NoticeEdits } from './NoticeAdminRow'
import { NoticeComposer } from './NoticeComposer'

/** Compose a notice, and manage the ones already published. */
export function AdminNoticesPanel({ eventCode }: { eventCode: string }) {
  const { notices, loading } = useNotices(eventCode)

  async function saveEdits(id: string, edits: NoticeEdits) {
    await updateDoc(doc(db, eventPath(eventCode, eventCollections.notices), id), {
      ...edits,
      // Recorded and shown, so a correction is visible rather than the wording
      // quietly changing under people who already acted on it.
      updatedAt: serverTimestamp(),
    })
  }

  async function remove(notice: Notice) {
    if (
      !window.confirm(
        `Delete “${notice.title}”? It disappears from the public board immediately.`,
      )
    ) {
      return
    }

    // Attachments first: a failure here leaves the notice visible, which is
    // recoverable. The reverse orphans files with nothing pointing at them.
    for (const attachment of notice.attachments ?? []) {
      try {
        await deleteAttachment(attachment.path)
      } catch {
        // Already gone is fine.
      }
    }

    await deleteDoc(doc(db, eventPath(eventCode, eventCollections.notices), notice.id))
  }

  return (
    <div className="space-y-6">
      <NoticeComposer eventCode={eventCode} />

      <section>
        <h2 className="mb-2 font-semibold text-fg">Published notices</h2>

        {loading ? (
          <div className="h-24 animate-pulse rounded-lg bg-surface" />
        ) : notices.length === 0 ? (
          <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
            Nothing published yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-edge bg-surface">
            {notices.map((notice) => (
              <NoticeAdminRow
                key={notice.id}
                notice={notice}
                onSave={saveEdits}
                onDelete={(n) => void remove(n)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
