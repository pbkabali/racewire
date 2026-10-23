import type { Timestamp } from 'firebase/firestore'

/**
 * One line of the rally programme.
 *
 * Deliberately all free text except the ordering. A programme carries entries
 * a real date cannot hold -- "08:00 - 17:00hrs", "Thursday 29th - Friday 30th
 * October", "As per Road book" -- and forcing them into a Timestamp would mean
 * either losing the range or inventing a precision the organiser never stated.
 * The cost is that the app cannot work out what is happening now; that was a
 * deliberate trade, not an oversight.
 */
export type ScheduleItem = {
  id: string
  /**
   * The heading this item sits under, e.g. "Friday 30 October 2026".
   *
   * Free text rather than a date so it can say "Thu 29 - Fri 30 October" when
   * an activity spans days, which the printed programme does more than once.
   */
  day: string
  /** What happens, e.g. "Scrutineering". */
  activity: string
  /** When, as the organiser writes it: "13:00 - 17:00hrs". */
  when: string
  /** Where. A URL is rendered as a link, since half the programme points at the app. */
  place: string
  /**
   * Manual ordering across the whole schedule.
   *
   * A programme is not alphabetical and cannot be sorted by its own text, so
   * the organiser's order is the only order. Matches how folders are ordered
   * in the document library.
   */
  position: number
  createdAt: Timestamp | null
}

/** True for a place that should render as a tappable link rather than text. */
export function isLink(place: string): boolean {
  return /^https?:\/\//i.test(place.trim())
}

export type ScheduleGroup = { day: string; items: ScheduleItem[] }

/**
 * Group into day headings, by runs rather than by collecting every matching
 * day together.
 *
 * The organiser's `position` is the whole order, so a heading is emitted
 * whenever the day changes from the item before. Collecting instead would let
 * grouping silently reorder the programme, which on a schedule is the one
 * thing it must never do.
 */
export function groupByDay(items: ScheduleItem[]): ScheduleGroup[] {
  const groups: ScheduleGroup[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last.day === item.day) last.items.push(item)
    else groups.push({ day: item.day, items: [item] })
  }
  return groups
}
