import { useMemo } from 'react'
import type { LiveShard, Manifest } from '../../src/domain/matchups'
import type {
  FreeAgent,
  FreeAgentsShard,
  PlayerCard,
  PlayersShard,
  RosterPlayer,
  StatWindow,
} from '../../src/domain/players'
import { scoredCategories, statKey, type LeagueSeasonSettings } from '../../src/domain/stats'
import { useHomeTeam } from '../lib/homeTeam'
import { useJson } from '../lib/useJson'
import { buildBaselines, playerValue, positionsOverlap, type Baselines } from '../lib/valuation'

interface Props {
  league: Manifest['leagues'][number]
}

const WINDOWS: StatWindow[] = ['lastweek', 'lastmonth', 'season']

interface Valued<P extends PlayerCard> {
  player: P
  lastweek: number | null
  lastmonth: number | null
  season: number | null
  /** lastmonth minus season: negative = fading, positive = surging. */
  trend: number | null
}

function value<P extends PlayerCard>(player: P, baselines: Baselines): Valued<P> {
  const lastweek = playerValue(player, 'lastweek', baselines)
  const lastmonth = playerValue(player, 'lastmonth', baselines)
  const season = playerValue(player, 'season', baselines)
  return {
    player,
    lastweek,
    lastmonth,
    season,
    trend: lastmonth !== null && season !== null ? lastmonth - season : null,
  }
}

/** Blend of recent windows used to rank waiver-wire risers. */
function riserScore(v: Valued<PlayerCard>): number {
  return 0.6 * (v.lastweek ?? -3) + 0.4 * (v.lastmonth ?? -3)
}

function fmtValue(v: number | null): string {
  if (v === null) return '–'
  return (v > 0 ? '+' : '') + v.toFixed(1)
}

function fmtDelta(v: number | null): string {
  if (!v) return '–'
  return v > 0 ? `+${v}` : String(v)
}

function ValueCell({ v }: { v: number | null }) {
  const cls = v === null ? '' : v >= 0.25 ? 'win' : v <= -0.25 ? 'loss' : ''
  return <td className={`sg-val ${cls}`}>{fmtValue(v)}</td>
}

/** Compact headline stat line, e.g. "3 HR · 9 RBI · .310 AVG" for the window. */
function statLine(player: PlayerCard, window: StatWindow, settings: LeagueSeasonSettings): string {
  const stats = player.windows[window]
  if (!stats) return ''
  const role = player.positionType === 'P' ? 'pitching' : 'batting'
  return scoredCategories(settings)
    .filter(c => c.role === role)
    .map(c => `${stats[statKey(c.role, c.statId)] ?? '–'} ${c.abbr}`)
    .join(' · ')
}

function PlayerId({ player }: { player: PlayerCard }) {
  return (
    <td className="sg-player">
      <span className="rt-player">{player.name}</span>
      <span className="rt-meta">
        {player.mlbTeam} · {player.displayPosition}
        {player.status && <span className="rt-status"> {player.status}</span>}
      </span>
    </td>
  )
}

export default function Strategy({ league }: Props) {
  const live = useJson<LiveShard>(`data/${league.id}/live.json`)
  const settings = useJson<LeagueSeasonSettings>(`data/${league.id}/settings/${league.season}.json`)
  const players = useJson<PlayersShard>(`data/${league.id}/players/current.json`)
  const freeAgents = useJson<FreeAgentsShard>(`data/${league.id}/players/freeagents.json`)

  const [homeKey] = useHomeTeam(league.id, live.data?.standings)

  const model = useMemo(() => {
    if (!settings.data || !players.data || !freeAgents.data || !homeKey) return null

    const rostered = players.data.rosters.flatMap(r => r.players)
    const baselines = buildBaselines([...rostered, ...freeAgents.data.players], settings.data, WINDOWS)

    const homeRoster = players.data.rosters.find(r => r.teamKey === homeKey)?.players ?? []
    const roster = homeRoster
      .map(p => value<RosterPlayer>(p, baselines))
      .sort((a, b) => (a.trend ?? 99) - (b.trend ?? 99))

    const risers = freeAgents.data.players
      .map(p => value<FreeAgent>(p, baselines))
      .sort((a, b) => riserScore(b) - riserScore(a))

    // A roster spot is "slumping" when the player has been clearly below
    // their season level for a month AND is producing at/below league
    // average — a star merely regressing toward great isn't droppable.
    // Anyone on the IL is always a candidate spot.
    const slumping = roster.filter(v =>
      (v.trend !== null && v.trend <= -0.35 && (v.lastmonth ?? 0) < 0.1) ||
      (v.player.status?.startsWith('IL') ?? false),
    )
    const risingFas = risers.filter(v => riserScore(v) > 0)

    const suggestions = slumping.map(slump => ({
      slump,
      candidates: risingFas
        .filter(fa => positionsOverlap(fa.player, slump.player))
        .slice(0, 3),
    }))

    return { roster, risers, suggestions }
  }, [settings.data, players.data, freeAgents.data, homeKey])

  const error = live.error ?? settings.error ?? players.error ?? freeAgents.error
  if (error) {
    return (
      <div className="empty-state">
        <p className="empty-title">Couldn’t load strategy data</p>
        <p className="empty-desc">{error}</p>
      </div>
    )
  }
  if (!model || !settings.data) {
    return <div className="view"><div className="card skeleton tall" aria-hidden /></div>
  }

  const leagueSettings = settings.data
  const homeManager = live.data?.standings.find(r => r.teamKey === homeKey)?.manager ?? 'home'

  return (
    <div className="view">
      <section>
        <h2 className="section-title">Swap candidates</h2>
        <p className="section-desc">
          Slumping or hurt spots on {homeManager}’s roster with rising free agents at the same position.
        </p>
        {model.suggestions.length === 0 && (
          <div className="card pad">
            <p className="empty-desc">No one on the roster is clearly slumping right now.</p>
          </div>
        )}
        <div className="card-list">
          {model.suggestions.map(({ slump, candidates }) => (
            <div key={slump.player.playerKey} className="card swap-card">
              <div className="swap-slumper">
                <div className="swap-head">
                  <span className="rt-player">{slump.player.name}</span>
                  <span className="rt-meta">
                    {slump.player.mlbTeam} · {slump.player.displayPosition}
                    {slump.player.status && <span className="rt-status"> {slump.player.status}</span>}
                  </span>
                  <span className="spacer" />
                  <span className="trend-badge bad">
                    {slump.trend !== null ? `${fmtValue(slump.trend)} vs season` : 'on IL'}
                  </span>
                </div>
                <div className="swap-line">30d: {statLine(slump.player, 'lastmonth', leagueSettings)}</div>
              </div>
              {candidates.length > 0 ? candidates.map(fa => (
                <div key={fa.player.playerKey} className="swap-candidate">
                  <div className="swap-head">
                    <span className="swap-arrow" aria-hidden>↑</span>
                    <span className="rt-player">{fa.player.name}</span>
                    <span className="rt-meta">{fa.player.mlbTeam} · {fa.player.displayPosition}</span>
                    <span className="spacer" />
                    {fa.player.percentOwned !== null && (
                      <span className="trend-badge good">
                        {fa.player.percentOwned}% owned
                        {fa.player.ownershipDelta ? ` (${fmtDelta(fa.player.ownershipDelta)})` : ''}
                      </span>
                    )}
                  </div>
                  <div className="swap-line">7d: {statLine(fa.player, 'lastweek', leagueSettings)}</div>
                </div>
              )) : (
                <div className="swap-candidate none">No rising free agent shares a position.</div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-title">Waiver wire risers</h2>
        <p className="section-desc">
          Best available players by recent category value (z-score vs everyone rostered or listed; 0 is league average).
        </p>
        <div className="card table-scroll">
          <table className="sg-table">
            <thead>
              <tr>
                <th className="sg-player">Player</th>
                <th>Own%</th>
                <th>Δ</th>
                <th>7d</th>
                <th>30d</th>
                <th>Szn</th>
                <th className="sg-line">Last 7 days</th>
              </tr>
            </thead>
            <tbody>
              {model.risers.slice(0, 30).map(v => (
                <tr key={v.player.playerKey}>
                  <PlayerId player={v.player} />
                  <td className="sg-val">{v.player.percentOwned ?? '–'}</td>
                  <td className={`sg-val ${(v.player.ownershipDelta ?? 0) > 0 ? 'win' : (v.player.ownershipDelta ?? 0) < 0 ? 'loss' : ''}`}>
                    {fmtDelta(v.player.ownershipDelta)}
                  </td>
                  <ValueCell v={v.lastweek} />
                  <ValueCell v={v.lastmonth} />
                  <ValueCell v={v.season} />
                  <td className="sg-line">{statLine(v.player, 'lastweek', leagueSettings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="section-title">{homeManager}’s roster trends</h2>
        <p className="section-desc">Sorted coldest first: 30-day value minus season value.</p>
        <div className="card table-scroll">
          <table className="sg-table">
            <thead>
              <tr>
                <th className="sg-player">Player</th>
                <th>Slot</th>
                <th>7d</th>
                <th>30d</th>
                <th>Szn</th>
                <th>Trend</th>
                <th className="sg-line">Last 30 days</th>
              </tr>
            </thead>
            <tbody>
              {model.roster.map(v => (
                <tr key={v.player.playerKey}>
                  <PlayerId player={v.player} />
                  <td className="sg-val">{v.player.selectedPosition ?? '–'}</td>
                  <ValueCell v={v.lastweek} />
                  <ValueCell v={v.lastmonth} />
                  <ValueCell v={v.season} />
                  <ValueCell v={v.trend} />
                  <td className="sg-line">{statLine(v.player, 'lastmonth', leagueSettings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
