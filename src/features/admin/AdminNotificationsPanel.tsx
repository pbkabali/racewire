import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { db, eventCollections, eventPath } from '../../lib/firebase/db'

type Contact = {
  id: string
  name: string
  role: string
  phone: string
}

type DeliveryRow = {
  id: string
  subjectId: string
  subjectType: 'notice' | 'document'
  title: string
  channel: 'sms' | 'whatsapp' | 'push' | null
  to: string
  label: string
  status: 'sent' | 'delivered' | 'undelivered' | 'failed' | 'skipped'
  error: string | null
  /** Set on an SMS that followed an undelivered WhatsApp. */
  fallbackFor?: 'whatsapp'
  sentAt: { toDate: () => Date } | null
}

/*
 * A deliberately loose check. The server is the authority on what a number
 * normalises to -- it knows the event's country, and duplicating that rule
 * here would give two implementations to keep in step. This only catches the
 * input that is obviously not a phone number at all, so the organiser finds
 * out now rather than from a skipped row after the next notice goes out.
 */
function looksLikeAPhoneNumber(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15 && /^[+0\d]/.test(raw.trim())
}

/**
 * Who gets told, and who got told.
 *
 * Two halves of one job, which is why they share a tab. The contact list is
 * the part an organiser edits; the delivery log is the part they reach for
 * when a competitor says nobody warned them.
 */
export function AdminNotificationsPanel({ eventCode }: { eventCode: string }) {
  return (
    <div className="space-y-6">
      <ContactsSection eventCode={eventCode} />
      <DeliverySection eventCode={eventCode} />
    </div>
  )
}

function ContactsSection({ eventCode }: { eventCode: string }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const path = eventPath(eventCode, eventCollections.contacts)

  useEffect(() => {
    return onSnapshot(query(collection(db, path), orderBy('name', 'asc')), (snap) => {
      setContacts(snap.docs.map((d) => ({ ...(d.data() as Omit<Contact, 'id'>), id: d.id })))
    })
  }, [path])

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !phone.trim()) {
      setError('A name and a phone number are both needed.')
      return
    }
    if (!looksLikeAPhoneNumber(phone)) {
      setError('That does not look like a phone number. Include the country code, or start with 0.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await addDoc(collection(db, path), {
        name: name.trim(),
        role: role.trim(),
        phone: phone.trim(),
        addedAt: serverTimestamp(),
      })
      setName('')
      setRole('')
      setPhone('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add that contact')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <h2 className="mb-1 font-semibold text-fg">Extra contacts</h2>
      <p className="mb-3 text-xs text-fg-subtle">
        Officials, marshals and media who should get notices. Each gets a WhatsApp
        message, and an SMS only if the WhatsApp does not reach them. Everyone named on a
        submitted entry is already included — do not add competitors here.
      </p>

      <form onSubmit={(e) => void add(e)} className="mb-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="min-w-0 flex-1 rounded-md border border-edge bg-surface px-3 py-2 text-sm text-fg"
          />
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Role (optional)"
            className="min-w-0 flex-1 rounded-md border border-edge bg-surface px-3 py-2 text-sm text-fg"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+256772123456"
            inputMode="tel"
            autoComplete="tel"
            className="min-w-0 flex-1 rounded-md border border-edge bg-surface px-3 py-2 text-sm text-fg"
          />
          <button
            type="submit"
            disabled={saving}
            className="flex-none rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-60"
          >
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </form>

      {contacts.length === 0 ? (
        <p className="text-sm text-fg-subtle">No extra contacts yet.</p>
      ) : (
        <ul className="divide-y divide-edge rounded-lg border border-edge">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{contact.name}</p>
                <p className="truncate text-xs text-fg-subtle">
                  {[contact.role, contact.phone].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void deleteDoc(doc(db, path, contact.id))}
                className="flex-none rounded-md border border-edge px-2 py-1 text-xs text-fg"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function DeliverySection({ eventCode }: { eventCode: string }) {
  const [rows, setRows] = useState<DeliveryRow[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const path = eventPath(eventCode, eventCollections.notifications)

  useEffect(() => {
    return onSnapshot(
      query(collection(db, path), orderBy('sentAt', 'desc'), limit(500)),
      (snap) => {
        setRows(snap.docs.map((d) => ({ ...(d.data() as Omit<DeliveryRow, 'id'>), id: d.id })))
      },
    )
  }, [path])

  /*
   * Grouped by what was sent, not by recipient. One notice is one event in an
   * organiser's head, even though it is two hundred rows underneath.
   */
  const groups = useMemo(() => {
    const bySubject = new Map<string, { title: string; at: Date | null; rows: DeliveryRow[] }>()
    for (const row of rows) {
      const existing = bySubject.get(row.subjectId)
      if (existing) existing.rows.push(row)
      else
        bySubject.set(row.subjectId, {
          title: row.title,
          at: row.sentAt?.toDate() ?? null,
          rows: [row],
        })
    }
    return [...bySubject.entries()]
  }, [rows])

  return (
    <section>
      <h2 className="mb-1 font-semibold text-fg">Delivery log</h2>
      <p className="mb-3 text-xs text-fg-subtle">
        Every send, per recipient and per channel. “sent” means the gateway accepted it;
        a WhatsApp message resolves to delivered, or falls back to SMS, within minutes.
      </p>

      {groups.length === 0 ? (
        <p className="text-sm text-fg-subtle">Nothing has been sent yet.</p>
      ) : (
        <ul className="divide-y divide-edge rounded-lg border border-edge">
          {groups.map(([subjectId, group]) => {
            const count = (...statuses: DeliveryRow['status'][]) =>
              group.rows.filter((r) => statuses.includes(r.status)).length
            // 'sent' means accepted by the gateway and not yet confirmed; for
            // WhatsApp it resolves to delivered or undelivered within minutes.
            const reached = count('sent', 'delivered')
            const failed = count('failed')
            const undelivered = count('undelivered')
            const skipped = count('skipped')
            const open = expanded === subjectId

            return (
              <li key={subjectId}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : subjectId)}
                  aria-expanded={open}
                  className="w-full p-3 text-left"
                >
                  <p className="truncate text-sm font-semibold text-fg">{group.title}</p>
                  <p className="text-xs text-fg-subtle">
                    {group.at ? group.at.toLocaleString() : 'sending…'} · {reached} sent
                    {undelivered > 0 && <span> · {undelivered} fell back to SMS</span>}
                    {failed > 0 && <span className="text-danger"> · {failed} failed</span>}
                    {skipped > 0 && <span className="text-danger"> · {skipped} unusable</span>}
                  </p>
                </button>

                {open && (
                  <ul className="divide-y divide-edge border-t border-edge bg-surface-raised">
                    {group.rows.map((row) => (
                      <li key={row.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                        <span className="w-16 flex-none font-mono text-fg-subtle">
                          {row.channel ?? '—'}
                          {row.fallbackFor && <span className="block text-[10px]">fallback</span>}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-fg">{row.label}</span>
                          <span className="block truncate text-fg-subtle">{row.to}</span>
                          {row.error && (
                            <span className="block text-danger">{row.error}</span>
                          )}
                        </span>
                        <span
                          className={`flex-none font-semibold ${
                            row.status === 'failed' || row.status === 'skipped'
                              ? 'text-danger'
                              : row.status === 'delivered'
                                ? 'text-fg'
                                : 'text-fg-subtle'
                          }`}
                        >
                          {row.status === 'undelivered' ? 'no receipt' : row.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
