import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { getBlob, ref } from 'firebase/storage'
import { useEffect, useState } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import { storage } from '../../lib/firebase/storage'
import { getFormDefinition } from './rallyEntry'
import type { FormEntry } from './types'

/** Submitted and in-progress entries, for the organiser. */
export function AdminEntriesPanel({ eventCode }: { eventCode: string }) {
  const [entries, setEntries] = useState<FormEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    const q = query(
      collection(db, eventPath(eventCode, eventCollections.entries)),
      orderBy('updatedAt', 'desc'),
    )
    return onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => ({ ...(d.data() as FormEntry), id: d.id })))
        setLoading(false)
      },
      (cause) => {
        setError(cause.message)
        setLoading(false)
      },
    )
  }, [eventCode])

  /**
   * Fetched through the SDK rather than a download URL: entry PDFs are behind
   * admin-only Storage rules and have no public URL, which is the point.
   */
  async function downloadPdf(entry: FormEntry) {
    if (!entry.pdfPath) return
    setDownloading(entry.id)
    try {
      const blob = await getBlob(ref(storage, entry.pdfPath))
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `entry-${entry.licenceNumber}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not download')
    } finally {
      setDownloading(null)
    }
  }

  const submitted = entries.filter((e) => e.status === 'submitted')
  const drafts = entries.filter((e) => e.status !== 'submitted')

  if (loading) return <div className="h-32 animate-pulse rounded-lg bg-surface" />

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-lg border border-danger bg-surface p-3 text-sm text-danger-text">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 font-semibold text-fg">Submitted ({submitted.length})</h2>
        {submitted.length === 0 ? (
          <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
            No entries submitted yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-edge bg-surface">
            {submitted.map((entry) => (
              <li key={entry.id} className="border-b border-edge last:border-b-0">
                <div className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-none font-mono text-xs text-accent-text">
                    {entry.licenceNumber}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {nameOf(entry) || <span className="text-fg-subtle">no name given</span>}
                    <span className="ml-2 text-xs text-fg-subtle">{entry.phone}</span>
                  </span>
                  <span className="flex-none text-xs text-fg-subtle">
                    {entry.submittedAt?.toDate().toLocaleDateString() ?? ''}
                  </span>

                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                    className="flex-none text-xs font-semibold text-fg-muted hover:text-fg"
                  >
                    {expanded === entry.id ? 'Hide' : 'View'}
                  </button>

                  {entry.pdfPath && (
                    <button
                      type="button"
                      onClick={() => void downloadPdf(entry)}
                      disabled={downloading === entry.id}
                      className="flex-none rounded border border-edge px-2 py-1 text-xs font-semibold text-fg disabled:opacity-60"
                    >
                      {downloading === entry.id ? '…' : 'PDF'}
                    </button>
                  )}
                </div>

                {expanded === entry.id && <EntryDetail entry={entry} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      {drafts.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold text-fg">Started, not submitted ({drafts.length})</h2>
          <p className="mb-2 text-xs text-fg-subtle">
            Someone began an entry and has not finished. They can return and complete it.
          </p>
          <ul className="overflow-hidden rounded-lg border border-edge bg-surface">
            {drafts.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 border-b border-edge px-3 py-2 last:border-b-0"
              >
                <span className="flex-none font-mono text-xs text-fg-subtle">
                  {entry.licenceNumber}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
                  {nameOf(entry) || 'in progress'} · {entry.phone}
                </span>
                <span className="flex-none text-xs text-fg-subtle">
                  {entry.updatedAt?.toDate().toLocaleDateString() ?? ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** Best-effort display name, from whichever crew fields were filled. */
function nameOf(entry: FormEntry): string {
  const first = entry.values?.['identity.firstName.driver'] ?? ''
  const family = entry.values?.['identity.familyName.driver'] ?? ''
  const entrant = entry.values?.['identity.entrantName.entrant'] ?? ''
  return [first, family].filter(Boolean).join(' ') || entrant
}

function EntryDetail({ entry }: { entry: FormEntry }) {
  const definition = getFormDefinition(entry.formType)
  if (!definition) return null

  return (
    <div className="space-y-3 border-t border-edge bg-bg px-3 py-3">
      {definition.sections.map((section) => {
        if (section.kind === 'declaration') return null

        return (
          <div key={section.id}>
            <h3 className="text-[11px] font-bold tracking-wide text-fg-subtle uppercase">
              {section.title}
            </h3>

            <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {section.kind === 'matrix'
                ? section.rows.flatMap((row) =>
                    section.parties
                      .filter((party) => !row.notApplicableTo?.includes(party.key))
                      .map((party) => {
                        const value = entry.values?.[`${section.id}.${row.key}.${party.key}`]
                        if (!value) return null
                        return (
                          <div key={`${row.key}.${party.key}`} className="flex gap-2 text-xs">
                            <dt className="text-fg-subtle">
                              {row.label} ({party.label})
                            </dt>
                            <dd className="min-w-0 flex-1 truncate text-fg">{value}</dd>
                          </div>
                        )
                      }),
                  )
                : section.fields.map((field) => {
                    const value = entry.values?.[`${section.id}.${field.key}`]
                    if (!value) return null
                    return (
                      <div key={field.key} className="flex gap-2 text-xs">
                        <dt className="text-fg-subtle">{field.label}</dt>
                        <dd className="min-w-0 flex-1 truncate text-fg">{value}</dd>
                      </div>
                    )
                  })}
            </dl>
          </div>
        )
      })}
    </div>
  )
}
