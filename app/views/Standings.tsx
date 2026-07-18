/**
 * Standings + league trends: the live standings table (with week-over-week
 * movement), rank trajectories over the season, category form heatmap,
 * all-play luck, and category leaders — all derived client-side from the
 * season matchups shard.
 */
import { useMemo } from 'react'
import type { LiveShard, Manifest, SeasonMatchups } from '../../src/domain/matchups'
import type { LeagueSeasonSettings } from '../../src/domain/stats'
import AllPlayTable from '../components/trends/AllPlayTable'
import BumpChart from '../components/trends/BumpChart'
import CategoryHeatmap from '../components/trends/CategoryHeatmap'
import CategoryLeaders from '../components/trends/CategoryLeaders'
import {
  computeAllPlay,
  computeCategoryForm,
  computeCategoryLeaders,
  computeTrajectories,
} from '../lib/leagueTrends'
import { useHomeTeam } from '../lib/homeTeam'
import { useJson } from '../lib/useJson'

interface Props {
  league: Manifest['leagues'][number]
}

function Movement({ value }: { value: number | null | undefined }) {
  if (!value) return <span className="st-num st-delta">–</span>
  return (
    <span className={`st-num st-delta ${value > 0 ? 'win' : 'loss'}`}>
      {value > 0 ? `▲${value}` : `▼${-value}`}
    </span>
  )
}

export default function Standings({ league }: Props) {
  const live = useJson<LiveShard>(`data/${league.id}/live.json`)
  const season = useJson<SeasonMatchups>(`data/${league.id}/matchups/${league.season}.json`)
  const settings = useJson<LeagueSeasonSettings>(`data/${league.id}/settings/${league.season}.json`)
  const [homeKey] = useHomeTeam(league.id, live.data?.standings)

  const trends = useMemo(() => {
    if (!season.data || !settings.data) return null
    return {
      trajectories: computeTrajectories(season.data, live.data?.scoreboard ?? null),
      form: computeCategoryForm(season.data, settings.data),
      allPlay: computeAllPlay(season.data, settings.data),
      leaders: computeCategoryLeaders(season.data, settings.data),
    }
  }, [season.data, settings.data, live.data])

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
  const movement = new Map(trends?.trajectories.map(t => [t.team.teamKey, t.movement]) ?? [])
  const hasTrends = trends !== null &&
    trends.trajectories.some(t => t.points.some(p => !p.provisional))
  const trendError = season.error ?? settings.error

  return (
    <div className="view">
      <div className="card standings-card">
        <div className="standings-row head" role="row">
          <span className="st-rank">#</span>
          <span className="st-num st-delta" title="Rank change vs last completed week">Δ</span>
          <span className="st-team">Team</span>
          <span className="st-record">W–L–T</span>
          <span className="st-num">PCT</span>
          <span className="st-num">GB</span>
          <span className="st-num">{hasFaab ? 'FAAB' : 'Waiver'}</span>
        </div>
        {rows.map(row => (
          <div key={row.teamKey} className="standings-row" role="row">
            <span className="st-rank">{row.rank}</span>
            <Movement value={movement.get(row.teamKey)} />
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

      {trendError && (
        <p className="empty-desc">League trends unavailable: {trendError}</p>
      )}
      {!trendError && !trends && (
        <div className="card skeleton" aria-hidden />
      )}
      {trends && !hasTrends && (
        <div className="card pad">
          <p className="empty-desc">Trends appear after the first completed week.</p>
        </div>
      )}

      {trends && hasTrends && (
        <>
          <section>
            <h2 className="section-title">Rank by week</h2>
            <p className="section-desc">
              Standings position after each completed week; the dashed segment is this week in progress.
              Tap a line or label to highlight a team.
            </p>
            <div className="card pad bump-card">
              <BumpChart trajectories={trends.trajectories} homeKey={homeKey} />
            </div>
          </section>

          <section>
            <h2 className="section-title">Category form</h2>
            <p className="section-desc">
              Win rate per category over the last 4 completed weeks (100 = swept it).
              Arrows mark form clearly above/below the team’s season rate.
            </p>
            <CategoryHeatmap
              form={trends.form}
              order={rows.map(r => r.teamKey)}
              homeKey={homeKey}
            />
          </section>

          <section>
            <h2 className="section-title">Schedule luck</h2>
            <p className="section-desc">
              All-play = every category scored against every team, every week.
              Teams above their all-play pace have had a friendly schedule.
            </p>
            <AllPlayTable rows={trends.allPlay} homeKey={homeKey} />
          </section>

          <section>
            <h2 className="section-title">Category leaders</h2>
            <p className="section-desc">Best cumulative weekly record in each scored category.</p>
            <CategoryLeaders leaders={trends.leaders} />
          </section>
        </>
      )}
    </div>
  )
}
