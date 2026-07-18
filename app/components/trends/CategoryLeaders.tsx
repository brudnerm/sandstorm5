/**
 * Category leaders: per scored category, the team with the best cumulative
 * weekly category record.
 */
import type { CategoryLeader } from '../../lib/leagueTrends'

interface Props {
  leaders: CategoryLeader[]
}

export default function CategoryLeaders({ leaders }: Props) {
  if (leaders.length === 0) return null
  return (
    <div className="tiles leader-tiles">
      {leaders.map(l => (
        <div key={l.category.statId + l.category.role} className="tile" title={l.category.name}>
          <span className="tile-label">{l.category.abbr}</span>
          <span className="tile-team">{l.team.manager}</span>
          <span className="tile-sub">
            {l.record.w}–{l.record.l}–{l.record.t} ({l.rate.toFixed(3).replace(/^0/, '')})
          </span>
        </div>
      ))}
    </div>
  )
}
