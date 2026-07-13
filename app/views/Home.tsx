import { Fragment, useMemo, useState } from 'react'
import type { LiveShard, Manifest, SeasonMatchups } from '../../src/domain/matchups'
import type { PlayersShard, StatWindow, TeamRoster } from '../../src/domain/players'
import {
  scoredCategories,
  statKey,
  type LeagueSeasonSettings,
  type Role,
  type StatCategory,
} from '../../src/domain/stats'
import { useHomeTeam } from '../lib/homeTeam'
import { computeMatrix, type Matrix, type MatrixRow } from '../lib/matrix'
import { useJson } from '../lib/useJson'

interface Props {
  league: Manifest['leagues'][number]
  week: number | null
  onWeekChange: (week: number | null) => void
}

/* ---------- lineup-slot ordering for roster panels ---------- */

const SLOT_ORDER = ['C', '1B', '2B', '3B', 'SS', 'MI', 'CI', 'LF', 'CF', 'RF', 'OF', 'Util', 'DH', 'SP', 'RP', 'P', 'BN', 'IL', 'IL+', 'NA']

function slotRank(slot: string | null): number {
  const i = slot ? SLOT_ORDER.indexOf(slot) : -1
  return i === -1 ? SLOT_ORDER.length : i
}

/* ---------- roster breakdown panel ---------- */

const WINDOW_TABS: Array<{ id: StatWindow; label: (week: number) => string }> = [
  { id: 'week', label: w => `Wk ${w}` },
  { id: 'lastweek', label: () => '7d' },
  { id: 'lastmonth', label: () => '30d' },
  { id: 'season', label: () => 'Season' },
]

function RoleTable({ roster, role, categories, window }: {
  roster: TeamRoster
  role: Role
  categories: StatCategory[]
  window: StatWindow
}) {
  const cats = categories.filter(c => c.role === role)
  const players = roster.players
    .filter(p => (p.positionType === 'P') === (role === 'pitching'))
    .sort((a, b) => slotRank(a.selectedPosition) - slotRank(b.selectedPosition) || a.name.localeCompare(b.name))
  if (players.length === 0) return null

  return (
    <div className="roster-table-wrap">
      <table className="roster-table">
        <thead>
          <tr>
            <th className="rt-name">{role === 'batting' ? 'Batters' : 'Pitchers'}</th>
            <th className="rt-slot">Slot</th>
            {cats.map(c => (
              <th key={c.statId} className={c.isDisplayOnly ? 'display-only' : ''} title={c.name}>{c.abbr}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map(p => (
            <tr key={p.playerKey} className={p.selectedPosition === 'BN' || p.selectedPosition?.startsWith('IL') ? 'benched' : ''}>
              <td className="rt-name">
                <span className="rt-player">{p.name}</span>
                <span className="rt-meta">
                  {p.mlbTeam} · {p.displayPosition}
                  {p.status && <span className="rt-status"> {p.status}</span>}
                </span>
              </td>
              <td className="rt-slot">{p.selectedPosition ?? '–'}</td>
              {cats.map(c => (
                <td key={c.statId} className={c.isDisplayOnly ? 'display-only' : ''}>
                  {p.windows[window]?.[statKey(c.role, c.statId)] ?? '–'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RosterPanel({ roster, categories, shardWeek }: {
  roster: TeamRoster
  categories: StatCategory[]
  shardWeek: number
}) {
  const [window, setWindow] = useState<StatWindow>('week')
  return (
    <div className="roster-panel">
      <div className="roster-tabs" role="group" aria-label="Stat window">
        {WINDOW_TABS.map(tab => (
          <button
            key={tab.id}
            className={`chip small${window === tab.id ? ' active' : ''}`}
            aria-pressed={window === tab.id}
            onClick={() => setWindow(tab.id)}
          >
            {tab.label(shardWeek)}
          </button>
        ))}
      </div>
      <RoleTable roster={roster} role="batting" categories={categories} window={window} />
      <RoleTable roster={roster} role="pitching" categories={categories} window={window} />
    </div>
  )
}

/* ---------- summary tiles ---------- */

function Tiles({ matrix, actual }: { matrix: Matrix; actual: MatrixRow | null }) {
  const record = (r: MatrixRow) => `${r.score.w}-${r.score.l}-${r.score.t}`
  return (
    <div className="tiles">
      {actual && (
        <div className="tile">
          <span className={`tile-big ${actual.score.w > actual.score.l ? 'good' : actual.score.w < actual.score.l ? 'bad' : ''}`}>
            {record(actual)}
          </span>
          <span className="tile-label">This week</span>
          <span className="tile-sub">{actual.team.manager}</span>
        </div>
      )}
      <div className="tile">
        <span className="tile-big good">{matrix.wouldBeat}</span>
        <span className="tile-label">Would beat</span>
        {matrix.wouldTie > 0 && <span className="tile-sub">{matrix.wouldTie} even</span>}
      </div>
      <div className="tile">
        <span className="tile-big bad">{matrix.wouldLoseTo}</span>
        <span className="tile-label">Would lose to</span>
      </div>
      {matrix.best && (
        <div className="tile">
          <span className="tile-big good">{record(matrix.best)}</span>
          <span className="tile-label">Best matchup</span>
          <span className="tile-sub">{matrix.best.team.manager}</span>
        </div>
      )}
      {matrix.worst && (
        <div className="tile">
          <span className="tile-big bad">{record(matrix.worst)}</span>
          <span className="tile-label">Worst matchup</span>
          <span className="tile-sub">{matrix.worst.team.manager}</span>
        </div>
      )}
    </div>
  )
}

/* ---------- the matrix table ---------- */

function CatCells({ row, categories, splitFirst }: {
  row: MatrixRow
  categories: StatCategory[]
  splitFirst?: boolean
}) {
  return (
    <>
      {categories.map((c, i) => {
        const key = statKey(c.role, c.statId)
        const outcome = row.outcomes[key] ?? 'tie'
        const cls = [
          'mx-val',
          outcome === 'win' ? 'win' : outcome === 'loss' ? 'loss' : 'tie',
          splitFirst && i === 0 ? 'role-split' : '',
        ].filter(Boolean).join(' ')
        return <td key={key} className={cls}>{row.team.stats[key] ?? '–'}</td>
      })}
    </>
  )
}

export default function Home({ league, week, onWeekChange }: Props) {
  const live = useJson<LiveShard>(`data/${league.id}/live.json`)
  const settings = useJson<LeagueSeasonSettings>(`data/${league.id}/settings/${league.season}.json`)
  const season = useJson<SeasonMatchups>(`data/${league.id}/matchups/${league.season}.json`)
  const players = useJson<PlayersShard>(`data/${league.id}/players/current.json`)

  const [homeKey, setHomeKey] = useHomeTeam(league.id, live.data?.standings)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const currentWeek = live.data?.currentWeek ?? league.currentWeek
  const selectedWeek = week !== null && week >= 1 && week <= currentWeek ? week : currentWeek
  const isCurrent = selectedWeek === currentWeek

  const weekMatchups = isCurrent
    ? live.data?.scoreboard
    : season.data?.weeks[String(selectedWeek)]

  const matrix = useMemo(() => {
    if (!homeKey || !weekMatchups || !settings.data) return null
    return computeMatrix(homeKey, weekMatchups, season.data?.weeks ?? null, selectedWeek, settings.data)
  }, [homeKey, weekMatchups, season.data, selectedWeek, settings.data])

  const error = live.error ?? settings.error ?? season.error
  if (error) {
    return (
      <div className="empty-state">
        <p className="empty-title">Couldn’t load the matrix</p>
        <p className="empty-desc">{error}</p>
      </div>
    )
  }
  if (!live.data || !settings.data) {
    return <div className="view"><div className="card skeleton tall" aria-hidden /></div>
  }

  const categories = scoredCategories(settings.data)
  const batting = categories.filter(c => c.role === 'batting')
  const pitching = categories.filter(c => c.role === 'pitching')
  const rosterOf = (teamKey: string): TeamRoster | null =>
    players.data?.rosters.find(r => r.teamKey === teamKey) ?? null

  const actualRow = matrix?.rows.find(r => r.isActualOpponent) ?? null

  const expansion = (teamKey: string, colSpan: number) => {
    if (expandedKey !== teamKey) return null
    const roster = rosterOf(teamKey)
    return (
      <tr className="mx-expansion">
        <td colSpan={colSpan}>
          {roster && players.data
            ? <RosterPanel roster={roster} categories={settings.data!.categories} shardWeek={players.data.week} />
            : <div className="empty-desc roster-missing">{players.error ?? 'Loading players…'}</div>}
        </td>
      </tr>
    )
  }
  const colSpan = 3 + categories.length + 1

  return (
    <div className="view">
      <div className="home-bar">
        <label className="home-label" htmlFor="home-team">Home team</label>
        <select
          id="home-team"
          className="league-select"
          value={homeKey ?? ''}
          onChange={e => setHomeKey(e.target.value)}
        >
          {live.data.standings.map(row => (
            <option key={row.teamKey} value={row.teamKey}>{row.manager}</option>
          ))}
        </select>
        <span className="spacer" />
        <div className="week-stepper" role="group" aria-label="Week">
          <button
            className="icon-btn"
            aria-label="Previous week"
            disabled={selectedWeek <= 1}
            onClick={() => onWeekChange(selectedWeek - 1)}
          >
            ‹
          </button>
          <button
            className="week-stepper-label"
            onClick={() => onWeekChange(null)}
            title="Jump to current week"
          >
            Wk {selectedWeek}{isCurrent && <span className="now-tag">Now</span>}
          </button>
          <button
            className="icon-btn"
            aria-label="Next week"
            disabled={isCurrent}
            onClick={() => onWeekChange(selectedWeek + 1 === currentWeek ? null : selectedWeek + 1)}
          >
            ›
          </button>
        </div>
      </div>

      {!matrix && <div className="card skeleton tall" aria-hidden />}

      {matrix && (
        <>
          <Tiles matrix={matrix} actual={actualRow} />

          <div className="card table-scroll">
            <table className="mx-table">
              <thead>
                <tr>
                  <th className="mx-owner">Owner</th>
                  <th className="mx-vs">VS</th>
                  <th className="mx-next">Next</th>
                  {batting.map(c => <th key={c.statId} title={c.name}>{c.abbr}</th>)}
                  {pitching.map(c => (
                    <th key={c.statId} title={c.name} className={c === pitching[0] ? 'role-split' : ''}>{c.abbr}</th>
                  ))}
                  <th className="mx-team">Team</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  className={`mx-home${expandedKey === matrix.home.teamKey ? ' expanded' : ''}`}
                  onClick={() => setExpandedKey(k => k === matrix.home.teamKey ? null : matrix.home.teamKey)}
                >
                  <td className="mx-owner">{matrix.home.manager}</td>
                  <td className="mx-vs">—</td>
                  <td className="mx-next" />
                  {categories.map(c => {
                    const key = statKey(c.role, c.statId)
                    return (
                      <td key={key} className={`mx-val home${c === pitching[0] ? ' role-split' : ''}`}>
                        {matrix.home.stats[key] ?? '–'}
                      </td>
                    )
                  })}
                  <td className="mx-team">{matrix.home.name}</td>
                </tr>
                {expansion(matrix.home.teamKey, colSpan)}
                {matrix.rows.map(row => (
                  <Fragment key={row.team.teamKey}>
                    <tr
                      className={`mx-row${row.isActualOpponent ? ' actual' : ''}${expandedKey === row.team.teamKey ? ' expanded' : ''}`}
                      onClick={() => setExpandedKey(k => k === row.team.teamKey ? null : row.team.teamKey)}
                    >
                      <td className="mx-owner">{row.team.manager}</td>
                      <td className={`mx-vs ${row.score.w > row.score.l ? 'win' : row.score.w < row.score.l ? 'loss' : 'tie'}`}>
                        {row.score.w}-{row.score.l}-{row.score.t}
                      </td>
                      <td className="mx-next">
                        {row.isActualOpponent && isCurrent
                          ? <span className="now-badge">Now</span>
                          : row.nextMeetingWeek
                            ? `Wk ${row.nextMeetingWeek}`
                            : '—'}
                      </td>
                      <CatCells row={row} categories={batting} />
                      <CatCells row={row} categories={pitching} splitFirst />

                      <td className="mx-team">{row.team.name}</td>
                    </tr>
                    {expansion(row.team.teamKey, colSpan)}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mx-hint">
            Everything reads {matrix.home.manager}’s way: green = a category {matrix.home.manager} would win, red = would lose, orange = tied. Tap any row for player stats.
          </p>
        </>
      )}
    </div>
  )
}
