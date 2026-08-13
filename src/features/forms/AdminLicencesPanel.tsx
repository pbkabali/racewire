import { deleteDoc, doc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore'
import { useState, type FormEvent } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import { normaliseLicence, useLicences } from './useLicences'

/**
 * The organiser's list of valid competition licences.
 *
 * This is what stops the entry form being open to anyone: a competitor must
 * enter a number that appears here before they can begin.
 */
export function AdminLicencesPanel({ eventCode }: { eventCode: string }) {
  const { licences, loading } = useLicences(eventCode)
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function importPasted(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setResult(null)

    /*
     * One licence per line: number, then optionally name and expiry.
     * Comma or tab separated, so a paste straight out of a spreadsheet works
     * without anyone having to export a file.
     */
    const rows = paste
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/[,\t]/).map((cell) => cell.trim()))

    if (!rows.length) {
      setError('Nothing to import.')
      return
    }

    const seen = new Set<string>()
    const parsed: { number: string; holderName: string; expiresOn: Timestamp | null }[] = []
    const skipped: string[] = []

    for (const [rawNumber, holderName = '', rawExpiry = ''] of rows) {
      const number = normaliseLicence(rawNumber ?? '')
      if (!number) {
        skipped.push(rawNumber ?? '(blank)')
        continue
      }
      // A repeated number in one paste would otherwise produce two batch writes
      // to the same document, which Firestore rejects outright.
      if (seen.has(number)) continue
      seen.add(number)

      const date = rawExpiry ? new Date(rawExpiry) : null
      parsed.push({
        number,
        holderName,
        expiresOn:
          date && !Number.isNaN(date.getTime()) ? Timestamp.fromDate(date) : null,
      })
    }

    if (!parsed.length) {
      setError('No usable licence numbers found.')
      return
    }

    setBusy(true)
    try {
      for (let i = 0; i < parsed.length; i += 400) {
        const batch = writeBatch(db)
        for (const licence of parsed.slice(i, i + 400)) {
          batch.set(
            doc(db, eventPath(eventCode, eventCollections.licences), licence.number),
            { ...licence, active: true, addedAt: serverTimestamp() },
            // merge, so re-importing a longer list does not wipe a licence an
            // organiser has since deactivated by hand.
            { merge: true },
          )
        }
        await batch.commit()
      }

      setResult(
        `Imported ${parsed.length} licence${parsed.length === 1 ? '' : 's'}` +
          (skipped.length ? `, skipped ${skipped.length} unreadable line(s).` : '.'),
      )
      setPaste('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove(number: string) {
    if (!window.confirm(`Remove licence ${number}? They will not be able to start an entry.`)) {
      return
    }
    await deleteDoc(doc(db, eventPath(eventCode, eventCollections.licences), number))
  }

  return (
    <div className="space-y-6">
      <form onSubmit={importPasted} className="space-y-3 rounded-lg border border-edge bg-surface p-4">
        <div>
          <h2 className="font-semibold text-fg">Competition licences</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Only these numbers can start an entry form. Paste one per line, straight
            from a spreadsheet.
          </p>
        </div>

        <textarea
          rows={6}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={'UG1234, Jane Nakato, 2026-12-31\nUG1235, Peter Okello\nUG1236'}
          className="w-full rounded-md border border-edge bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-subtle"
        />
        <p className="text-xs text-fg-subtle">
          Number, then optionally name and expiry date. Comma or tab separated.
          Re-importing updates existing entries rather than duplicating them.
        </p>

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-fg disabled:opacity-60"
        >
          {busy ? 'Importing…' : 'Import licences'}
        </button>

        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
        {result && <p className="text-sm text-accent-text">{result}</p>}
      </form>

      <section>
        <h2 className="mb-2 font-semibold text-fg">
          On the list{!loading && ` (${licences.length})`}
        </h2>

        {loading ? (
          <div className="h-24 animate-pulse rounded-lg bg-surface" />
        ) : licences.length === 0 ? (
          <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
            No licences yet — nobody can start an entry form until some are added.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-edge bg-surface">
            {licences.map((licence) => (
              <li
                key={licence.number}
                className="flex items-center gap-3 border-b border-edge px-3 py-2 last:border-b-0"
              >
                <span className="flex-none font-mono text-xs text-accent-text">
                  {licence.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {licence.holderName || <span className="text-fg-subtle">no name recorded</span>}
                </span>
                {licence.expiresOn && (
                  <span className="flex-none text-xs text-fg-subtle">
                    exp {licence.expiresOn.toDate().toLocaleDateString()}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void remove(licence.number)}
                  className="flex-none text-xs font-semibold text-danger-text"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
