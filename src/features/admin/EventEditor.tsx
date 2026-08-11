import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { useState, type FormEvent } from 'react'

import { collections, db } from '../../lib/firebase/db'
import { uploadAttachment } from '../../lib/firebase/storage'
import { EVENT_STATUSES, SPORT_TYPES, type EventStatus } from '../events/types'

/** Create a new event. Super-admin only; rendered from AdminEventList. */
export function EventEditor({ existingCodes }: { existingCodes: string[] }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [countryName, setCountryName] = useState('')
  const [sportType, setSportType] = useState<string>(SPORT_TYPES[0])
  const [status, setStatus] = useState<EventStatus>('upcoming')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [logo, setLogo] = useState<File | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // Uppercase, alphanumeric plus dashes: this becomes the document id and a URL
  // segment, so anything else would need escaping somewhere and eventually bite.
  const normalisedCode = code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
  const codeTaken = existingCodes.includes(normalisedCode)

  async function create(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setDone(null)

    if (!normalisedCode) return setError('A short code is required.')
    if (codeTaken) {
      // setDoc would silently overwrite the existing event and everything under
      // it would suddenly belong to a differently-named event.
      return setError(`“${normalisedCode}” already exists. Pick another code.`)
    }
    if (!name.trim()) return setError('A name is required.')

    setBusy(true)
    try {
      let logoUrl = ''
      let logoPath = ''
      if (logo) {
        const uploaded = await uploadAttachment(logo, `events/${normalisedCode}/branding`).done
        logoUrl = uploaded.url
        logoPath = uploaded.path
      }

      await setDoc(doc(db, collections.events, normalisedCode), {
        code: normalisedCode,
        name: name.trim(),
        countryCode: countryCode.trim().toUpperCase(),
        countryName: countryName.trim(),
        sportType,
        status,
        logoUrl,
        logoPath,
        // Local midnight, so the date shown matches the date typed.
        startsOn: startsOn ? Timestamp.fromDate(new Date(`${startsOn}T00:00:00`)) : null,
        endsOn: endsOn ? Timestamp.fromDate(new Date(`${endsOn}T00:00:00`)) : null,
        createdAt: serverTimestamp(),
      })

      setDone(`Created ${normalisedCode}. Grant an organiser access with grant-admin.mjs.`)
      setCode('')
      setName('')
      setCountryCode('')
      setCountryName('')
      setStartsOn('')
      setEndsOn('')
      setLogo(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the event')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={create} className="space-y-3 rounded-lg border border-edge bg-surface p-4">
      <h2 className="font-semibold text-fg">Create an event</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Short code
          </span>
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="KRC26"
            className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 font-mono text-fg placeholder:text-fg-subtle"
          />
          <span className="mt-1 block text-xs text-fg-subtle">
            {normalisedCode ? (
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

      <label className="block">
        <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Logo
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
        disabled={busy || codeTaken}
        className="w-full rounded-md bg-accent py-2 font-bold text-accent-fg disabled:opacity-60"
      >
        {busy ? 'Creating…' : 'Create event'}
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
