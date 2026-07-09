import { useState } from 'react'
import type { Matchup, MatchupTeam } from '../../src/domain/matchups'
import { statKey, type Role, type StatCategory } from '../../src/domain/stats'
import { shortDate } from '../lib/format'

function TeamRow({ team, won }: { team: MatchupTeam; won: boolean }) {
  return (
    <div className="team-row">
      {team.logoUrl
        ? <img className="team-logo" src={team.logoUrl} alt="" loading="lazy" decoding="async" />
        : <span className="team-logo placeholder" />}
      <span className="team-names">
        <span className="team-name">{team.name}</span>
        <span className="team-manager">{team.manager}</span>
      </span>
      <span className={`team-score${won ? ' leading' : ''}`}>{team.score.w}</span>
    </div>
  )
}

function StatusBadge({ matchup }: { matchup: Matchup }) {
  const liveGames = matchup.teams[0].liveGames ?? 0
  if (matchup.status === 'midevent' && liveGames > 0) {
    return <span className="badge live"><span className="live-dot" aria-hidden />LIVE</span>
  }
  if (matchup.status === 'postevent') return <span className="badge final">Final</span>
  if (matchup.status === 'midevent') return <span className="badge">In progress</span>
  if (matchup.weekStart) {
    return <span className="badge">{shortDate(matchup.weekStart)}{matchup.weekEnd ? `–${shortDate(matchup.weekEnd)}` : ''}</span>
  }
  return null
}

function CategorySection({ role, label, categories, matchup }: {
  role: Role
  label: string
  categories: StatCategory[]
  matchup: Matchup
}) {
  const rows = categories.filter(c => c.role === role)
  if (rows.length === 0) return null
  const [a, b] = matchup.teams
  return (
    <>
      <div className="cat-section">{label}</div>
      {rows.map(c => {
        const key = statKey(c.role, c.statId)
        const resultA = a.results[key] ?? 'tie'
        const resultB = b.results[key] ?? 'tie'
        return (
          <div key={key} className={`cat-row${c.isDisplayOnly ? ' display-only' : ''}`}>
            <span className={`cat-val${resultA === 'win' ? ' win' : resultA === 'loss' ? ' loss' : ''}`}>
              {a.stats[key] ?? '–'}
            </span>
            <span className="cat-abbr" title={c.name}>{c.abbr}</span>
            <span className={`cat-val right${resultB === 'win' ? ' win' : resultB === 'loss' ? ' loss' : ''}`}>
              {b.stats[key] ?? '–'}
            </span>
          </div>
        )
      })}
    </>
  )
}

export default function MatchupCard({ matchup, categories }: {
  matchup: Matchup
  categories: StatCategory[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [a, b] = matchup.teams
  const ties = a.score.t

  return (
    <div className="card matchup-card">
      <button
        className="matchup-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded(e => !e)}
      >
        <div className="matchup-teams">
          <TeamRow team={a} won={a.score.w > b.score.w} />
          <TeamRow team={b} won={b.score.w > a.score.w} />
        </div>
        <div className="matchup-meta">
          <StatusBadge matchup={matchup} />
          {ties > 0 && <span className="ties-note">{ties} tied</span>}
          <svg
            className={`chevron${expanded ? ' open' : ''}`}
            width="14" height="14" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="matchup-detail">
          <div className="cat-head">
            <span>{a.manager}</span>
            <span />
            <span className="right">{b.manager}</span>
          </div>
          <CategorySection role="batting" label="Batting" categories={categories} matchup={matchup} />
          <CategorySection role="pitching" label="Pitching" categories={categories} matchup={matchup} />
        </div>
      )}
    </div>
  )
}
