import { useCallback, useEffect, useMemo, useState } from 'react'

import { useDocuments } from '../documents/useDocuments'
import type { NoticeSeverity } from '../notices/types'
import { useNotices } from '../notices/useNotices'

export type FeedItem = {
  id: string
  type: 'notice' | 'document'
  title: string
  body: string
  at: Date | null
  /** Route, relative to the event, that this item lives on. */
  to: string
  severity?: NoticeSeverity
}

/**
 * The read watermark: when this device last opened the centre.
 *
 * Per device and per event, in localStorage rather than Firestore, for two
 * reasons. Most people reading a noticeboard are not signed in -- the board is
 * deliberately public -- so there is frequently no user to hang it on. And
 * "unread" is a property of a device's screen, not of a person: marking
 * something read on a phone in service should not clear the badge on the
 * laptop in the control van.
 */
const watermarkKey = (eventCode: string) => `racewire:notifications:lastRead:${eventCode}`

function readWatermark(eventCode: string): number {
  try {
    const raw = window.localStorage.getItem(watermarkKey(eventCode))
    const value = raw ? Number(raw) : 0
    return Number.isFinite(value) ? value : 0
  } catch {
    // Private browsing, or site data blocked. An unavailable watermark means
    // everything reads as unread, which is the safe direction to fail: the
    // badge nags rather than hides a red flag.
    return 0
  }
}

export type NotificationFeed = {
  items: FeedItem[]
  unread: number
  loading: boolean
  markAllRead: () => void
}

/**
 * One merged, time-ordered feed of everything published to an event.
 *
 * Derived from the notices and documents already on screen elsewhere, rather
 * than from a per-user notifications collection written by the server. The
 * board is public and already synced to the device, so a fan-out would mean
 * writing one document per reader per notice to reproduce a list we can
 * compute for free -- and it would not work at all for the signed-out majority.
 * What a server fan-out buys is per-user read state; a watermark buys the same
 * badge for nothing.
 */
export function useNotificationFeed(eventCode: string): NotificationFeed {
  const { notices, loading: noticesLoading } = useNotices(eventCode)
  const { documents, loading: documentsLoading } = useDocuments(eventCode)

  const [lastRead, setLastRead] = useState(() => readWatermark(eventCode))

  useEffect(() => {
    setLastRead(readWatermark(eventCode))
  }, [eventCode])

  const items = useMemo<FeedItem[]>(() => {
    const merged: FeedItem[] = [
      ...notices.map((notice) => ({
        id: `notice:${notice.id}`,
        type: 'notice' as const,
        title: notice.title,
        body: notice.body,
        at: notice.publishedAt?.toDate() ?? null,
        to: 'notices',
        severity: notice.severity,
      })),
      ...documents.map((document) => ({
        id: `document:${document.id}`,
        type: 'document' as const,
        title: [document.documentNumber, document.name].filter(Boolean).join(' · '),
        body: document.notes?.trim() || 'Added to the document library.',
        at: document.uploadedAt?.toDate() ?? null,
        to: 'docs',
      })),
    ]

    /*
     * Newest first, and anything without a timestamp first rather than last:
     * a null date here means a write that has not yet round-tripped to the
     * server, so it is the most recent thing there is, not the oldest.
     */
    return merged.sort((a, b) => (b.at?.getTime() ?? Infinity) - (a.at?.getTime() ?? Infinity))
  }, [notices, documents])

  const unread = useMemo(
    () => items.filter((item) => (item.at?.getTime() ?? Date.now()) > lastRead).length,
    [items, lastRead],
  )

  const markAllRead = useCallback(() => {
    const now = Date.now()
    setLastRead(now)
    try {
      window.localStorage.setItem(watermarkKey(eventCode), String(now))
    } catch {
      // Badge clears for this session; it returns on reload. Acceptable, and
      // better than failing the click.
    }
  }, [eventCode])

  return { items, unread, loading: noticesLoading || documentsLoading, markAllRead }
}
