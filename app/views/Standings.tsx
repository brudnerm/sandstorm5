import type { LiveShard, Manifest } from '../../src/domain/matchups'
import { useJson } from '../lib/useJson'

interface Props {
  league: Manifest['leagues'][number]
}

export default function Standings({ league }: Props) {
  const live = useJson<LiveShard>(`data/${league.id}/live.json`)

  if (live.error) {
    return (
      <div className="empty-state">
        <p className="empty-title">Couldn’t load standings</p>
        <p className="empty-desc">{live.error}</p>
      </div>
    )
  }
  if (!live.data) {
    return <div className="view"><div className="card skeleton tall" aria-hidden /></div>
  }

  const rows = live.data.standings
  const hasFaab = rows.some(r => r.faabBalance !== null)

  return (
    <div className="view">
      <div className="card standings-card">
        <div className="standings-row head" role="row">
          <span className="st-rank">#</span>
          <span className="st-team">Team</span>
          <span className="st-record">W–L–T</span>
          <span className="st-num">PCT</span>
          <span className="st-num">GB</span>
          <span className="st-num">{hasFaab ? 'FAAB' : 'Waiver'}</span>
        </div>
        {rows.map(row => (
          <div key={row.teamKey} className="standings-row" role="row">
            <span className="st-rank">{row.rank}</span>
            <span className="st-team">
              {row.logoUrl
                ? <img className="team-logo small" src={row.logoUrl} alt="" loading="lazy" decoding="async" />
                : <span className="team-logo small placeholder" />}
              <span className="team-names">
                <span className="team-name">{row.name}</span>
                <span className="team-manager">{row.manager}</span>
              </span>
            </span>
            <span className="st-record">{row.wins}–{row.losses}–{row.ties}</span>
            <span className="st-num">{row.percentage}</span>
            <span className="st-num">{row.gamesBack}</span>
            <span className="st-num">
              {hasFaab
                ? (row.faabBalance !== null ? `$${row.faabBalance}` : '–')
                : (row.waiverPriority ?? '–')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
