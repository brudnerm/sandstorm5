/**
 * Player profile drawer: fantasy production windows, Statcast quality of
 * contact + expected stats, season splits vs L/R, last 10 games, and
 * recent roster-move news. Opens over any view; bottom sheet on mobile,
 * side panel on desktop.
 */
import { useEffect, useState } from 'react'
import type { MlbPlayer, MlbShard } from '../../src/domain/mlb'
import type { PlayerCard, StatWindow } from '../../src/domain/players'
import { scoredCategories, statKey, type LeagueSeasonSettings } from '../../src/domain/stats'
import { fetchLivePlayerData, matchMlbPlayer, type LivePlayerData } from '../lib/mlb'
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

function fmt3(v: number | null): string {
  if (v === null) return '–'
  return v.toFixed(3).replace(/^0/, '')
}

/**
 * A Statcast expected-vs-actual pair. `betterWhenLower` flips the "due for
 * better results" reading for run-prevention stats like ERA.
 */
function XPair({ label, actual, expected, betterWhenLower = false, threshold = 0.015, era = false }: {
  label: string
  actual: number | null
  expected: number | null
  betterWhenLower?: boolean
  threshold?: number
  /** ERA-style two-decimal formatting instead of .xxx rate formatting. */
  era?: boolean
}) {
  if (actual === null && expected === null) return null
  let cls = ''
  if (actual !== null && expected !== null) {
    const gap = expected - actual
    const due = betterWhenLower ? gap < -threshold : gap > threshold
    const overperforming = betterWhenLower ? gap > threshold : gap < -threshold
    cls = due ? ' win' : overperforming ? ' loss' : ''
  }
  const show = (v: number | null) => v === null ? '–' : era ? v.toFixed(2) : fmt3(v)
  return (
    <div className="xstat">
      <span className="xstat-label">{label}</span>
      <span className="xstat-vals">
        {show(actual)} <span className={`xstat-x${cls}`}>x{show(expected)}</span>
      </span>
    </div>
  )
}

function Meter({ label, value, suffix = '' }: { label: string; value: number | null; suffix?: string }) {
  if (value === null) return null
  return (
    <div className="xstat">
      <span className="xstat-label">{label}</span>
      <span className="xstat-vals">{value}{suffix}</span>
    </div>
  )
}

function StatcastSection({ mlb }: { mlb: MlbPlayer }) {
  const bat = mlb.batting
  const pit = mlb.pitching
  if (!bat && !pit) return null
  return (
    <section className="drawer-section">
      <h3 className="drawer-h">
        Statcast
        <span className="drawer-h-note">
          {bat?.pa ? `${bat.pa} PA` : pit?.pa ? `${pit.pa} BF` : ''} · expected in gray, green = due for better
        </span>
      </h3>
      {bat && (
        <div className="xstat-grid">
          <XPair label="BA" actual={bat.ba} expected={bat.xba} />
          <XPair label="SLG" actual={bat.slg} expected={bat.xslg} threshold={0.025} />
          <XPair label="wOBA" actual={bat.woba} expected={bat.xwoba} />
          <Meter label="Exit velo" value={bat.ev} suffix=" mph" />
          <Meter label="Max EV" value={bat.maxEv} suffix=" mph" />
          <Meter label="Hard-hit" value={bat.hardHitPct} suffix="%" />
          <Meter label="Barrel" value={bat.barrelPct} suffix="%" />
          <Meter label="Sweet spot" value={bat.sweetSpotPct} suffix="%" />
        </div>
      )}
      {pit && (
        <div className="xstat-grid">
          <XPair label="ERA" actual={pit.era} expected={pit.xera} betterWhenLower threshold={0.2} era />
          <XPair label="BA against" actual={pit.ba} expected={pit.xba} betterWhenLower />
          <XPair label="wOBA against" actual={pit.woba} expected={pit.xwoba} betterWhenLower />
          <Meter label="Exit velo against" value={pit.ev} suffix=" mph" />
          <Meter label="Hard-hit against" value={pit.hardHitPct} suffix="%" />
          <Meter label="Barrel against" value={pit.barrelPct} suffix="%" />
        </div>
      )}
    </section>
  )
}

export default function PlayerDrawer({ player, settings, onClose }: Props) {
  const { card } = player
  const isPitcher = card.positionType === 'P'
  const mlbShard = useJson<MlbShard>('data/mlb/players.json')
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
  const yahooId = card.playerKey.split('.').at(-1)
  const splitLabel = (code: string) =>
    code === 'vl' ? (isPitcher ? 'vs LHB' : 'vs LHP') : (isPitcher ? 'vs RHB' : 'vs RHP')

  const liveData = live !== 'loading' ? live : null

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
              <a href={`https://sports.yahoo.com/mlb/players/${yahooId}`} target="_blank" rel="noreferrer">
                Yahoo page ↗
              </a>
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

        {mlb && <StatcastSection mlb={mlb} />}
        {mlbShard.data && !mlb && (
          <p className="drawer-note">No MLB StatsAPI match for this player yet.</p>
        )}

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

        {liveData?.games && liveData.games.length > 0 && (
          <section className="drawer-section">
            <h3 className="drawer-h">Last {liveData.games.length} games</h3>
            <ul className="drawer-games">
              {liveData.games.map(g => (
                <li key={g.date + g.opponent}>
                  <span className="drawer-game-date">{g.date.slice(5)}</span>
                  <span className="drawer-game-opp">{g.home ? 'vs' : '@'} {g.opponent}</span>
                  <span className="drawer-game-line">{g.summary}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {liveData?.news && liveData.news.length > 0 && (
          <section className="drawer-section">
            <h3 className="drawer-h">News & roster moves</h3>
            <ul className="drawer-news">
              {liveData.news.map((n, i) => (
                <li key={i}>
                  <span className="drawer-game-date">{n.date}</span>
                  <span>{n.description}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  )
}
