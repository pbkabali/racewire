import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { collections, db } from '../../lib/firebase/db'
import type { Race } from '../notices/types'

const statusStyles: Record<Race['status'], string> = {
  scheduled: 'text-fg-muted',
  running: 'text-accent-text',
  finished: 'text-fg-subtle',
  cancelled: 'text-danger-text',
}

/**
 * Race schedule. Populated from Google Sheets by the `syncSheet` function,
 * so organisers keep editing the spreadsheet they already use.
 */
export function SchedulePage() {
  const [races, setRaces] = useState<Race[] | null>(null)

  useEffect(() => {
    const q = query(collection(db, collections.races), orderBy('startsAt', 'asc'))
    return onSnapshot(q, (snap) => {
      setRaces(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Race))
    })
  }, [])

  if (races === null) {
    return <div className="h-40 animate-pulse rounded-lg bg-surface" />
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold tracking-tight text-fg">Schedule</h1>

      {races.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
          No races published yet.
        </p>
      ) : (
        <ul className="divide-y divide-edge overflow-hidden rounded-lg border border-edge bg-surface">
          {races.map((race) => (
            <li key={race.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-fg">{race.name}</p>
                <p className="text-xs text-fg-subtle">{race.category}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-fg">
                  {race.startsAt
                    ? race.startsAt.toDate().toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </p>
                <p className={`text-xs font-semibold uppercase ${statusStyles[race.status]}`}>
                  {race.status}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
