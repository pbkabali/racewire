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

    // The header row of the pasted table, in whatever case it was written.
    if (/^activity$/i.test(activity)) continue
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
