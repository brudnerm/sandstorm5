/**
 * All-play luck table: each team's actual category record vs the record
 * they'd have if every category were scored against every team, every
 * week. Positive luck = the schedule has flattered them.
 */
import type { AllPlayRow } from '../../lib/leagueTrends'

interface Props {
  rows: AllPlayRow[]
  homeKey: string | null
}

function pct(v: number): string {
  return v.toFixed(3).replace(/^0/, '')
}

function luckLabel(v: number): string {
  return `${v >= 0 ? '+' : '−'}${pct(Math.abs(v))}`
}

export default function AllPlayTable({ rows, homeKey }: Props) {
  if (rows.length === 0) return null
  return (
    <div className="card table-scroll">
      <table className="mx-table">
        <thead>
          <tr>
            <th className="mx-owner">Team</th>
            <th>Actual</th>
            <th>Pct</th>
            <th>All-play</th>
            <th>Pct</th>
            <th title="Actual pct minus all-play pct">Luck</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.team.teamKey} className={row.team.teamKey === homeKey ? 'mx-home' : undefined}>
              <td className="mx-owner">{row.team.manager}</td>
              <td className="mx-val">{row.actual.w}–{row.actual.l}–{row.actual.t}</td>
              <td className="mx-val">{pct(row.actualPct)}</td>
              <td className="mx-val">{row.allPlay.w}–{row.allPlay.l}–{row.allPlay.t}</td>
              <td className="mx-val">{pct(row.allPlayPct)}</td>
              <td className={`mx-val luck${row.luck > 0.02 ? ' win' : row.luck < -0.02 ? ' loss' : ''}`}>
                {luckLabel(row.luck)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
