import { useMemo, useState } from 'react'
import PlayerDrawer, { type DrawerPlayer } from '../components/PlayerDrawer'
import type { LiveShard, Manifest } from '../../src/domain/matchups'
import type {
  FreeAgent,
  FreeAgentsShard,
  PlayerCard,
  PlayersShard,
  RosterPlayer,
  StatWindow,
} from '../../src/domain/players'
import { scoredCategories, statKey, type LeagueSeasonSettings, type Role, type StatCategory } from '../../src/domain/stats'
import { useHomeTeam } from '../lib/homeTeam'
import { useJson } from '../lib/useJson'
import {
  buildBaselines,
  meaningfulSample,
  playerValue,
  positionsOverlap,
  realPositions,
  volumeLabel,
  type Baselines,
} from '../lib/valuation'

interface Props {
  league: Manifest['leagues'][number]
}

const WINDOWS: StatWindow[] = ['lastweek', 'lastmonth', 'season']

/** Fielding positions offered as riser filters, in scorecard order. */
const POSITION_ORDER = ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP']

type RiserSortKey = 'score' | 'owned' | 'delta' | 'lastweek' | 'lastmonth' | 'season'

interface RiserSort {
  key: RiserSortKey
  dir: 'asc' | 'desc'
}

/** Numeric sort value for a riser column; nulls sink to the bottom. */
function riserSortValue(v: Valued<FreeAgent>, key: RiserSortKey): number {
  switch (key) {
    case 'owned': return v.player.percentOwned ?? -1
    case 'delta': return v.player.ownershipDelta ?? -999
    case 'lastweek': return v.lastweek ?? -99
    case 'lastmonth': return v.lastmonth ?? -99
    case 'season': return v.season ?? -99
    case 'score': return riserScore(v)
  }
}

interface Valued<P extends PlayerCard> {
  player: P
  lastweek: number | null
  lastmonth: number | null
  season: number | null
  /** lastmonth minus season: negative = fading, positive = surging. */
  trend: number | null
}

function value<P extends PlayerCard>(
  player: P,
  baselines: Baselines,
  settings: LeagueSeasonSettings,
): Valued<P> {
  const lastweek = playerValue(player, 'lastweek', baselines, settings)
  const lastmonth = playerValue(player, 'lastmonth', baselines, settings)
  const season = playerValue(player, 'season', baselines, settings)
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

/** Badge text when a drop candidate is suggested because he's hurt. */
function hurtBadge(p: RosterPlayer): string | null {
  return p.status?.startsWith('IL') ? 'on IL' : null
}

function ValueCell({ v, sorted = false }: { v: number | null; sorted?: boolean }) {
  const cls = v === null ? '' : v >= 0.25 ? 'win' : v <= -0.25 ? 'loss' : ''
  return <td className={`sg-val${sorted ? ' sorted' : ''} ${cls}`}>{fmtValue(v)}</td>
}

/** Compact headline stat line, e.g. "26 AB · 3 HR · .310 AVG" for the window. */
function statLine(player: PlayerCard, window: StatWindow, settings: LeagueSeasonSettings): string {
  const stats = player.windows[window]
  if (!stats) return ''
  const role = player.positionType === 'P' ? 'pitching' : 'batting'
  const line = scoredCategories(settings)
    .filter(c => c.role === role)
    .map(c => `${stats[statKey(c.role, c.statId)] ?? '–'} ${c.abbr}`)
    .join(' · ')
  const volume = volumeLabel(player, window, settings)
  return volume ? `${volume} · ${line}` : line
}

/** Window volume (AB/IP) + one cell per scored category. */
function StatCells({ player, cats, window, settings }: {
  player: PlayerCard
  cats: StatCategory[]
  window: StatWindow
  settings: LeagueSeasonSettings
}) {
  const stats = player.windows[window]
  const volume = volumeLabel(player, window, settings)
  return (
    <>
      <td className="sg-stat sg-stats-split">{volume ? volume.split(' ')[0] : '–'}</td>
      {cats.map(c => (
        <td key={c.statId} className="sg-stat">{stats?.[statKey(c.role, c.statId)] ?? '–'}</td>
      ))}
    </>
  )
}

/** Own% and Δ cells shared by the swap and riser tables. */
function OwnershipCells({ player, sortKey }: {
  player: { percentOwned: number | null; ownershipDelta: number | null }
  sortKey?: RiserSortKey
}) {
  const delta = player.ownershipDelta ?? 0
  return (
    <>
      <td className={`sg-val${sortKey === 'owned' ? ' sorted' : ''}`}>{player.percentOwned ?? '–'}</td>
      <td className={`sg-val${sortKey === 'delta' ? ' sorted' : ''} ${delta > 0 ? 'win' : delta < 0 ? 'loss' : ''}`}>
        {fmtDelta(player.ownershipDelta)}
      </td>
    </>
  )
}

function PlayerId({ player, onOpen }: { player: PlayerCard; onOpen: () => void }) {
  return (
    <td className="sg-player">
      <button className="player-link" onClick={onOpen}>
        <span className="rt-player">{player.name}</span>
        <span className="rt-meta">
          {player.mlbTeam} · {player.displayPosition}
          {player.status && <span className="rt-status"> {player.status}</span>}
        </span>
      </button>
    </td>
  )
}

/** A right-aligned, clickable column header that reflects and toggles sort. */
function SortHeader({ label, title, sortKey, sort, onSort }: {
  label: string
  title?: string
  sortKey: RiserSortKey
  sort: RiserSort
  onSort: (key: RiserSortKey) => void
}) {
  const active = sort.key === sortKey
  return (
    <th
      className={`sg-sortable${active ? ' active' : ''}`}
      title={title}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onSort(sortKey)}
    >
      <span className="sg-th-inner">
        {label}
        <span className="sort-caret" aria-hidden>{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
      </span>
    </th>
  )
}

export default function Strategy({ league }: Props) {
  const live = useJson<LiveShard>(`data/${league.id}/live.json`)
  const settings = useJson<LeagueSeasonSettings>(`data/${league.id}/settings/${league.season}.json`)
  const players = useJson<PlayersShard>(`data/${league.id}/players/current.json`)
  const freeAgents = useJson<FreeAgentsShard>(`data/${league.id}/players/freeagents.json`)

  const [homeKey] = useHomeTeam(league.id, live.data?.standings)
  const [drawerPlayer, setDrawerPlayer] = useState<DrawerPlayer | null>(null)
  const [riserPos, setRiserPos] = useState<string>('All')
  const [riserSort, setRiserSort] = useState<RiserSort>({ key: 'score', dir: 'desc' })

  const onRiserSort = (key: RiserSortKey) =>
    setRiserSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: 'desc' })

  const openRoster = (p: RosterPlayer) => setDrawerPlayer({
    card: p,
    percentOwned: p.percentOwned ?? null,
    ownershipDelta: p.ownershipDelta ?? null,
  })
  const openFa = (fa: FreeAgent) => setDrawerPlayer({
    card: fa,
    percentOwned: fa.percentOwned,
    ownershipDelta: fa.ownershipDelta,
  })

  const model = useMemo(() => {
    if (!settings.data || !players.data || !freeAgents.data || !homeKey) return null
    const leagueSettings = settings.data

    const rostered = players.data.rosters.flatMap(r => r.players)
    const baselines = buildBaselines([...rostered, ...freeAgents.data.players], leagueSettings, WINDOWS)

    // Players with no lineup slot today were dropped mid-week — they still
    // carry week stats for the matchup views but aren't roster decisions.
    const homeRoster = (players.data.rosters.find(r => r.teamKey === homeKey)?.players ?? [])
      .filter(p => p.selectedPosition !== null)
    const roster = homeRoster
      .map(p => value<RosterPlayer>(p, baselines, leagueSettings))
      .sort((a, b) => (a.trend ?? 99) - (b.trend ?? 99))

    const risers = freeAgents.data.players
      .map(p => value<FreeAgent>(p, baselines, leagueSettings))
      .sort((a, b) => riserScore(b) - riserScore(a))

    // Drop candidates: the most droppable active spots per role. Players
    // parked in an IL slot don't cost a roster spot; players hurt while
    // occupying an active/bench slot lead the list. Community ownership
    // makes a spot harder to give up — a player most Yahoo leagues still
    // roster is presumed valuable — unless leagues have started cutting
    // him (falling ownership is a drop signal).
    const inIlSlot = (p: RosterPlayer) =>
      p.selectedPosition === 'NA' || (p.selectedPosition?.startsWith('IL') ?? false)
    const hurt = (p: RosterPlayer) => p.status?.startsWith('IL') ?? false
    // Severity blends how bad the month was with how far it fell short of
    // the player's own season level.
    const severity = (v: Valued<RosterPlayer>) => (v.lastmonth ?? 0) + (v.trend ?? 0)
    // Lower = more droppable. Ownership adds up to +2 (99% owned ≈ never
    // suggest), a falling ownership trend claws some of that back.
    const droppability = (v: Valued<RosterPlayer>) => {
      if (hurt(v.player)) return -99
      const ownership = (v.player.percentOwned ?? 0) / 50
      const dropSignal = (v.player.ownershipDelta ?? 0) < 0 ? -0.5 : 0
      return severity(v) + ownership + dropSignal
    }
    const droppable = roster
      .filter(v =>
        !inIlSlot(v.player) &&
        meaningfulSample(v.player, 'season', leagueSettings, 100, 25))
      .sort((a, b) => droppability(a) - droppability(b))

    // A riser must be genuinely playing right now, not a one-game fluke.
    const risingFas = risers.filter(v =>
      riserScore(v) > 0 &&
      meaningfulSample(v.player, 'lastweek', leagueSettings, 8, 3),
    )
    // Rank pickup candidates by recent value plus a small ownership term —
    // an add other leagues are also making is the safer bet.
    const candidateScore = (v: Valued<FreeAgent>) =>
      riserScore(v) + (v.player.percentOwned ?? 0) / 100

    // Always surface the two most droppable spots per role.
    const suggestions = (['batting', 'pitching'] as Role[])
      .flatMap(role => droppable
        .filter(v => (v.player.positionType === 'P') === (role === 'pitching'))
        .slice(0, 2))
      .map(slump => ({
        slump,
        candidates: risingFas
          .filter(fa => positionsOverlap(fa.player, slump.player))
          .sort((a, b) => candidateScore(b) - candidateScore(a))
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

  // Position filters: only offer positions some riser is actually eligible at.
  const riserPositions = POSITION_ORDER.filter(pos =>
    model.risers.some(v => realPositions(v.player).includes(pos)),
  )
  const filteredRisers = [...model.risers]
    .filter(v => riserPos === 'All' || realPositions(v.player).includes(riserPos))
    .sort((a, b) => {
      const diff = riserSortValue(a, riserSort.key) - riserSortValue(b, riserSort.key)
      return riserSort.dir === 'asc' ? diff : -diff
    })
  // Per-category columns only make sense once the filter pins one role;
  // "All" mixes batters and pitchers, whose categories don't line up.
  const riserRole: Role | null =
    riserPos === 'All' ? null : ['SP', 'RP'].includes(riserPos) ? 'pitching' : 'batting'
  const riserCats = riserRole
    ? scoredCategories(leagueSettings).filter(c => c.role === riserRole)
    : []

  return (
    <div className="view">
      <section>
        <h2 className="section-title">Swap candidates</h2>
        <p className="section-desc">
          Slumping or hurt spots on {homeManager}’s roster with rising free agents at the same position.
        </p>
        {model.suggestions.length === 0 && (
          <div className="card pad">
            <p className="empty-desc">No droppable spot on the roster right now.</p>
          </div>
        )}
        <div className="card-list">
          {model.suggestions.map(({ slump, candidates }) => {
            const role: Role = slump.player.positionType === 'P' ? 'pitching' : 'batting'
            const cats = scoredCategories(leagueSettings).filter(c => c.role === role)
            return (
              <div key={slump.player.playerKey} className="card swap-card">
                <div className="swap-head">
                  <button className="player-link" onClick={() => openRoster(slump.player)}>
                    <span className="rt-player">{slump.player.name}</span>
                    <span className="rt-meta">
                      {slump.player.mlbTeam} · {slump.player.displayPosition}
                      {slump.player.status && <span className="rt-status"> {slump.player.status}</span>}
                    </span>
                  </button>
                  <span className="spacer" />
                  <span className="trend-badge bad">
                    {hurtBadge(slump.player) ?? `${fmtValue(slump.trend)} vs season`}
                  </span>
                </div>
                <div className="table-scroll">
                  <table className="sg-table swap-table">
                    <thead>
                      <tr>
                        <th className="sg-player">Player</th>
                        <th>Span</th>
                        <th title="Percent of leagues rostered">Own%</th>
                        <th title="Weekly change in ownership">Δ</th>
                        <th title="Category value over the span">Val</th>
                        <th className="sg-stats-split">{role === 'pitching' ? 'IP' : 'AB'}</th>
                        {cats.map(c => <th key={c.statId} title={c.name}>{c.abbr}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="swap-row-drop">
                        <PlayerId player={slump.player} onOpen={() => openRoster(slump.player)} />
                        <td className="sg-val">30d</td>
                        <OwnershipCells player={slump.player} />
                        <ValueCell v={slump.lastmonth} />
                        <StatCells player={slump.player} cats={cats} window="lastmonth" settings={leagueSettings} />
                      </tr>
                      {candidates.map(fa => (
                        <tr key={fa.player.playerKey} className="swap-row-add">
                          <PlayerId player={fa.player} onOpen={() => openFa(fa.player)} />
                          <td className="sg-val">7d</td>
                          <OwnershipCells player={fa.player} />
                          <ValueCell v={fa.lastweek} />
                          <StatCells player={fa.player} cats={cats} window="lastweek" settings={leagueSettings} />
                        </tr>
                      ))}
                      {candidates.length === 0 && (
                        <tr>
                          <td className="sg-empty" colSpan={6 + cats.length}>
                            No rising free agent shares a position.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="section-title">Waiver wire risers</h2>
        <p className="section-desc">
          Best available players by recent category value (z-score vs everyone rostered or listed; 0 is league average).
        </p>
        <div className="sg-filter" role="group" aria-label="Filter by position">
          {['All', ...riserPositions].map(pos => (
            <button
              key={pos}
              className={`chip small${riserPos === pos ? ' active' : ''}`}
              aria-pressed={riserPos === pos}
              onClick={() => setRiserPos(pos)}
            >
              {pos}
            </button>
          ))}
        </div>
        <div className="card table-scroll">
          <table className="sg-table sortable">
            <thead>
              <tr>
                <th className="sg-player">Player</th>
                <SortHeader label="Own%" title="Percent of leagues rostered" sortKey="owned" sort={riserSort} onSort={onRiserSort} />
                <SortHeader label="Δ" title="Weekly change in ownership" sortKey="delta" sort={riserSort} onSort={onRiserSort} />
                <SortHeader label="7d" title="Last 7 days value" sortKey="lastweek" sort={riserSort} onSort={onRiserSort} />
                <SortHeader label="30d" title="Last 30 days value" sortKey="lastmonth" sort={riserSort} onSort={onRiserSort} />
                <SortHeader label="Szn" title="Season value" sortKey="season" sort={riserSort} onSort={onRiserSort} />
                {riserCats.length > 0 && (
                  <th className="sg-stats-split">{riserRole === 'pitching' ? 'IP' : 'AB'}</th>
                )}
                {riserCats.map(c => <th key={c.statId} title={c.name}>{c.abbr}</th>)}
              </tr>
            </thead>
            <tbody>
              {filteredRisers.slice(0, 30).map(v => (
                <tr key={v.player.playerKey}>
                  <PlayerId player={v.player} onOpen={() => openFa(v.player)} />
                  <OwnershipCells player={v.player} sortKey={riserSort.key} />
                  <ValueCell v={v.lastweek} sorted={riserSort.key === 'lastweek'} />
                  <ValueCell v={v.lastmonth} sorted={riserSort.key === 'lastmonth'} />
                  <ValueCell v={v.season} sorted={riserSort.key === 'season'} />
                  {riserCats.length > 0 && (
                    <StatCells player={v.player} cats={riserCats} window="lastweek" settings={leagueSettings} />
                  )}
                </tr>
              ))}
              {filteredRisers.length === 0 && (
                <tr>
                  <td className="sg-empty" colSpan={6 + (riserCats.length > 0 ? riserCats.length + 1 : 0)}>
                    No available {riserPos} risers right now.
                  </td>
                </tr>
              )}
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
                  <PlayerId player={v.player} onOpen={() => openRoster(v.player)} />
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

      {drawerPlayer && (
        <PlayerDrawer
          player={drawerPlayer}
          settings={leagueSettings}
          onClose={() => setDrawerPlayer(null)}
        />
      )}
    </div>
  )
}
