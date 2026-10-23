import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { useState, type ClipboardEvent, type FormEvent } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import { htmlTableToTsv } from '../schedule/htmlTable'
import { parseSchedule, type Draft } from '../schedule/parseSchedule'
import type { ScheduleItem } from '../schedule/types'
import { useSchedule } from '../schedule/useSchedule'

const EMPTY: Draft = { day: '', activity: '', when: '', place: '' }

/** The rally programme: what it says, what order it is in, and how to load it. */
export function AdminSchedulePanel({ eventCode }: { eventCode: string }) {
  const { items } = useSchedule(eventCode)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const path = eventPath(eventCode, eventCollections.schedule)
  const ref = (id: string) => doc(db, path, id)

  /** Write a contiguous 0..n-1 ordering for the list as given. */
  async function reposition(next: ScheduleItem[]) {
    const batch = writeBatch(db)
    next.forEach((item, index) => {
      if (item.position !== index) batch.update(ref(item.id), { position: index })
    })
    await batch.commit()
  }

  /*
   * Swap with the neighbour, both writes in one batch.
   *
   * Two separate updates could interleave with another organiser's reorder and
   * leave two items sharing a position, which on a schedule shows up as two
   * activities silently swapping places.
   */
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const a = next[index]
    const b = next[target]
    if (!a || !b) return
    next[index] = b
    next[target] = a
    await reposition(next)
  }

  /** Add an item at a given position, pushing everything below it down. */
  async function insertAt(index: number, draft: Draft) {
    setBusy(true)
    setError(null)
    try {
      const batch = writeBatch(db)
      items.slice(index).forEach((item, offset) => {
        batch.update(ref(item.id), { position: index + offset + 1 })
      })
      batch.set(doc(collection(db, path)), {
        ...draft,
        position: index,
        createdAt: serverTimestamp(),
      })
      await batch.commit()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add that item')
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: ScheduleItem, index: number) {
    if (!window.confirm(`Remove "${item.activity}" from the schedule?`)) return
    await deleteDoc(ref(item.id))
    await reposition(items.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-6">
      <ImportCard
        eventCode={eventCode}
        existing={items.length}
        onError={setError}
      />

      {error && (
        <p className="rounded-lg border border-danger bg-surface p-3 text-sm text-danger-text">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 font-semibold text-fg">Programme</h2>

        {items.length === 0 ? (
          <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
            Nothing scheduled yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item, index) => (
              <Row
                key={item.id}
                item={item}
                index={index}
                total={items.length}
                busy={busy}
                eventCode={eventCode}
                onMove={move}
                onRemove={remove}
                onInsertBelow={(draft) => insertAt(index + 1, draft)}
              />
            ))}
          </ul>
        )}
      </section>

      <AddForm
        label="Add to the end"
        busy={busy}
        onSubmit={(draft) => insertAt(items.length, draft)}
      />
    </div>
  )
}

function Row({
  item,
  index,
  total,
  busy,
  eventCode,
  onMove,
  onRemove,
  onInsertBelow,
}: {
  item: ScheduleItem
  index: number
  total: number
  busy: boolean
  eventCode: string
  onMove: (index: number, direction: -1 | 1) => Promise<void>
  onRemove: (item: ScheduleItem, index: number) => Promise<void>
  onInsertBelow: (draft: Draft) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [inserting, setInserting] = useState(false)
  const [draft, setDraft] = useState<Draft>(item)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await updateDoc(doc(db, eventPath(eventCode, eventCollections.schedule), item.id), {
        ...draft,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="rounded-lg border border-edge bg-surface p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <Field label="Day heading" value={draft.day} onChange={(day) => setDraft({ ...draft, day })} placeholder="Friday 30 October 2026" />
              <Field label="Activity" value={draft.activity} onChange={(activity) => setDraft({ ...draft, activity })} placeholder="Scrutineering" />
              <Field label="When" value={draft.when} onChange={(when) => setDraft({ ...draft, when })} placeholder="13:00 - 17:00hrs" />
              <Field label="Place" value={draft.place} onChange={(place) => setDraft({ ...draft, place })} placeholder="Shell Kyenjojo" />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(item)
                    setEditing(false)
                  }}
                  className="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-fg"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="truncate text-[10px] font-bold tracking-wide text-fg-subtle uppercase">
                {item.day || 'No day heading'}
              </p>
              <p className="truncate text-sm font-semibold text-fg">{item.activity}</p>
              <p className="truncate text-xs text-fg-muted">
                {[item.when, item.place].filter(Boolean).join(' · ')}
              </p>
            </>
          )}
        </div>

        {!editing && (
          <div className="flex flex-none items-center gap-1">
            <button
              type="button"
              onClick={() => void onMove(index, -1)}
              disabled={index === 0}
              aria-label="Move up"
              className="rounded border border-edge px-2 py-1 text-xs text-fg disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => void onMove(index, 1)}
              disabled={index === total - 1}
              aria-label="Move down"
              className="rounded border border-edge px-2 py-1 text-xs text-fg disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-edge px-2 py-1 text-xs text-fg"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {!editing && (
        <div className="mt-2 flex gap-3 text-xs">
          <button
            type="button"
            onClick={() => setInserting((open) => !open)}
            className="text-accent-text underline"
          >
            {inserting ? 'Cancel insert' : 'Insert below'}
          </button>
          <button
            type="button"
            onClick={() => void onRemove(item, index)}
            className="text-danger-text underline"
          >
            Remove
          </button>
        </div>
      )}

      {inserting && (
        <div className="mt-3 border-t border-edge pt-3">
          <AddForm
            label="New item, below this one"
            busy={busy}
            // Inherits the day so inserting into the middle of a day does not
            // silently start a new heading.
            initial={{ ...EMPTY, day: item.day }}
            onSubmit={async (draft) => {
              await onInsertBelow(draft)
              setInserting(false)
            }}
          />
        </div>
      )}
    </li>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold tracking-wide text-fg-muted uppercase">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full rounded-md border border-edge bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
      />
    </label>
  )
}

function AddForm({
  label,
  busy,
  initial,
  onSubmit,
}: {
  label: string
  busy: boolean
  initial?: Draft
  onSubmit: (draft: Draft) => Promise<void>
}) {
  const [draft, setDraft] = useState<Draft>(initial ?? EMPTY)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft.activity.trim()) return
    await onSubmit(draft)
    setDraft(initial ?? EMPTY)
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2 rounded-lg border border-edge bg-surface p-3">
      <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{label}</h3>
      <Field label="Day heading" value={draft.day} onChange={(day) => setDraft({ ...draft, day })} placeholder="Friday 30 October 2026" />
      <Field label="Activity" value={draft.activity} onChange={(activity) => setDraft({ ...draft, activity })} placeholder="Scrutineering" />
      <Field label="When" value={draft.when} onChange={(when) => setDraft({ ...draft, when })} placeholder="13:00 - 17:00hrs" />
      <Field label="Place" value={draft.place} onChange={(place) => setDraft({ ...draft, place })} placeholder="Shell Kyenjojo" />
      <button
        type="submit"
        disabled={busy || !draft.activity.trim()}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-60"
      >
        Add
      </button>
    </form>
  )
}

function ImportCard({
  eventCode,
  existing,
  onError,
}: {
  eventCode: string
  existing: number
  onError: (message: string | null) => void
}) {
  const [paste, setPaste] = useState('')
  const [replace, setReplace] = useState(false)
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState<number | null>(null)

  const { items: parsed, tabless } = paste.trim()
    ? parseSchedule(paste)
    : { items: [], tabless: 0 }

  /*
   * Take the table off the clipboard rather than the text.
   *
   * Google Docs' plain-text flavour of a table has no column separators at
   * all, so a straight paste arrives as one undifferentiated block. Its HTML
   * flavour is the real table, in every editor worth pasting from. Appends
   * rather than replaces, so a programme split across two tables can be
   * pasted in two goes.
   */
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const tsv = htmlTableToTsv(event.clipboardData.getData('text/html'))
    // No table on the clipboard: let the ordinary plain-text paste happen.
    if (!tsv) return
    event.preventDefault()
    setPaste((current) => (current.trim() ? `${current.trimEnd()}\n${tsv}` : tsv))
  }

  async function run() {
    setImporting(true)
    onError(null)
    setDone(null)
    try {
      const path = eventPath(eventCode, eventCollections.schedule)
      const batch = writeBatch(db)

      let start = existing
      if (replace) {
        const current = await getDocs(collection(db, path))
        for (const document of current.docs) batch.delete(document.ref)
        start = 0
      }

      parsed.forEach((draft, index) => {
        batch.set(doc(collection(db, path)), {
          ...draft,
          position: start + index,
          createdAt: serverTimestamp(),
        })
      })

      await batch.commit()
      setDone(parsed.length)
      setPaste('')
      setReplace(false)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not import that schedule')
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="rounded-lg border border-edge bg-surface p-4">
      <h2 className="font-semibold text-fg">Import the programme</h2>
      <p className="mt-1 text-xs text-fg-subtle">
        Copy the programme table out of the regulations — Google Docs, Word or Excel —
        and paste it here. Columns are read as{' '}
        <strong className="font-semibold">Activity, Date, Time, Place</strong>. Merged
        date cells carry down, so a table with one date spanning a day's rows still
        groups correctly.
      </p>

      <textarea
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        onPaste={onPaste}
        rows={5}
        placeholder={'Scrutineering\tFriday 30th October, 2026\t13:00 - 17:00hrs\tShell Kyenjojo'}
        className="mt-3 w-full rounded-md border border-edge bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-fg-subtle"
      />

      {parsed.length > 0 && (
        <p className="mt-2 text-xs text-fg-muted">
          {parsed.length} item{parsed.length === 1 ? '' : 's'} found.
        </p>
      )}

      {/* Saying so beats splitting on commas and hoping: every date in a
          programme has one, so a guess would shift every column along. */}
      {tabless > 0 && (
        <p className="mt-2 text-xs text-danger-text">
          {tabless} line{tabless === 1 ? '' : 's'} had no column breaks, so the whole line
          became the activity. Copy the table itself from Word or Excel rather than
          typing the rows.
        </p>
      )}

      {existing > 0 && (
        <label className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
          />
          Replace the {existing} item{existing === 1 ? '' : 's'} already there
        </label>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={importing || parsed.length === 0}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-60"
        >
          {importing ? 'Importing…' : replace ? 'Replace schedule' : 'Add to schedule'}
        </button>
        {done !== null && (
          <span className="text-xs text-fg-muted">Imported {done}.</span>
        )}
      </div>
    </section>
  )
}
