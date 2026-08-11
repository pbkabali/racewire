import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { AppShell } from '../../components/layout/AppShell'
import { collections, db } from '../../lib/firebase/db'
import { EventContext, type EventState } from './eventContext'
import type { Event } from './types'

/**
 * Resolves /e/:code into an event and renders the event chrome around it.
 *
 * Children only mount once the event exists, which is what lets useEvent()
 * return a non-null Event and keeps every screen inside free of null checks.
 */
export function EventLayout() {
  const { code } = useParams<{ code: string }>()
  const [state, setState] = useState<EventState>({ event: null, loading: true, error: null })

  useEffect(() => {
    if (!code) {
      setState({ event: null, loading: false, error: null })
      return
    }

    // Codes are uppercase by convention; accept any casing in the URL so a
    // hand-typed or lowercased link from a chat app still resolves.
    const eventCode = code.toUpperCase()

    return onSnapshot(
      doc(db, collections.events, eventCode),
      (snap) => {
        setState({
          event: snap.exists() ? { ...(snap.data() as Event), code: snap.id } : null,
          loading: false,
          error: null,
        })
      },
      (error) => setState({ event: null, loading: false, error }),
    )
  }, [code])

  if (state.loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <span className="animate-pulse text-sm tracking-widest text-accent-text uppercase">
          Loading event
        </span>
      </div>
    )
  }

  if (state.error) {
    return (
      <EventProblem
        title="Could not load this event"
        detail={state.error.message}
      />
    )
  }

  if (!state.event) {
    return (
      <EventProblem
        title="Event not found"
        detail={`No event with the code “${code?.toUpperCase()}”. It may have been removed, or the link may be mistyped.`}
      />
    )
  }

  return (
    <EventContext.Provider value={state}>
      <AppShell />
    </EventContext.Provider>
  )
}

function EventProblem({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
      <h1 className="text-xl font-bold text-danger-text">{title}</h1>
      <p className="max-w-sm text-sm text-fg-muted">{detail}</p>
      <Link
        to="/"
        className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-fg"
      >
        Choose an event
      </Link>
    </div>
  )
}
