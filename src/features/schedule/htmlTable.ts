/**
 * Turn a table on the clipboard into tab-separated rows.
 *
 * Google Docs, Word and Sheets all put two flavours on the clipboard: rich
 * `text/html` and a plain-text rendering. Sheets and Excel separate plain-text
 * columns with tabs, so a plain paste works. Google Docs does not -- its
 * plain-text flavour drops the column structure altogether, which is why a
 * pasted programme arrived as one undifferentiated block.
 *
 * Reading the HTML instead gets the real table in every case, and gets
 * something the plain text could never carry: merged cells, which a rally
 * programme uses for the date spanning a day's rows.
 *
 * Returns null when the clipboard holds no table, so the caller can fall back
 * to whatever plain text was pasted.
 */
export function htmlTableToTsv(html: string): string | null {
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table')
  if (!table) return null

  /*
   * Column index -> how many more rows a merged cell still occupies.
   *
   * Without this a rowspan silently shifts every later column left: the row
   * under a merged date would put its time where the date belongs, and the
   * place where the time belongs. Emitting an empty cell instead keeps the
   * columns lined up, and the importer's blank-date rule then carries the day
   * heading down, which is exactly what the merge meant.
   */
  const spanning = new Map<number, number>()
  const grid: string[][] = []

  for (const row of table.querySelectorAll('tr')) {
    const cells = [...row.children].filter(
      (child) => child.tagName === 'TD' || child.tagName === 'TH',
    )

    const out: string[] = []
    let column = 0
    let next = 0

    while (next < cells.length || spanning.has(column)) {
      const remaining = spanning.get(column)
      if (remaining !== undefined) {
        out[column] = ''
        if (remaining <= 1) spanning.delete(column)
        else spanning.set(column, remaining - 1)
        column++
        continue
      }

      const cell = cells[next++]
      if (!cell) break

      // Collapse the newlines Docs puts inside a cell: one cell is one field,
      // and a line break inside it would split the row on import.
      out[column] = (cell.textContent ?? '').replace(/\s+/g, ' ').trim()

      const rowspan = Number(cell.getAttribute('rowspan') ?? '1') || 1
      const colspan = Number(cell.getAttribute('colspan') ?? '1') || 1
      if (rowspan > 1) spanning.set(column, rowspan - 1)
      column += colspan
    }

    grid.push(Array.from({ length: column }, (_, index) => out[index] ?? ''))
  }

  const rows = grid.filter((row) => row.some((cell) => cell))
  return rows.length ? rows.map((row) => row.join('\t')).join('\n') : null
}
