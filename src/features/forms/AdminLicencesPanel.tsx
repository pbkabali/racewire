import { deleteDoc, doc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore'
import { useState, type FormEvent } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import type { LicenceDetails } from './types'
import { licenceDetailsRef, normaliseLicence, useLicences } from './useLicences'

/** Header cells are matched stripped of case and punctuation. */
const normHeader = (cell: string) => cell.toLowerCase().replace(/[^a-z0-9]/g, '')

type ParsedLicence = {
  number: string
  holderName: string
  expiresOn: Timestamp | null
  /** Present when the paste was the FMU registration export. */
  details: LicenceDetails | null
}

type ParseResult = {
  parsed: ParsedLicence[]
  /** Rows with nothing usable as a licence number. */
  skipped: string[]
  /** FMU rows for riders and officials, who cannot enter a rally. */
  skippedNonCrew: number
}

/**
 * Dates as a spreadsheet renders them, to `yyyy-mm-dd`.
 *
 * ISO passes through. Slashed or dotted dates are read day-first (Ugandan
 * Excel writes 04/09/2026), except that an impossible day-first reading with
 * a possible month-first one is swapped rather than dropped. Anything else
 * gets one attempt via Date, for month-name forms. Failures become blank: a
 * blank field is fixable on the entry form, a wrong date is invisible.
 */
function parseSheetDate(raw: string): string {
  const s = raw.trim()
  if (!s) return ''

  const pad = (n: number) => String(n).padStart(2, '0')
  const iso = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : ''

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))

  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) {
    let day = Number(m[1])
    let month = Number(m[2])
    let year = Number(m[3])
    if (month > 12 && day <= 12) [day, month] = [month, day]
    // Two-digit years pivot at 50: birth years land in the 1900s, expiries ahead.
    if (year < 100) year += year >= 50 ? 1900 : 2000
    return iso(year, month, day)
  }

  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime())
    ? ''
    : iso(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
}

/**
 * Ugandan phone numbers as spreadsheets mangle them: a numeric cell eats the
 * leading zero (772676207), and country-coded values arrive bare (2567…).
 * Anything unrecognised is kept as typed rather than guessed at.
 */
function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 9) return `0${digits}`
  if (digits.length === 12 && digits.startsWith('256')) return `+${digits}`
  return raw.trim()
}

/** The FMU registration export, recognised by its header row. */
function parseFmuExport(lines: string[][], header: string[]): ParseResult {
  const at = (row: string[], name: string) => {
    const index = header.indexOf(name)
    return index === -1 ? '' : (row[index] ?? '')
  }

  const seen = new Set<string>()
  const parsed: ParsedLicence[] = []
  const skipped: string[] = []
  let skippedNonCrew = 0

  for (const row of lines.slice(1)) {
    const competitorType = at(row, 'competitortype')
    const number = normaliseLicence(at(row, 'licenseno'))
    const holderName = [at(row, 'firstname'), at(row, 'middlename'), at(row, 'lastname')]
      .filter(Boolean)
      .join(' ')

    // Riders and officials hold championship licences too, but they cannot
    // enter a rally; importing them would open the entry gate to the whole
    // motocross grid.
    if (competitorType !== 'Driver' && competitorType !== 'Co-Driver') {
      skippedNonCrew += 1
      continue
    }

    // "In process" and blanks: registered, but with no number yet to check
    // at the gate. A real licence number always carries digits.
    if (!/\d/.test(number)) {
      skipped.push(holderName || '(unnamed row)')
      continue
    }

    if (seen.has(number)) continue
    seen.add(number)

    parsed.push({
      number,
      holderName,
      // The export has no competition-licence expiry column; merge on write
      // keeps any expiry an organiser has already recorded by hand.
      expiresOn: null,
      details: {
        firstName: [at(row, 'firstname'), at(row, 'middlename')].filter(Boolean).join(' '),
        lastName: at(row, 'lastname'),
        email: at(row, 'email'),
        dateOfBirth: parseSheetDate(at(row, 'dateofbirth')),
        phone: normalisePhone(at(row, 'phone1')),
        country: at(row, 'country'),
        club: at(row, 'club'),
        competitorType,
        permitNumber: at(row, 'permitnumber'),
        permitExpiry: parseSheetDate(at(row, 'permitexpiry')),
      },
    })
  }

  return { parsed, skipped, skippedNonCrew }
}

/** One licence per line: number, then optionally name and expiry. */
function parseSimpleList(lines: string[][]): ParseResult {
  const seen = new Set<string>()
  const parsed: ParsedLicence[] = []
  const skipped: string[] = []

  for (const [rawNumber, holderName = '', rawExpiry = ''] of lines) {
    const number = normaliseLicence(rawNumber ?? '')
    if (!number) {
      skipped.push(rawNumber ?? '(blank)')
      continue
    }
    if (seen.has(number)) continue
    seen.add(number)

    const date = rawExpiry ? new Date(rawExpiry) : null
    parsed.push({
      number,
      holderName,
      expiresOn: date && !Number.isNaN(date.getTime()) ? Timestamp.fromDate(date) : null,
      details: null,
    })
  }

  return { parsed, skipped, skippedNonCrew: 0 }
}

function parseImport(paste: string): ParseResult {
  /*
   * Tab wins when a line has one: an Excel paste is tab-separated, and its
   * fields — clubs, countries — may legitimately contain commas.
   */
  const lines = paste
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      (line.includes('\t') ? line.split('\t') : line.split(',')).map((cell) => cell.trim()),
    )

  if (!lines.length) return { parsed: [], skipped: [], skippedNonCrew: 0 }

  const header = lines[0].map(normHeader)
  return header.includes('licenseno')
    ? parseFmuExport(lines, header)
    : parseSimpleList(lines)
}

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

    // Duplicate numbers were already collapsed while parsing: a repeated
    // number in one paste would otherwise produce two batch writes to the
    // same document, which Firestore rejects outright.
    const { parsed, skipped, skippedNonCrew } = parseImport(paste)

    if (!parsed.length) {
      setError(
        skippedNonCrew
          ? 'No drivers or co-drivers with licence numbers found in that paste.'
          : 'No usable licence numbers found.',
      )
      return
    }

    setBusy(true)
    try {
      // Up to two writes per licence, against the 500-write batch ceiling.
      for (let i = 0; i < parsed.length; i += 200) {
        const batch = writeBatch(db)
        for (const licence of parsed.slice(i, i + 200)) {
          batch.set(
            doc(db, eventPath(eventCode, eventCollections.licences), licence.number),
            {
              number: licence.number,
              holderName: licence.holderName,
              expiresOn: licence.expiresOn,
              active: true,
              addedAt: serverTimestamp(),
            },
            // merge, so re-importing a longer list does not wipe a licence an
            // organiser has since deactivated by hand.
            { merge: true },
          )
          if (licence.details) {
            // No merge: the registration list is the source of truth for the
            // holder's details, and a re-import should replace them wholesale.
            batch.set(licenceDetailsRef(eventCode, licence.number), licence.details)
          }
        }
        await batch.commit()
      }

      const withDetails = parsed.filter((licence) => licence.details).length
      setResult(
        `Imported ${parsed.length} licence${parsed.length === 1 ? '' : 's'}` +
          (withDetails ? ` (${withDetails} with holder details)` : '') +
          (skippedNonCrew
            ? `, skipped ${skippedNonCrew} who are not drivers or co-drivers`
            : '') +
          (skipped.length
            ? `, skipped ${skipped.length} without a usable licence number`
            : '') +
          '.',
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
    // The details subdocument goes with it, or the personal data would
    // outlive the licence it belongs to.
    await Promise.all([
      deleteDoc(doc(db, eventPath(eventCode, eventCollections.licences), number)),
      deleteDoc(licenceDetailsRef(eventCode, number)),
    ])
  }

  async function removeAll() {
    if (
      !window.confirm(
        `Remove all ${licences.length} licences? Nobody will be able to start ` +
          'an entry form until a new list is imported.',
      )
    ) {
      return
    }

    setError(null)
    setResult(null)
    setBusy(true)
    try {
      // Two deletes per licence, against the 500-write batch ceiling.
      for (let i = 0; i < licences.length; i += 250) {
        const batch = writeBatch(db)
        for (const licence of licences.slice(i, i + 250)) {
          batch.delete(doc(db, eventPath(eventCode, eventCollections.licences), licence.number))
          batch.delete(licenceDetailsRef(eventCode, licence.number))
        }
        await batch.commit()
      }
      setResult('Removed every licence on the list.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the list')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={importPasted} className="space-y-3 rounded-lg border border-edge bg-surface p-4">
        <div>
          <h2 className="font-semibold text-fg">Competition licences</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Only these numbers can start an entry form. Paste the FMU registration
            sheet straight from Excel (header row included) — holder details then
            prefill the entry form — or one licence per line.
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
          Plain format: number, then optionally name and expiry date, comma or tab
          separated. FMU sheet: riders and rows still “in process” are skipped, and
          slashed dates are read day-first (04/09/2026). Re-importing updates
          existing entries rather than duplicating them.
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
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold text-fg">
            On the list{!loading && ` (${licences.length})`}
          </h2>
          {licences.length > 0 && (
            <button
              type="button"
              onClick={() => void removeAll()}
              disabled={busy}
              className="text-xs font-semibold text-danger-text disabled:opacity-60"
            >
              Remove all
            </button>
          )}
        </div>

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
