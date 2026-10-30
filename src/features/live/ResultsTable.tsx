import type { LiveResults } from './useLiveResults'

/**
 * The sheet's own table, rendered as it stands.
 *
 * No column is special-cased. What the organiser put in the sheet, in the
 * order they put it, is what a competitor expects to read -- and a rally
 * recomputes its classification with different columns per leg, so anything
 * clever here would be wrong by Sunday.
 *
 * Horizontal scroll because a results table is wider than a phone and always
 * will be; the first column sticks so a row stays identifiable once the
 * times have been scrolled to.
 */
export function ResultsTable({ results }: { results: LiveResults }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 bg-surface-raised text-[10px] tracking-wide text-fg-subtle uppercase">
          <tr>
            {results.header.map((cell, index) => (
              <th
                key={index}
                scope="col"
                className={`px-2 py-2 font-semibold whitespace-nowrap ${
                  index === 0 ? 'sticky left-0 bg-surface-raised' : ''
                }`}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-edge">
          {results.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="even:bg-surface-raised/40">
              {row.map((cell, index) => (
                <td
                  key={index}
                  className={`px-2 py-1.5 whitespace-nowrap ${
                    index === 0
                      ? 'sticky left-0 bg-surface font-semibold text-fg'
                      : 'text-fg-muted'
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
