import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'
import type { EventDocument } from '../events/types'
import { useEvent } from '../events/useEvent'
import { getFormDefinition } from './rallyEntry'
import { checkLicence, type LicenceCheck } from './useLicences'

const REFUSALS: Record<Exclude<LicenceCheck, { ok: true }>['reason'], string> = {
  'not-found':
    'That licence number is not on the organiser’s list for this event. Check it, or contact the organiser if you believe it should be.',
  inactive: 'That licence has been deactivated for this event. Contact the organiser.',
  expired: 'That licence has expired. Contact the organiser.',
}

/**
 * Filling a form starts here.
 *
 * The licence gate is the anti-spam measure: entries carry a lot of personal
 * data and generate work for organisers, so a filler must first prove they hold
 * a licence the organiser has already accepted for this event.
 */
export function FillFormPage() {
  const event = useEvent()
  const { documentId } = useParams<{ documentId: string }>()

  const [document, setDocument] = useState<EventDocument | null>(null)
  const [loading, setLoading] = useState(true)

  const [licenceInput, setLicenceInput] = useState('')
  const [checking, setChecking] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [verified, setVerified] = useState<string | null>(null)

  useEffect(() => {
    if (!documentId) return
    return onSnapshot(
      doc(db, eventPath(event.code, eventCollections.documents), documentId),
      (snap) => {
        setDocument(snap.exists() ? { ...(snap.data() as EventDocument), id: snap.id } : null)
        setLoading(false)
      },
    )
  }, [event.code, documentId])

  const form = getFormDefinition(document?.formType)

  async function submitLicence(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    setRefusal(null)
    setChecking(true)
    try {
      const result = await checkLicence(event.code, licenceInput)
      if (result.ok) {
        setVerified(result.licence.number)
      } else {
        setRefusal(REFUSALS[result.reason])
      }
    } catch {
      // A rules denial looks the same as a miss from here, and saying which
      // would confirm whether a given number exists.
      setRefusal(REFUSALS['not-found'])
    } finally {
      setChecking(false)
    }
  }

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-surface" />

  if (!document || !form) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-danger bg-surface p-4 text-sm text-danger-text">
          {document
            ? 'This document is not a fillable form.'
            : 'That document no longer exists.'}
        </p>
        <Link to=".." relative="path" className="text-sm font-semibold text-accent-text underline">
          Back to documents
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to=".." relative="path" className="text-xs text-fg-muted hover:text-fg">
          ← Documents
        </Link>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-fg">{form.label}</h1>
        <p className="mt-1 text-sm text-fg-muted">{form.description}</p>
      </div>

      {verified ? (
        <div className="space-y-3">
          <p className="rounded-lg border border-edge bg-surface p-4 text-sm text-fg">
            Licence <span className="font-mono text-accent-text">{verified}</span> accepted.
          </p>

          <div className="rounded-lg border border-edge bg-surface p-4">
            <h2 className="font-semibold text-fg">Next: verify your phone</h2>
            <p className="mt-1 text-sm text-fg-muted">
              We send a one-time code by SMS so an entry can be tied to a real
              contact, and so you can return to a part-finished form later.
            </p>
            <p className="mt-2 text-xs text-fg-subtle">
              Not built yet — phone verification, the form itself, signatures and
              submission are the next stage.
            </p>
          </div>
        </div>
      ) : (
        <form onSubmit={submitLicence} className="space-y-3 rounded-lg border border-edge bg-surface p-4">
          <div>
            <h2 className="font-semibold text-fg">Competition licence</h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              Enter the number on your competition licence. It must be on the
              organiser’s list for this event.
            </p>
          </div>

          <input
            required
            autoFocus
            value={licenceInput}
            onChange={(e) => setLicenceInput(e.target.value)}
            placeholder="UG1234"
            autoCapitalize="characters"
            className="w-full rounded-md border border-edge bg-bg px-3 py-2 font-mono text-fg placeholder:text-fg-subtle"
          />

          {refusal && (
            <p role="alert" className="text-sm text-danger-text">
              {refusal}
            </p>
          )}

          <button
            type="submit"
            disabled={checking}
            className="w-full rounded-md bg-accent py-2 font-bold text-accent-fg disabled:opacity-60"
          >
            {checking ? 'Checking…' : 'Continue'}
          </button>
        </form>
      )}
    </div>
  )
}
