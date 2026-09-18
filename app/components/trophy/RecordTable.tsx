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
}

export default function RecordTable({
  caption, columns, rows, tone = 'praise', note, empty = 'Data unavailable', ranked = false,
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
              {columns.map(c => (
                <th
                  key={c.key}
                  scope="col"
                  className={c.numeric ? 'num' : c.wrap ? 'wrap' : undefined}
                >
                  {c.label}
                </th>
              ))}
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
