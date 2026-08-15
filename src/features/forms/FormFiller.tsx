import { useMemo, useState } from 'react'

import { uploadDataUrl } from '../../lib/firebase/storage'
import { generateEntryPdf } from './generatePdf'
import { SignaturePad } from './SignaturePad'
import type { FormDefinition, FormSection, PartyKey } from './types'
import { useFormEntry } from './useFormEntry'

type Values = Record<string, string>

/*
 * Deliberately loose. The only thing worth rejecting here is an address that
 * cannot possibly deliver -- no @, no domain, a stray space. Tighter patterns
 * reject valid addresses (apostrophes, new TLDs, plus-addressing) and the real
 * proof of an address is whether mail arrives.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** `sectionId.rowKey.party` for matrices, `sectionId.fieldKey` otherwise. */
const matrixKey = (sectionId: string, rowKey: string, party: PartyKey) =>
  `${sectionId}.${rowKey}.${party}`

export function FormFiller({
  definition,
  eventCode,
  eventName,
  documentId,
  uid,
  phone,
  licenceNumber,
  prefill,
  onSubmitted,
}: {
  definition: FormDefinition
  eventCode: string
  eventName: string
  documentId: string
  uid: string
  phone: string
  licenceNumber: string
  /** Seed answers from the licence record, used only when there is no draft. */
  prefill?: Values
  onSubmitted: () => void
}) {
  const { entry, entryId, loading, takenByAnother, saveDraft, markSubmitted } = useFormEntry({
    eventCode,
    documentId,
    formType: definition.id,
    uid,
    phone,
    licenceNumber,
  })

  const [step, setStep] = useState(0)
  const [values, setValues] = useState<Values>({})
  const [signatures, setSignatures] = useState<Partial<Record<PartyKey, string>>>({})
  const [acknowledged, setAcknowledged] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [malformed, setMalformed] = useState<string[]>([])

  // Hydrate once, from the draft — or, on a brand-new entry, from the licence
  // record. A draft beats prefill outright: what the person saved is truer
  // than the registration list, and re-seeding a draft would resurrect fields
  // they deliberately cleared. Doing this in an effect keyed on `entry`
  // would overwrite what the person is typing each time the draft saves.
  if (!loading && !hydrated) {
    if (entry?.values) setValues(entry.values)
    else if (prefill) setValues(prefill)
    setHydrated(true)
  }

  const section = definition.sections[step]
  const isLast = step === definition.sections.length - 1

  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }))

  /** Required answers still blank, as human-readable labels. */
  const missingFor = useMemo(
    () => (target: FormSection): string[] => {
      const gaps: string[] = []

      if (target.kind === 'matrix') {
        for (const row of target.rows) {
          for (const party of target.parties) {
            if (row.notApplicableTo?.includes(party.key)) continue
            if (!row.requiredFor?.includes(party.key)) continue
            if (!values[matrixKey(target.id, row.key, party.key)]?.trim()) {
              gaps.push(`${row.label} — ${party.label}`)
            }
          }
        }
      } else if (target.kind === 'fields') {
        for (const field of target.fields) {
          if (field.required && !values[`${target.id}.${field.key}`]?.trim()) {
            gaps.push(field.label)
          }
        }
      }

      return gaps
    },
    [values],
  )

  /** Filled-in emails that could not deliver, as human-readable labels. */
  const malformedFor = useMemo(
    () =>
      (target: FormSection): string[] => {
        const bad: string[] = []
        const check = (value: string | undefined, label: string) => {
          // Only what was actually typed; blanks are the required check's job.
          if (value?.trim() && !EMAIL_PATTERN.test(value.trim())) bad.push(label)
        }

        if (target.kind === 'matrix') {
          for (const row of target.rows) {
            if (row.kind !== 'email') continue
            for (const party of target.parties) {
              if (row.notApplicableTo?.includes(party.key)) continue
              check(
                values[matrixKey(target.id, row.key, party.key)],
                `${row.label} — ${party.label}`,
              )
            }
          }
        } else if (target.kind === 'fields') {
          for (const field of target.fields) {
            if (field.kind !== 'email') continue
            check(values[`${target.id}.${field.key}`], field.label)
          }
        }

        return bad
      },
    [values],
  )

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await saveDraft(values)
      setSavedAt(new Date())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function next() {
    const gaps = missingFor(section)
    const bad = malformedFor(section)
    if (gaps.length || bad.length) {
      setMissing(gaps)
      setMalformed(bad)
      return
    }
    setMissing([])
    setMalformed([])
    await save()
    setStep((s) => Math.min(s + 1, definition.sections.length - 1))
    window.scrollTo({ top: 0 })
  }

  async function submit() {
    // Re-check every step, not just this one: someone can reach the end with an
    // earlier section left incomplete by using Back.
    const gaps = definition.sections.flatMap(missingFor)
    const bad = definition.sections.flatMap(malformedFor)
    if (gaps.length || bad.length) {
      setMissing(gaps)
      setMalformed(bad)
      setError(
        gaps.length
          ? 'Some required answers are missing. They are listed below.'
          : 'Some email addresses do not look right. They are listed below.',
      )
      return
    }
    if (!acknowledged) {
      setError('Tick the acknowledgement before submitting.')
      return
    }

    const declaration = definition.sections.find((s) => s.kind === 'declaration')
    if (declaration?.kind === 'declaration') {
      const unsigned = declaration.signatures.filter((s) => !signatures[s.key])
      if (unsigned.length) {
        setError(`Still to sign: ${unsigned.map((s) => s.label).join(', ')}.`)
        return
      }
    }

    setSubmitting(true)
    setError(null)
    try {
      await saveDraft(values)

      // Signatures to Storage first: they are the part that can fail on a poor
      // connection, and failing before the entry is marked submitted leaves a
      // resumable draft rather than a submitted entry with missing signatures.
      const stored: Record<string, string> = {}
      for (const [party, dataUrl] of Object.entries(signatures)) {
        if (!dataUrl) continue
        stored[party] = await uploadDataUrl(
          dataUrl,
          // Same key as the entry document. Keyed on uid these would collide
          // for two licences filed from one phone, the second overwriting the
          // first's signatures and PDF.
          `events/${eventCode}/entries/${entryId}/signature-${party}.png`,
          'image/png',
        )
      }

      const pdf = await generateEntryPdf({
        definition,
        values,
        signatures,
        eventName,
        licenceNumber,
        phone,
        submittedAt: new Date(),
      })

      const pdfPath = await uploadDataUrl(
        pdf,
        `events/${eventCode}/entries/${entryId}/entry.pdf`,
        'application/pdf',
      )

      await markSubmitted({ signatures: stored, pdfPath })
      onSubmitted()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-surface" />

  if (takenByAnother) {
    return (
      <div className="rounded-lg border border-danger bg-surface p-6 text-center">
        <p className="font-semibold text-fg">
          An entry for licence {licenceNumber} already exists
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
          It was started from a different phone number, so it cannot be opened
          here. Verify with the number used originally, or ask the organiser to
          remove it so you can start again.
        </p>
      </div>
    )
  }

  if (entry?.status === 'submitted') {
    return (
      <div className="rounded-lg border border-edge bg-surface p-6 text-center">
        <p className="font-semibold text-fg">This entry has been submitted.</p>
        <p className="mt-1 text-sm text-fg-muted">
          Contact the organiser if something needs changing — it can no longer be
          edited here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Progress: a plain count reads better than a bar on a five-step form. */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-fg-muted">
          Step {step + 1} of {definition.sections.length}
        </span>
        <span className="text-fg-subtle">
          {savedAt
            ? `Saved ${savedAt.toLocaleTimeString()}`
            : entry
              ? 'Draft in progress'
              : 'Not saved yet'}
        </span>
      </div>

      <div className="h-1 overflow-hidden rounded bg-surface">
        <div
          className="h-full bg-accent transition-[width]"
          style={{ width: `${((step + 1) / definition.sections.length) * 100}%` }}
        />
      </div>

      <section className="space-y-4 rounded-lg border border-edge bg-surface p-4">
        <div>
          <h2 className="font-semibold text-fg">{section.title}</h2>
          {'description' in section && section.description && (
            <p className="mt-0.5 text-sm text-fg-muted">{section.description}</p>
          )}
        </div>

        {/*
          * Grouped by party, not by row.
          *
          * The paper form is a matrix because paper has no other option, but on
          * screen a row of three inputs labelled Entrant / First driver /
          * Co-driver forces the reader to hold the column meaning in their head
          * for every row. One card per person is how someone actually fills it
          * in: their own details, then their co-driver's.
          *
          * Rows that do not apply to a party are omitted entirely rather than
          * greyed, so a card contains only questions that can be answered.
          */}
        {section.kind === 'matrix' &&
          section.parties.map((party) => {
            const rows = section.rows.filter(
              (row) => !row.notApplicableTo?.includes(party.key),
            )
            if (!rows.length) return null

            return (
              <fieldset
                key={party.key}
                className="rounded-md border border-edge bg-bg p-3"
              >
                <legend className="px-1 text-xs font-bold tracking-wide text-accent-text uppercase">
                  {party.label}
                </legend>

                <div className="grid gap-3 sm:grid-cols-2">
                  {rows.map((row) => {
                    const key = matrixKey(section.id, row.key, party.key)
                    const required = row.requiredFor?.includes(party.key)

                    return (
                      <label key={row.key} className="block">
                        <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
                          {row.label}
                          {required && ' *'}
                        </span>
                        <input
                          type={row.kind === 'date' ? 'date' : row.kind}
                          value={values[key] ?? ''}
                          onChange={(e) => set(key, e.target.value)}
                          autoComplete={row.autoComplete}
                          className="mt-1 w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm text-fg"
                        />
                        {(row.helpFor?.[party.key] ?? row.help) && (
                          <span className="mt-1 block text-xs text-fg-subtle">
                            {row.helpFor?.[party.key] ?? row.help}
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            )
          })}

        {section.kind === 'fields' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {section.fields.map((field) => (
              <label key={field.key} className="block">
                <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
                  {field.label}
                  {field.required && ' *'}
                </span>
                {field.kind === 'select' ? (
                  <select
                    value={values[`${section.id}.${field.key}`] ?? ''}
                    onChange={(e) => set(`${section.id}.${field.key}`, e.target.value)}
                    className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-sm text-fg"
                  >
                    <option value="">Choose…</option>
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.kind === 'date' ? 'date' : field.kind}
                    value={values[`${section.id}.${field.key}`] ?? ''}
                    onChange={(e) => set(`${section.id}.${field.key}`, e.target.value)}
                    autoComplete={field.autoComplete}
                    className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-sm text-fg"
                  />
                )}
                {field.help && (
                  <span className="mt-1 block text-xs text-fg-subtle">{field.help}</span>
                )}
              </label>
            ))}
          </div>
        )}

        {section.kind === 'declaration' && (
          <div className="space-y-4">
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-edge bg-bg p-3">
              {section.body.map((paragraph, index) => (
                <p key={index} className="text-xs leading-relaxed text-fg-muted">
                  {paragraph}
                </p>
              ))}
            </div>

            {/*
              * Deliberately large. This is the tick that makes the indemnity
              * binding, and a browser-default 13px box is both easy to miss and
              * awkward to hit on a phone -- well under the ~44px touch target
              * a control this consequential deserves. The whole card is
              * clickable, not just the box.
              */}
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                acknowledged
                  ? 'border-accent bg-surface-raised'
                  : 'border-edge bg-bg hover:border-accent/60'
              }`}
            >
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 h-6 w-6 flex-none accent-accent"
              />
              <span className="text-sm text-fg">{section.acknowledgement}</span>
            </label>

            <div className="grid gap-4 sm:grid-cols-3">
              {section.signatures.map((signature) => (
                <SignaturePad
                  key={signature.key}
                  label={signature.label}
                  value={signatures[signature.key] ?? ''}
                  onChange={(dataUrl) =>
                    setSignatures((s) => ({ ...s, [signature.key]: dataUrl }))
                  }
                />
              ))}
            </div>
          </div>
        )}

        {(missing.length > 0 || malformed.length > 0) && (
          <div role="alert" className="space-y-2 rounded border border-danger bg-bg p-3">
            {missing.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-danger-text">Still needed:</p>
                <ul className="mt-1 list-inside list-disc text-xs text-danger-text">
                  {missing.slice(0, 8).map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                  {missing.length > 8 && <li>and {missing.length - 8} more</li>}
                </ul>
              </div>
            )}

            {malformed.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-danger-text">
                  Check these email addresses:
                </p>
                <ul className="mt-1 list-inside list-disc text-xs text-danger-text">
                  {malformed.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
          className="rounded-md border border-edge px-4 py-2 text-sm font-semibold text-fg disabled:opacity-40"
        >
          Back
        </button>

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || submitting}
          className="rounded-md border border-edge px-4 py-2 text-sm font-semibold text-fg disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save and finish later'}
        </button>

        <span className="flex-1" />

        {isLast ? (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="rounded-md bg-accent px-5 py-2 text-sm font-bold text-accent-fg disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit entry'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void next()}
            disabled={saving}
            className="rounded-md bg-accent px-5 py-2 text-sm font-bold text-accent-fg disabled:opacity-60"
          >
            Next
          </button>
        )}
      </div>
    </div>
  )
}
