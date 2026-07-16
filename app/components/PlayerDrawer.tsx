/**
 * Player profile drawer: fantasy production windows, Savant percentile
 * rankings, Statcast quality-of-contact table with year-over-year trend,
 * rolling wOBA/ERA chart, season splits vs L/R, recent game log
 * (10/30/60), and fantasy news + roster moves. Opens over any view;
 * bottom sheet on mobile, side panel on desktop.
 */
import { useEffect, useMemo, useState } from 'react'
import type { MlbPlayer, MlbShard, NewsShard, NewsStory, StatcastBatting, StatcastPitching } from '../../src/domain/mlb'
import { normalizeName } from '../../src/domain/mlb'
import type { PlayerCard, StatWindow } from '../../src/domain/players'
import { scoredCategories, statKey, type LeagueSeasonSettings } from '../../src/domain/stats'
import {
  fetchLivePlayerData,
  matchMlbPlayer,
  rollingEra,
  rollingWoba,
  type GameLine,
  type LivePlayerData,
  type RollingPoint,
} from '../lib/mlb'
import { useJson } from '../lib/useJson'
import { volumeLabel } from '../lib/valuation'

export interface DrawerPlayer {
  card: PlayerCard
  percentOwned?: number | null
  ownershipDelta?: number | null
}

interface Props {
  player: DrawerPlayer
  settings: LeagueSeasonSettings
  onClose: () => void
}

const WINDOW_LABELS: Array<{ id: StatWindow; label: string }> = [
  { id: 'week', label: 'This wk' },
  { id: 'lastweek', label: '7d' },
  { id: 'lastmonth', label: '30d' },
  { id: 'season', label: 'Season' },
]

const GAME_COUNTS = [10, 30, 60]

function fmt3(v: number | null): string {
  if (v === null) return '–'
  return v.toFixed(3).replace(/^0/, '')
}

/* ---------- Savant percentile rankings ---------- */

/** Bucket a 0–100 percentile into one of five color tiers (higher = better). */
function pctTier(value: number): string {
  return value >= 85 ? 'p5' : value >= 65 ? 'p4' : value >= 40 ? 'p3' : value >= 20 ? 'p2' : 'p1'
}

function PctBar({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null
  const tier = pctTier(value)
  return (
    <div className="pct-row">
      <span className="pct-label">{label}</span>
      <div className="pct-track">
        <div className={`pct-fill ${tier}`} style={{ width: `${value}%` }} />
        <span className={`pct-bubble ${tier}`} style={{ left: `${Math.min(94, Math.max(6, value))}%` }}>
          {value}
        </span>
      </div>
    </div>
  )
}

function PercentileSection({ mlb, season }: { mlb: MlbPlayer; season: string }) {
  const bat = mlb.battingPct
  const pit = mlb.pitchingPct
  if (!bat && !pit) return null
  return (
    <section className="drawer-section">
      <h3 className="drawer-h">
        {season} percentile rankings
        <span className="drawer-h-note">vs MLB · 100 = best</span>
      </h3>
      <div className="pct-list">
        {bat && (
          <>
            <PctBar label="xwOBA" value={bat.xwoba} />
            <PctBar label="xBA" value={bat.xba} />
            <PctBar label="xSLG" value={bat.xslg} />
            <PctBar label="Avg exit velo" value={bat.exitVelocity} />
            <PctBar label="Barrel %" value={bat.barrelPct} />
            <PctBar label="Hard-hit %" value={bat.hardHitPct} />
            <PctBar label="Bat speed" value={bat.batSpeed} />
            <PctBar label="Squared-up %" value={bat.squaredUp} />
            <PctBar label="Chase %" value={bat.chasePct} />
            <PctBar label="Whiff %" value={bat.whiffPct} />
            <PctBar label="K %" value={bat.kPct} />
            <PctBar label="BB %" value={bat.bbPct} />
            <PctBar label="Sprint speed" value={bat.sprintSpeed} />
            <PctBar label="Range (OAA)" value={bat.oaa} />
          </>
        )}
        {pit && (
          <>
            <PctBar label="xERA" value={pit.xera} />
            <PctBar label="xBA" value={pit.xba} />
            <PctBar label="xwOBA" value={pit.xwoba} />
            <PctBar label="Fastball velo" value={pit.fbVelocity} />
            <PctBar label="K %" value={pit.kPct} />
            <PctBar label="BB %" value={pit.bbPct} />
            <PctBar label="Whiff %" value={pit.whiffPct} />
            <PctBar label="Chase %" value={pit.chasePct} />
            <PctBar label="Barrel %" value={pit.barrelPct} />
            <PctBar label="Hard-hit %" value={pit.hardHitPct} />
          </>
        )}
      </div>
    </section>
  )
}

/* ---------- Statcast quality-of-contact table ---------- */

interface StatcastRow {
  label: string
  cur: number | null
  x: number | null
  prev: number | null
  /** 'rate' = .xxx, 'era' = x.xx, 'num1' = one decimal (mph / %). */
  fmt: 'rate' | 'era' | 'num1'
  betterWhenLower?: boolean
  /** Gap treated as signal rather than noise, in the stat's own units. */
  threshold: number
}

function fmtStat(v: number | null, fmt: StatcastRow['fmt']): string {
  if (v === null) return '–'
  if (fmt === 'rate') return fmt3(v)
  if (fmt === 'era') return v.toFixed(2)
  return v.toFixed(1)
}

function fmtDiff(v: number, fmt: StatcastRow['fmt']): string {
  const sign = v > 0 ? '+' : ''
  if (fmt === 'rate') return sign + v.toFixed(3).replace(/(^|-)0\./, '$1.')
  if (fmt === 'era') return sign + v.toFixed(2)
  return sign + v.toFixed(1)
}

function StatcastTableRow({ row }: { row: StatcastRow }) {
  if (row.cur === null && row.prev === null) return null
  // Expected vs actual: green = due for better results, red = overperforming.
  let xCls = ''
  if (row.cur !== null && row.x !== null) {
    const gap = row.x - row.cur
    const due = row.betterWhenLower ? gap < -row.threshold : gap > row.threshold
    const over = row.betterWhenLower ? gap > row.threshold : gap < -row.threshold
    xCls = due ? ' win' : over ? ' loss' : ''
  }
  // Year-over-year: green = improved on last season, red = declined.
  let trend: { text: string; cls: string } | null = null
  if (row.cur !== null && row.prev !== null) {
    const diff = row.cur - row.prev
    const better = row.betterWhenLower ? diff < -row.threshold : diff > row.threshold
    const worse = row.betterWhenLower ? diff > row.threshold : diff < -row.threshold
    trend = { text: fmtDiff(diff, row.fmt), cls: better ? ' win' : worse ? ' loss' : '' }
  }
  return (
    <tr>
      <td className="rt-name">{row.label}</td>
      <td className="sc-prev">{fmtStat(row.prev, row.fmt)}</td>
      <td className="sc-cur">{fmtStat(row.cur, row.fmt)}</td>
      <td className={`sc-x${xCls}`}>{row.x === null ? '–' : `x${fmtStat(row.x, row.fmt)}`}</td>
      <td className={`sc-trend${trend?.cls ?? ''}`}>{trend?.text ?? '–'}</td>
    </tr>
  )
}

function battingRows(cur: StatcastBatting | null, prev: StatcastBatting | null): StatcastRow[] {
  return [
    { label: 'BA', cur: cur?.ba ?? null, x: cur?.xba ?? null, prev: prev?.ba ?? null, fmt: 'rate', threshold: 0.015 },
    { label: 'SLG', cur: cur?.slg ?? null, x: cur?.xslg ?? null, prev: prev?.slg ?? null, fmt: 'rate', threshold: 0.025 },
    { label: 'wOBA', cur: cur?.woba ?? null, x: cur?.xwoba ?? null, prev: prev?.woba ?? null, fmt: 'rate', threshold: 0.015 },
    { label: 'Exit velo', cur: cur?.ev ?? null, x: null, prev: prev?.ev ?? null, fmt: 'num1', threshold: 0.7 },
    { label: 'Max EV', cur: cur?.maxEv ?? null, x: null, prev: prev?.maxEv ?? null, fmt: 'num1', threshold: 1 },
    { label: 'Hard-hit %', cur: cur?.hardHitPct ?? null, x: null, prev: prev?.hardHitPct ?? null, fmt: 'num1', threshold: 2 },
    { label: 'Barrel %', cur: cur?.barrelPct ?? null, x: null, prev: prev?.barrelPct ?? null, fmt: 'num1', threshold: 1.5 },
    { label: 'Sweet spot %', cur: cur?.sweetSpotPct ?? null, x: null, prev: prev?.sweetSpotPct ?? null, fmt: 'num1', threshold: 2 },
  ]
}

function pitchingRows(cur: StatcastPitching | null, prev: StatcastPitching | null): StatcastRow[] {
  const lower = { betterWhenLower: true }
  return [
    { label: 'ERA', cur: cur?.era ?? null, x: cur?.xera ?? null, prev: prev?.era ?? null, fmt: 'era', threshold: 0.2, ...lower },
    { label: 'BA against', cur: cur?.ba ?? null, x: cur?.xba ?? null, prev: prev?.ba ?? null, fmt: 'rate', threshold: 0.015, ...lower },
    { label: 'wOBA against', cur: cur?.woba ?? null, x: cur?.xwoba ?? null, prev: prev?.woba ?? null, fmt: 'rate', threshold: 0.015, ...lower },
    { label: 'Exit velo', cur: cur?.ev ?? null, x: null, prev: prev?.ev ?? null, fmt: 'num1', threshold: 0.7, ...lower },
    { label: 'Hard-hit %', cur: cur?.hardHitPct ?? null, x: null, prev: prev?.hardHitPct ?? null, fmt: 'num1', threshold: 2, ...lower },
    { label: 'Barrel %', cur: cur?.barrelPct ?? null, x: null, prev: prev?.barrelPct ?? null, fmt: 'num1', threshold: 1.5, ...lower },
  ]
}

function StatcastSection({ mlb, isPitcher, season, prevSeason }: {
  mlb: MlbPlayer
  isPitcher: boolean
  season: string
  prevSeason: string
}) {
  const rows = isPitcher
    ? pitchingRows(mlb.pitching, mlb.prevPitching)
    : battingRows(mlb.batting, mlb.prevBatting)
  if (rows.every(r => r.cur === null && r.prev === null)) return null
  const pa = isPitcher ? mlb.pitching?.pa : mlb.batting?.pa
  return (
    <section className="drawer-section">
      <h3 className="drawer-h">
        Statcast
        <span className="drawer-h-note">
          {pa ? `${pa} ${isPitcher ? 'BF' : 'PA'} · ` : ''}green x-stat = due for better
        </span>
      </h3>
      <div className="roster-table-wrap">
        <table className="roster-table sc-table">
          <thead>
            <tr>
              <th className="rt-name" />
              <th>’{prevSeason.slice(2)}</th>
              <th>’{season.slice(2)}</th>
              <th>Expected</th>
              <th title={`Change vs ${prevSeason}`}>Δ yr</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => <StatcastTableRow key={row.label} row={row} />)}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ---------- Rolling wOBA / ERA chart ---------- */

function RollingChart({ points, title, note, lgAvg, fmt }: {
  points: RollingPoint[]
  title: string
  note: string
  lgAvg: number | null
  fmt: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (points.length < 2) return null

  const W = 320
  const H = 120
  const PAD = { top: 8, right: 8, bottom: 16, left: 34 }
  const values = points.map(p => p.value)
  if (lgAvg !== null) values.push(lgAvg)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pad = Math.max((rawMax - rawMin) * 0.15, rawMax === rawMin ? 0.05 : 0)
  const yMin = rawMin - pad
  const yMax = rawMax + pad
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom)

  // 3 gridlines at simple fractions of the domain — labeled, recessive.
  const ticks = [0.15, 0.5, 0.85].map(f => yMin + f * (yMax - yMin))
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('')

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1))
    setHover(Math.max(0, Math.min(points.length - 1, i)))
  }

  const hovered = hover !== null ? points[hover] : null
  return (
    <section className="drawer-section">
      <h3 className="drawer-h">
        {title}
        <span className="drawer-h-note">{note}</span>
      </h3>
      <svg
        className="roll-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={title}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="roll-grid" />
            <text x={PAD.left - 4} y={y(t) + 3} className="roll-tick" textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        {lgAvg !== null && (
          <g>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(lgAvg)} y2={y(lgAvg)} className="roll-avg" />
            <text x={W - PAD.right} y={y(lgAvg) - 3} className="roll-tick" textAnchor="end">LG AVG</text>
          </g>
        )}
        <path d={path} className="roll-line" />
        {hovered && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="roll-cross" />
            <circle cx={x(hover)} cy={y(hovered.value)} r={3.5} className="roll-dot" />
            <text
              x={x(hover) > W / 2 ? x(hover) - 7 : x(hover) + 7}
              y={PAD.top + 9}
              className="roll-hover"
              textAnchor={x(hover) > W / 2 ? 'end' : 'start'}
            >
              {hovered.date.slice(5)} · {fmt(hovered.value)}
            </text>
          </g>
        )}
      </svg>
    </section>
  )
}

/* ---------- Game log ---------- */

function GamesSection({ games, isPitcher }: { games: GameLine[]; isPitcher: boolean }) {
  const [count, setCount] = useState(10)
  if (games.length === 0) return null
  const shown = games.slice(0, count)
  return (
    <section className="drawer-section">
      <h3 className="drawer-h">
        Game log
        <span className="spacer" />
        <span className="games-toggle" role="group" aria-label="Number of games">
          {GAME_COUNTS.map(n => (
            <button
              key={n}
              className={`chip small${count === n ? ' active' : ''}`}
              aria-pressed={count === n}
              disabled={n > 10 && games.length <= GAME_COUNTS[GAME_COUNTS.indexOf(n) - 1]!}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </span>
      </h3>
      <div className="roster-table-wrap">
        <table className="roster-table">
          <thead>
            <tr>
              <th className="rt-name">Date</th>
              <th className="rt-name">Opp</th>
              {isPitcher
                ? <><th>IP</th><th>H</th><th>ER</th><th>BB</th><th>K</th><th>Dec</th></>
                : <><th>AB</th><th>R</th><th>H</th><th>HR</th><th>RBI</th><th>SB</th><th>BB</th><th>K</th></>}
            </tr>
          </thead>
          <tbody>
            {shown.map((g, i) => (
              <tr key={`${g.date}-${i}`}>
                <td className="rt-name game-date">{g.date.slice(5)}</td>
                <td className="rt-name game-opp">{g.home ? 'vs' : '@'} {g.opponent}</td>
                {isPitcher
                  ? <>
                      <td>{g.pit?.ipDisplay ?? '–'}</td>
                      <td>{g.pit?.h ?? '–'}</td>
                      <td>{g.pit?.er ?? '–'}</td>
                      <td>{g.pit?.bb ?? '–'}</td>
                      <td>{g.pit?.so ?? '–'}</td>
                      <td>{g.pit?.dec ?? ''}</td>
                    </>
                  : <>
                      <td>{g.bat?.ab ?? '–'}</td>
                      <td>{g.bat?.r ?? '–'}</td>
                      <td>{g.bat?.h ?? '–'}</td>
                      <td>{g.bat?.hr ?? '–'}</td>
                      <td>{g.bat?.rbi ?? '–'}</td>
                      <td>{g.bat?.sb ?? '–'}</td>
                      <td>{g.bat?.bb ?? '–'}</td>
                      <td>{g.bat?.so ?? '–'}</td>
                    </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ---------- News ---------- */

function NewsSection({ stories, transactions }: {
  stories: NewsStory[]
  transactions: LivePlayerData['news']
}) {
  if (stories.length === 0 && (!transactions || transactions.length === 0)) return null
  return (
    <section className="drawer-section">
      <h3 className="drawer-h">News & roster moves</h3>
      {stories.length > 0 && (
        <ul className="drawer-stories">
          {stories.slice(0, 6).map((s, i) => (
            <li key={i}>
              <div className="story-head">
                <span className="story-source">{s.source}</span>
                <span className="drawer-game-date">{s.time}</span>
              </div>
              <span className="story-headline">
                {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.headline}</a> : s.headline}
              </span>
              {s.detail && <span className="story-detail">{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {transactions && transactions.length > 0 && (
        <ul className="drawer-news">
          {transactions.map((n, i) => (
            <li key={i}>
              <span className="drawer-game-date">{n.date}</span>
              <span>{n.description}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ---------- Drawer ---------- */

/** Savant player-page slug: "Bobby Witt Jr." → "bobby-witt-jr". */
function savantSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export default function PlayerDrawer({ player, settings, onClose }: Props) {
  const { card } = player
  const isPitcher = card.positionType === 'P'
  const mlbShard = useJson<MlbShard>('data/mlb/players.json')
  const newsShard = useJson<NewsShard>('data/mlb/news.json')
  const [live, setLive] = useState<LivePlayerData | 'loading' | null>(null)

  const mlb = mlbShard.data ? matchMlbPlayer(card, mlbShard.data) : null

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useEffect(() => {
    if (!mlb || !mlbShard.data) return
    let cancelled = false
    setLive('loading')
    fetchLivePlayerData(mlb.mlbamId, isPitcher ? 'pitching' : 'hitting', mlbShard.data.season)
      .then(data => { if (!cancelled) setLive(data) })
      .catch(() => { if (!cancelled) setLive(null) })
    return () => { cancelled = true }
  }, [mlb?.mlbamId, isPitcher, mlbShard.data])

  const cats = scoredCategories(settings).filter(
    c => c.role === (isPitcher ? 'pitching' : 'batting'),
  )
  const splitLabel = (code: string) =>
    code === 'vl' ? (isPitcher ? 'vs LHB' : 'vs LHP') : (isPitcher ? 'vs RHB' : 'vs RHP')

  const liveData = live !== 'loading' ? live : null

  // PA/IP-weighted league averages anchor the rolling chart's reference line.
  const lgAvg = useMemo(() => {
    const shard = mlbShard.data
    if (!shard) return null
    let sum = 0
    let weight = 0
    for (const p of shard.players) {
      const v = isPitcher ? p.pitching?.era : p.batting?.woba
      const pa = isPitcher ? p.pitching?.pa : p.batting?.pa
      if (pa && v != null) {
        sum += v * pa
        weight += pa
      }
    }
    return weight > 0 ? sum / weight : null
  }, [mlbShard.data, isPitcher])

  const rolling = useMemo(() => {
    if (!liveData?.games) return []
    return isPitcher ? rollingEra(liveData.games) : rollingWoba(liveData.games)
  }, [liveData?.games, isPitcher])

  const stories = useMemo(() => {
    if (!newsShard.data) return []
    const wanted = normalizeName(card.name)
    return newsShard.data.stories.filter(s => normalizeName(s.playerName) === wanted)
  }, [newsShard.data, card.name])

  // Yahoo's fantasy player search is league-scoped: b1/{league number}.
  const leagueNum = settings.leagueKey.split('.').at(-1)
  const yahooUrl = `https://baseball.fantasysports.yahoo.com/b1/${leagueNum}/playersearch?search=${encodeURIComponent(card.name)}`
  const savantUrl = mlb
    ? `https://baseballsavant.mlb.com/savant-player/${savantSlug(mlb.name)}-${mlb.mlbamId}?stats=statcast-r-${isPitcher ? 'pitching' : 'hitting'}-mlb`
    : null

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-label={`${card.name} profile`}
        onClick={e => e.stopPropagation()}
      >
        <header className="drawer-head">
          {card.headshotUrl
            ? <img className="drawer-face" src={card.headshotUrl} alt="" />
            : <span className="drawer-face placeholder" />}
          <div className="drawer-id">
            <span className="drawer-name">{card.name}</span>
            <span className="drawer-sub">
              {card.mlbTeam} · {card.displayPosition}
              {mlb?.bats && !isPitcher && ` · bats ${mlb.bats}`}
              {mlb?.throws && isPitcher && ` · throws ${mlb.throws}`}
              {card.status && <span className="rt-status"> {card.status}</span>}
            </span>
            <span className="drawer-sub">
              {player.percentOwned != null && (
                <>{player.percentOwned}% owned{player.ownershipDelta ? ` (${player.ownershipDelta > 0 ? '+' : ''}${player.ownershipDelta} this week)` : ''} · </>
              )}
              <a href={yahooUrl} target="_blank" rel="noreferrer">Yahoo ↗</a>
              {savantUrl && <> · <a href={savantUrl} target="_blank" rel="noreferrer">Savant ↗</a></>}
            </span>
          </div>
          <button className="icon-btn drawer-close" aria-label="Close" onClick={onClose}>✕</button>
        </header>

        <section className="drawer-section">
          <h3 className="drawer-h">Fantasy production</h3>
          <div className="roster-table-wrap">
            <table className="roster-table">
              <thead>
                <tr>
                  <th className="rt-name">Window</th>
                  <th>{isPitcher ? 'IP' : 'AB'}</th>
                  {cats.map(c => <th key={c.statId} title={c.name}>{c.abbr}</th>)}
                </tr>
              </thead>
              <tbody>
                {WINDOW_LABELS.map(w => {
                  const stats = card.windows[w.id]
                  if (!stats) return null
                  const volume = volumeLabel(card, w.id, settings)
                  return (
                    <tr key={w.id}>
                      <td className="rt-name">{w.label}</td>
                      <td>{volume ? volume.split(' ')[0] : '–'}</td>
                      {cats.map(c => (
                        <td key={c.statId}>{stats[statKey(c.role, c.statId)] ?? '–'}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {mlb && mlbShard.data && (
          <>
            <PercentileSection mlb={mlb} season={mlbShard.data.season} />
            <StatcastSection
              mlb={mlb}
              isPitcher={isPitcher}
              season={mlbShard.data.season}
              prevSeason={mlbShard.data.prevSeason}
            />
          </>
        )}
        {mlbShard.data && !mlb && (
          <p className="drawer-note">No MLB StatsAPI match for this player yet.</p>
        )}

        <RollingChart
          points={rolling}
          title={isPitcher ? 'Rolling ERA' : 'Rolling wOBA'}
          note={isPitcher ? 'trailing 30 IP after each game' : 'trailing 100 PA after each game'}
          lgAvg={lgAvg}
          fmt={isPitcher ? (v => v.toFixed(2)) : (v => fmt3(v))}
        />

        {live === 'loading' && (
          <section className="drawer-section">
            <div className="card skeleton" aria-hidden />
          </section>
        )}

        {liveData?.splits && liveData.splits.length > 0 && (
          <section className="drawer-section">
            <h3 className="drawer-h">Season splits</h3>
            <div className="roster-table-wrap">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th className="rt-name">Split</th>
                    <th>PA</th><th>AVG</th><th>OBP</th><th>SLG</th><th>OPS</th>
                    <th>{isPitcher ? 'K' : 'HR'}</th>
                  </tr>
                </thead>
                <tbody>
                  {liveData.splits.map(sp => (
                    <tr key={sp.code}>
                      <td className="rt-name">{splitLabel(sp.code)}</td>
                      <td>{sp.pa ?? '–'}</td>
                      <td>{sp.avg ?? '–'}</td>
                      <td>{sp.obp ?? '–'}</td>
                      <td>{sp.slg ?? '–'}</td>
                      <td>{sp.ops ?? '–'}</td>
                      <td>{(isPitcher ? sp.strikeOuts : sp.homeRuns) ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {liveData?.games && <GamesSection games={liveData.games} isPitcher={isPitcher} />}

        <NewsSection stories={stories} transactions={liveData?.news ?? null} />
      </aside>
    </div>
  )
}
