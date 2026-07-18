/**
 * Category form heatmap: teams × scored categories, each cell the team's
 * category win-rate over the recent window, with an arrow whenever recent
 * form has clearly diverged from the season-long rate.
 */
import type { TeamCategoryForm } from '../../lib/leagueTrends'

interface Props {
  form: TeamCategoryForm[]
  /** teamKeys in display order (current standings). */
  order: string[]
  homeKey: string | null
}

function bucket(rate: number | null): string {
  if (rate === null) return 'heat-none'
  if (rate >= 0.75) return 'heat-5'
  if (rate >= 0.6) return 'heat-4'
  if (rate > 0.4) return 'heat-3'
  if (rate > 0.25) return 'heat-2'
  return 'heat-1'
}

export default function CategoryHeatmap({ form, order, homeKey }: Props) {
  if (form.length === 0) return null
  const cats = form[0]!.cells
  const byKey = new Map(form.map(f => [f.team.teamKey, f]))
  const rows = order.map(key => byKey.get(key)).filter((f): f is TeamCategoryForm => !!f)

  return (
    <div className="card table-scroll">
      <table className="mx-table heat-table">
        <thead>
          <tr>
            <th className="mx-owner">Team</th>
            {cats.map(c => <th key={c.key} title={`${c.abbr} win rate, last 4 weeks`}>{c.abbr}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(f => (
            <tr key={f.team.teamKey} className={f.team.teamKey === homeKey ? 'mx-home' : undefined}>
              <td className="mx-owner">{f.team.manager}</td>
              {f.cells.map(cell => (
                <td key={cell.key} className={`heat-cell ${bucket(cell.recentRate)}`}>
                  {cell.recentRate === null ? '–' : `${Math.round(cell.recentRate * 100)}`}
                  {cell.trend !== 'flat' && (
                    <span className={`heat-arrow ${cell.trend}`} title={`vs season: ${cell.seasonRate === null ? '–' : Math.round(cell.seasonRate * 100)}`}>
                      {cell.trend === 'up' ? '↗' : '↘'}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
