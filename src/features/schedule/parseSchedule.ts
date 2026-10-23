/** One row of the programme, before it has an id or a position. */
export type Draft = { day: string; activity: string; when: string; place: string }

/**
 * Split a pasted programme into items.
 *
 * Tab-separated only, unlike the licence importer which falls back to commas.
 * It cannot here: every date in a rally programme carries a comma -- "Monday
 * 01st October, 2026" -- so a comma fallback would quietly split one date into
 * two columns and shift every field along by one. Wrong data that looks right
 * is worse than a refusal, so a line with no tab keeps its whole text as the
 * activity and `tabless` counts it, for the panel to warn about.
 *
 * Columns are read as Activity, Date, Time, Place -- the shape of the
 * programme table in the Supplementary Regulations. A blank date carries the
 * previous row's down, because a Word table with the date merged across a
 * day's rows pastes those cells empty, and a heading that vanishes halfway
 * down a day is worse than no grouping at all.
 */
/*
 * Words that only ever appear as a column heading in a programme. A cell has
 * to be the whole word -- an activity called "Recce" or a place called
 * "Venue 2" is not a header, and must not be swallowed.
 */
const HEADER_WORDS = new Set([
  'activity', 'activities', 'item', 'event', 'description',
  'date', 'day', 'dates',
  'time', 'times', 'when', 'target time',
  'place', 'venue', 'location', 'where',
])

/**
 * Is this row the table's heading rather than a line of the programme?
 *
 * Two matching cells rather than one, and checked on every row rather than
 * only the first. One cell is too easy to hit by accident; and a long table
 * in Word repeats its header across a page break, so a header can appear
 * halfway down a paste.
 *
 * Matching only the first cell -- as this did -- meant a table whose first
 * column was called anything else slipped through, and it did more than add a
 * junk row: the header set the running day to the literal word "Date", so the
 * first real row, whose date cell is blank because it is merged, inherited
 * "Date" as its heading. A wrong heading at the top of a programme is the
 * kind of thing nobody reads twice.
 */
function looksLikeHeader(cells: string[]): boolean {
  const matches = cells.filter((cell) => HEADER_WORDS.has(cell.toLowerCase())).length
  return matches >= 2
}

export type ParseResult = {
  items: Draft[]
  /** Lines that carried no tab, so could not be split into columns. */
  tabless: number
}

export function parseSchedule(paste: string): ParseResult {
  const lines = paste
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const rows = lines.map((line) => line.split('\t').map((cell) => cell.trim()))

  const items: Draft[] = []
  let tabless = 0
  let day = ''

  for (const cells of rows) {
    const [activity = '', second = '', third = '', fourth = ''] = cells

    if (looksLikeHeader(cells)) continue
    if (!activity) continue
    if (cells.length === 1) tabless++

    if (cells.length >= 4) {
      if (second) day = second
      items.push({ day, activity, when: third, place: fourth })
    } else if (cells.length === 3) {
      if (second) day = second
      items.push({ day, activity, when: second, place: third })
    } else {
      items.push({ day, activity, when: second, place: '' })
    }
  }

  return { items, tabless }
}
