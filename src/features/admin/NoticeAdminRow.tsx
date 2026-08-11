import { useState, type FormEvent } from 'react'

import type { Notice, NoticeSeverity } from '../notices/types'

const severities: NoticeSeverity[] = ['info', 'warning', 'urgent']

export type NoticeEdits = {
  title: string
  body: string
  severity: NoticeSeverity
  pinned: boolean
}

/**
 * A published notice in the admin list, editable in place.
 *
 * Attachments are not editable here. Changing them means uploading or deleting
 * files, which is a different operation with different failure modes; the
 * common case is fixing wording or downgrading a severity that was set in
 * haste.
 */
export function NoticeAdminRow({
  notice,
  onSave,
  onDelete,
}: {
  notice: Notice
  onSave: (id: string, edits: NoticeEdits) => Promise<void>
  onDelete: (notice: Notice) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState(notice.title)
  const [body, setBody] = useState(notice.body)
  const [severity, setSeverity] = useState<NoticeSeverity>(notice.severity)
  const [pinned, setPinned] = useState(notice.pinned)

  function startEditing() {
    // Re-read each time, so a cancelled edit leaves nothing stale behind.
    setTitle(notice.title)
    setBody(notice.body)
    setSeverity(notice.severity)
    setPinned(notice.pinned)
    setError(null)
    setEditing(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || !body.trim()) {
      setError('Title and details are both required.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave(notice.id, {
        title: title.trim(),
        body: body.trim(),
        severity,
        pinned,
      })
      setEditing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <li className="border-b border-edge px-3 py-2 last:border-b-0">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex-none rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              notice.severity === 'urgent'
                ? 'bg-danger text-danger-fg'
                : notice.severity === 'warning'
                  ? 'bg-accent text-accent-fg'
                  : 'bg-surface-raised text-fg'
            }`}
          >
            {notice.severity}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-fg">
              {notice.title}
              {notice.pinned && (
                <span className="ml-2 text-[10px] font-normal text-accent-text">PINNED</span>
              )}
            </span>
            <span className="block truncate text-xs text-fg-subtle">
              {notice.body}
              {notice.updatedAt && ' · edited'}
            </span>
          </span>

          <button
            type="button"
            onClick={startEditing}
            className="flex-none text-xs font-semibold text-fg-muted hover:text-fg"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(notice)}
            className="flex-none text-xs font-semibold text-danger-text"
          >
            Delete
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="border-b border-edge px-3 py-3 last:border-b-0">
      <form onSubmit={save} className="space-y-3">
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg placeholder:text-fg-subtle"
        />

        <textarea
          required
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Details…"
          className="w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg placeholder:text-fg-subtle"
        />

        <div className="flex flex-wrap items-center gap-2">
          {severities.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSeverity(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize ${
                severity === value
                  ? 'bg-accent text-accent-fg'
                  : 'border border-edge text-fg-muted'
              }`}
            >
              {value}
            </button>
          ))}

          <label className="ml-auto flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="accent-accent"
            />
            Pin
          </label>
        </div>

        {notice.attachments && notice.attachments.length > 0 && (
          <p className="text-xs text-fg-subtle">
            {notice.attachments.length} attachment
            {notice.attachments.length === 1 ? '' : 's'} — unchanged by this edit
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-bold text-accent-fg disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md border border-edge px-4 py-1.5 text-sm font-semibold text-fg"
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  )
}
