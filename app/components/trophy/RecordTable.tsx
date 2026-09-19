/**
 * The Trophy Room's table. Deliberately plainer than the plaques around it:
 * hairlines, tabular numerals, no fill except on the record-holding row.
 * Atmosphere belongs to the frame, not to the numbers.
 *
 * Semantics matter here as much as looks. The caption names the table for a
 * screen reader, the first column of every row is a row header, and numeric
 * columns are marked so they right-align and read in one column on a phone.
 */
import type { ReactNode } from 'react'
import type { Tone } from '../../lib/trophy'

export interface Column {
  key: string
  label: string
  /** Right-aligns and applies tabular numerals. */
  numeric?: boolean
  /** Allow this cell to wrap; everything else stays on one line. */
  wrap?: boolean
  /** Makes the header a sort control. Needs `sort` on the table. */
  sortable?: boolean
  /** Longer name for the header, read by a screen reader. */
  title?: string
}

export interface SortState {
  key: string
  direction: 'asc' | 'desc'
  onSort: (key: string) => void
}

export interface Row {
  key: string
  /** Optional leading rank, rendered in a narrow muted column. */
  rank?: number | string
  cells: ReactNode[]
  /** Marks the record itself, the row the table exists to show. */
  leader?: boolean
}

interface Props {
  caption: string
  columns: Column[]
  rows: Row[]
  tone?: Tone
  /** Shown under the table: qualifiers, spans, anything that bounds it. */
  note?: ReactNode
  /** Rendered in place of the table when there is nothing to show. */
  empty?: string
  /** True when the leading column is a rank rather than a data column. */
  ranked?: boolean
  /** Turns sortable headers into buttons and marks the current sort. */
  sort?: SortState
}

export default function RecordTable({
  caption, columns, rows, tone = 'praise', note, empty = 'Data unavailable', ranked = false, sort,
}: Props) {
  if (rows.length === 0) {
    return (
      <div>
        <p className="trophy-eyebrow">{caption}</p>
        <p className="trophy-pending">{empty}</p>
      </div>
    )
  }
  return (
    <div>
      <div className="trophy-table-wrap">
        <table className={`trophy-table${tone === 'shame' ? ' shame' : ''}`}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              {ranked && <th scope="col" className="rank">#</th>}
              {columns.map(c => {
                const sorted = sort && sort.key === c.key
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={c.numeric ? 'num' : c.wrap ? 'wrap' : undefined}
                    aria-sort={sorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                    title={c.title}
                  >
                    {sort && c.sortable ? (
                      <button
                        className={`trophy-sort${sorted ? ' active' : ''}`}
                        onClick={() => sort.onSort(c.key)}
                      >
                        {c.label}
                        <span aria-hidden="true" className="trophy-sort-mark">
                          {sorted ? (sort.direction === 'asc' ? '\u2191' : '\u2193') : ''}
                        </span>
                      </button>
                    ) : c.label}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} className={row.leader ? 'leader' : undefined}>
                {ranked && <td className="rank">{row.rank}</td>}
                {row.cells.map((cell, i) => {
                  const column = columns[i]
                  const className = column?.numeric ? 'num' : column?.wrap ? 'wrap' : undefined
                  return i === 0 ? (
                    <th key={column?.key ?? i} scope="row" className={className}>{cell}</th>
                  ) : (
                    <td key={column?.key ?? i} className={className}>{cell}</td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="trophy-section-note">{note}</p>}
    </div>
  )
}
