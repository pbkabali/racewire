import { doc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore'
import { useState, type FormEvent } from 'react'

import { collections, db } from '../../lib/firebase/db'
import { deleteAttachment, uploadAttachment } from '../../lib/firebase/storage'
import {
  EVENT_STATUSES,
  SPORT_TYPES,
  type Event,
  type EventStatus,
} from '../events/types'

/** Same deliberately-loose check as the entry form; see FormFiller.tsx. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** yyyy-mm-dd from local parts; toISOString() would shift across midnight. */
function toDateInput(stamp: Timestamp | null | undefined): string {
  if (!stamp) return ''
  const d = stamp.toDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Create a new event, or edit an existing one.
 *
 * One component for both: the fields are identical apart from the code, which
 * is permanent once set. A second form would drift out of step with this one.
 *
 * Creating is super-admin only (it provisions a namespace others get access
 * to); editing is open to that event's admins.
 */
export function EventEditor({
  existingCodes = [],
  event,
}: {
  existingCodes?: string[]
  /** Present to edit; absent to create. */
  event?: Event
}) {
  const editing = Boolean(event)

  const [code, setCode] = useState(event?.code ?? '')
  const [name, setName] = useState(event?.name ?? '')
  const [countryCode, setCountryCode] = useState(event?.countryCode ?? '')
  const [countryName, setCountryName] = useState(event?.countryName ?? '')
  const [sportType, setSportType] = useState<string>(event?.sportType ?? SPORT_TYPES[0])
  const [status, setStatus] = useState<EventStatus>(event?.status ?? 'upcoming')
  const [startsOn, setStartsOn] = useState(toDateInput(event?.startsOn))
  const [endsOn, setEndsOn] = useState(toDateInput(event?.endsOn))
  const [contactEmail, setContactEmail] = useState(event?.contactEmail ?? '')
  const [contactPhone, setContactPhone] = useState(event?.contactPhone ?? '')
  const [logo, setLogo] = useState<File | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // Uppercase, alphanumeric plus dashes: this becomes the document id and a URL
  // segment, so anything else would need escaping somewhere and eventually bite.
  const normalisedCode = code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
  const codeTaken = existingCodes.includes(normalisedCode)

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault()
    setError(null)
    setDone(null)

    if (!editing) {
      if (!normalisedCode) return setError('A short code is required.')
      if (codeTaken) {
        // setDoc would silently overwrite the existing event, and everything
        // under it would suddenly belong to a differently-named event.
        return setError(`“${normalisedCode}” already exists. Pick another code.`)
      }
    }
    if (!name.trim()) return setError('A name is required.')
    if (contactEmail.trim() && !EMAIL_PATTERN.test(contactEmail.trim())) {
      // Worth catching here: a typo means every entry confirmation carries a
      // reply-to that bounces, and nobody finds out until a competitor's reply
      // vanishes.
      return setError('That organiser email does not look like an address.')
    }

    const target = editing ? event!.code : normalisedCode
    setBusy(true)
    try {
      let logoUrl = event?.logoUrl ?? ''
      let logoPath = event?.logoPath ?? ''

      if (logo) {
        const uploaded = await uploadAttachment(logo, `events/${target}/branding`).done
        const previousPath = logoPath
        logoUrl = uploaded.url
        logoPath = uploaded.path

        // Remove the old file only once the new one is safely stored, so a
        // failed upload never leaves the event with no logo at all.
        if (previousPath && previousPath !== uploaded.path) {
          try {
            await deleteAttachment(previousPath)
          } catch {
            // An orphaned old logo is untidy, not broken.
          }
        }
      }

      const fields = {
        name: name.trim(),
        countryCode: countryCode.trim().toUpperCase(),
        countryName: countryName.trim(),
        sportType,
        status,
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        logoUrl,
        logoPath,
        // Local midnight, so the date shown matches the date typed.
        startsOn: startsOn ? Timestamp.fromDate(new Date(`${startsOn}T00:00:00`)) : null,
        endsOn: endsOn ? Timestamp.fromDate(new Date(`${endsOn}T00:00:00`)) : null,
      }

      if (editing) {
        // updateDoc, not setDoc: setDoc would drop createdAt and any field a
        // later version of the app adds but this form does not know about.
        await updateDoc(doc(db, collections.events, target), fields)
        setDone('Saved.')
        setLogo(null)
      } else {
        await setDoc(doc(db, collections.events, target), {
          ...fields,
          code: target,
          createdAt: serverTimestamp(),
        })
        setDone(`Created ${target}. Grant an organiser access with grant-admin.mjs.`)
        setCode('')
        setName('')
        setCountryCode('')
        setCountryName('')
        setStartsOn('')
        setEndsOn('')
        setContactEmail('')
        setContactPhone('')
        setLogo(null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the event')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      // When creating, the caller supplies a dashed container that marks this
      // out as a form rather than a record, so no second border here.
      className={
        editing
          ? 'space-y-3 rounded-lg border border-edge bg-surface p-4'
          : 'space-y-3 rounded-md bg-surface p-4'
      }
    >
      {editing && <h2 className="font-semibold text-fg">Event details</h2>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Short code
          </span>
          <input
            required
            readOnly={editing}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="KRC26"
            className={`mt-1 w-full rounded-md border border-edge px-3 py-2 font-mono text-fg placeholder:text-fg-subtle ${
              editing ? 'bg-surface-raised text-fg-muted' : 'bg-bg'
            }`}
          />
          <span className="mt-1 block text-xs text-fg-subtle">
            {editing ? (
              'Permanent — it is the URL and the document id'
            ) : normalisedCode ? (
              codeTaken ? (
                <span className="text-danger-text">“{normalisedCode}” is taken</span>
              ) : (
                <>URL: /e/{normalisedCode} · permanent</>
              )
            ) : (
              'Used in the URL and cannot be changed later'
            )}
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Name
          </span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kenya Rally Championship 2026"
            className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg placeholder:text-fg-subtle"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Country code
          </span>
          <input
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            placeholder="KE"
            maxLength={2}
            className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 font-mono text-fg placeholder:text-fg-subtle"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Country
          </span>
          <input
            value={countryName}
            onChange={(e) => setCountryName(e.target.value)}
            placeholder="Kenya"
            className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg placeholder:text-fg-subtle"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Sport
          </span>
          <select
            value={sportType}
            onChange={(e) => setSportType(e.target.value)}
            className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg"
          >
            {SPORT_TYPES.map((sport) => (
              <option key={sport} value={sport}>
                {sport}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Status
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as EventStatus)}
            className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg capitalize"
          >
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Starts
          </span>
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Ends
          </span>
          <input
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg"
          />
        </label>
      </div>

      <fieldset className="rounded-md border border-edge p-3">
        <legend className="px-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Organiser contact
        </legend>
        <p className="mb-3 text-xs text-fg-subtle">
          Shown to competitors on every page of this event, and used as the reply-to on
          entry confirmation emails — those are sent from a no-reply address, so without
          this a competitor who replies gets silence. Both are public: use an address and
          number the organiser is happy to publish.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              Email
            </span>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="entries@example.org"
              className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg placeholder:text-fg-subtle"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              Phone
            </span>
            <input
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+256 700 000 000"
              className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg placeholder:text-fg-subtle"
            />
          </label>
        </div>
      </fieldset>

      <label className="block">
        <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          {editing ? 'Replace logo' : 'Logo'}
        </span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setLogo(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm text-fg file:mr-3 file:rounded-md file:border file:border-edge file:bg-surface-raised file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-fg"
        />
      </label>

      <button
        type="submit"
        disabled={busy || (!editing && codeTaken)}
        className="w-full rounded-md bg-accent py-2 font-bold text-accent-fg disabled:opacity-60"
      >
        {busy ? 'Saving…' : editing ? 'Save changes' : 'Create event'}
      </button>

      {error && (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}
      {done && <p className="text-sm text-accent-text">{done}</p>}
    </form>
  )
}
