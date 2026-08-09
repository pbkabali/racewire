import { useRef, useState } from 'react'

import {
  ALLOWED_MIME,
  formatBytes,
  MAX_UPLOAD_BYTES,
  uploadAttachment,
  type Attachment,
} from '../../lib/firebase/storage'
import { useOnlineStatus } from '../../lib/hooks/useOnlineStatus'

type Pending = {
  id: string
  name: string
  progress: number
  error?: string
}

export function AttachmentUploader({
  attachments,
  onChange,
}: {
  attachments: Attachment[]
  onChange: (next: Attachment[]) => void
}) {
  const online = useOnlineStatus()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending[]>([])

  function handleFiles(files: FileList | null) {
    if (!files?.length) return

    for (const file of Array.from(files)) {
      // Local id: the storage path does not exist until the upload starts, and
      // name alone collides when the same file is picked twice.
      const id = `${file.name}-${file.size}-${pending.length}-${performance.now()}`
      setPending((p) => [...p, { id, name: file.name, progress: 0 }])

      let handle
      try {
        handle = uploadAttachment(file)
      } catch (cause) {
        setPending((p) =>
          p.map((item) =>
            item.id === id
              ? { ...item, error: cause instanceof Error ? cause.message : 'Upload failed' }
              : item,
          ),
        )
        continue
      }

      handle.task.on('state_changed', (snapshot) => {
        const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
        setPending((p) => p.map((item) => (item.id === id ? { ...item, progress } : item)))
      })

      handle.done
        .then((attachment) => {
          setPending((p) => p.filter((item) => item.id !== id))
          onChange([...attachments, attachment])
        })
        .catch((cause: unknown) => {
          setPending((p) =>
            p.map((item) =>
              item.id === id
                ? { ...item, error: cause instanceof Error ? cause.message : 'Upload failed' }
                : item,
            ),
          )
        })
    }

    // Reset so picking the same file again still fires a change event.
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALLOWED_MIME.join(',')}
          onChange={(event) => handleFiles(event.target.files)}
          className="hidden"
          id="attachment-input"
        />
        <label
          htmlFor="attachment-input"
          className="cursor-pointer rounded-md border border-edge px-3 py-1.5 text-sm font-semibold text-fg"
        >
          Attach files
        </label>
        <span className="text-xs text-fg-subtle">
          Images or PDF, up to {formatBytes(MAX_UPLOAD_BYTES)}
        </span>
      </div>

      {!online && (
        <p className="text-xs text-danger-text">
          Uploads need a connection — unlike notices, files cannot be queued offline.
        </p>
      )}

      {pending.map((item) => (
        <div key={item.id} className="rounded border border-edge px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="min-w-0 flex-1 truncate text-fg">{item.name}</span>
            <span className={item.error ? 'text-danger-text' : 'text-fg-subtle'}>
              {item.error ?? `${item.progress}%`}
            </span>
          </div>
          {!item.error && (
            <div className="mt-1 h-1 overflow-hidden rounded bg-surface-raised">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${item.progress}%` }}
              />
            </div>
          )}
        </div>
      ))}

      {attachments.length > 0 && (
        <ul className="space-y-1">
          {attachments.map((attachment) => (
            <li
              key={attachment.path}
              className="flex items-center gap-2 rounded border border-edge px-3 py-1.5 text-xs"
            >
              <span className="min-w-0 flex-1 truncate text-fg">{attachment.name}</span>
              <span className="text-fg-subtle">{formatBytes(attachment.size)}</span>
              <button
                type="button"
                onClick={() => onChange(attachments.filter((a) => a.path !== attachment.path))}
                className="text-danger-text"
                aria-label={`Remove ${attachment.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
