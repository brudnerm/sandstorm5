/**
 * Client-side bridge to MLB data for the player drawer.
 *
 * Identity + Statcast come from the pipeline shard (data/mlb/players.json,
 * matched by normalized name, disambiguated by team). Splits, game logs,
 * and transaction news are fetched live from statsapi.mlb.com — it sends
 * `Access-Control-Allow-Origin: *`, so the browser can call it directly
 * and the data is always fresher than any snapshot.
 */
import { normalizeName, type MlbPlayer, type MlbShard } from '../../src/domain/mlb'
import type { PlayerCard } from '../../src/domain/players'

export function matchMlbPlayer(card: PlayerCard, shard: MlbShard): MlbPlayer | null {
  const wanted = normalizeName(card.name)
  const candidates = shard.players.filter(p => normalizeName(p.name) === wanted)
  if (candidates.length === 1) return candidates[0]!
  if (candidates.length > 1) {
    return candidates.find(p => p.team === card.mlbTeam) ?? null
  }
  return null
}

const API = 'https://statsapi.mlb.com/api/v1'
const cache = new Map<string, Promise<unknown>>()

function getJson<T>(url: string): Promise<T> {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then(resp => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return resp.json()
    }).catch(err => {
      cache.delete(url) // don't cache failures
      throw err
    }))
  }
  return cache.get(url) as Promise<T>
}

type AnyObj = Record<string, any>

export type StatGroup = 'hitting' | 'pitching'

export interface SplitLine {
  /** 'vl' | 'vr' */
  code: string
  pa: number | null
  avg: string | null
  obp: string | null
  slg: string | null
  ops: string | null
  homeRuns: number | null
  strikeOuts: number | null
}

export interface BatGame {
  ab: number
  r: number
  h: number
  doubles: number
  triples: number
  hr: number
  rbi: number
  sb: number
  bb: number
  ibb: number
  hbp: number
  sf: number
  so: number
}

export interface PitGame {
  /** Innings in true thirds (5.1 IP → 5.333) for aggregation. */
  ip: number
  /** Innings as MLB displays them ("5.1"). */
  ipDisplay: string
  h: number
  er: number
  bb: number
  so: number
  /** Decision: 'W' | 'L' | 'SV' | 'H' | null. */
  dec: string | null
}

export interface GameLine {
  date: string
  opponent: string
  home: boolean
  bat: BatGame | null
  pit: PitGame | null
}

export interface NewsItem {
  date: string
  description: string
}

export interface LivePlayerData {
  splits: SplitLine[] | null
  games: GameLine[] | null
  news: NewsItem[] | null
}

/** statsapi innings ("5.1") count thirds in the decimal. */
function parseIp(value: string): number {
  const [whole, frac] = value.split('.')
  return Number(whole ?? 0) + Number(frac ?? 0) / 3
}

function batGame(stat: AnyObj): BatGame {
  return {
    ab: Number(stat.atBats ?? 0),
    r: Number(stat.runs ?? 0),
    h: Number(stat.hits ?? 0),
    doubles: Number(stat.doubles ?? 0),
    triples: Number(stat.triples ?? 0),
    hr: Number(stat.homeRuns ?? 0),
    rbi: Number(stat.rbi ?? 0),
    sb: Number(stat.stolenBases ?? 0),
    bb: Number(stat.baseOnBalls ?? 0),
    ibb: Number(stat.intentionalWalks ?? 0),
    hbp: Number(stat.hitByPitch ?? 0),
    sf: Number(stat.sacFlies ?? 0),
    so: Number(stat.strikeOuts ?? 0),
  }
}

function pitGame(stat: AnyObj): PitGame {
  const ipDisplay = String(stat.inningsPitched ?? '0')
  return {
    ip: parseIp(ipDisplay),
    ipDisplay,
    h: Number(stat.hits ?? 0),
    er: Number(stat.earnedRuns ?? 0),
    bb: Number(stat.baseOnBalls ?? 0),
    so: Number(stat.strikeOuts ?? 0),
    dec: stat.wins > 0 ? 'W' : stat.losses > 0 ? 'L' : stat.saves > 0 ? 'SV' : stat.holds > 0 ? 'H' : null,
  }
}

async function fetchSplits(mlbamId: number, group: StatGroup, season: string): Promise<SplitLine[]> {
  const data = await getJson<AnyObj>(
    `${API}/people/${mlbamId}/stats?stats=statSplits&group=${group}&season=${season}&sitCodes=vl,vr`,
  )
  const splits: AnyObj[] = data.stats?.[0]?.splits ?? []
  return splits.map(sp => ({
    code: String(sp.split?.code ?? ''),
    pa: sp.stat?.plateAppearances ?? sp.stat?.battersFaced ?? null,
    avg: sp.stat?.avg ?? null,
    obp: sp.stat?.obp ?? null,
    slg: sp.stat?.slg ?? null,
    ops: sp.stat?.ops ?? null,
    homeRuns: sp.stat?.homeRuns ?? null,
    strikeOuts: sp.stat?.strikeOuts ?? null,
  }))
}

/** Game logs reference opponents by team id only; resolve to abbreviations. */
async function teamAbbrs(season: string): Promise<Map<number, string>> {
  const data = await getJson<AnyObj>(`${API}/teams?sportId=1&season=${season}`)
  const map = new Map<number, string>()
  for (const team of data.teams ?? []) map.set(Number(team.id), String(team.abbreviation ?? ''))
  return map
}

async function fetchGameLog(mlbamId: number, group: StatGroup, season: string): Promise<GameLine[]> {
  const [data, abbrs] = await Promise.all([
    getJson<AnyObj>(`${API}/people/${mlbamId}/stats?stats=gameLog&group=${group}&season=${season}`),
    teamAbbrs(season),
  ])
  const games: AnyObj[] = data.stats?.[0]?.splits ?? []
  // Full season, newest first — the drawer slices for display and the
  // rolling helpers re-sort chronologically. Copy before reversing: the
  // response object is cached and must not be mutated.
  return [...games].reverse().map(g => ({
    date: String(g.date ?? ''),
    opponent: abbrs.get(Number(g.opponent?.id)) ?? String(g.opponent?.name ?? ''),
    home: g.isHome === true,
    bat: group === 'hitting' ? batGame(g.stat ?? {}) : null,
    pit: group === 'pitching' ? pitGame(g.stat ?? {}) : null,
  }))
}

export interface RollingPoint {
  date: string
  value: number
}

// FanGraphs linear weights, near-constant season to season; close enough
// for a trend chart labeled wOBA (not xwOBA — that needs pitch-level data).
const W = { bb: 0.69, hbp: 0.72, single: 0.88, double: 1.24, triple: 1.56, hr: 2.0 }

/** Oldest→newest, whatever order the caller holds them in (ISO dates sort lexically). */
function chronological(games: GameLine[]): GameLine[] {
  return [...games].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Trailing-window wOBA after each game; points start once `window` PA accrue. */
export function rollingWoba(unordered: GameLine[], window = 100): RollingPoint[] {
  const games = chronological(unordered)
  const points: RollingPoint[] = []
  for (let i = 0; i < games.length; i++) {
    let numerator = 0
    let denominator = 0
    for (let j = i; j >= 0 && denominator < window; j--) {
      const b = games[j]!.bat
      if (!b) continue
      const singles = b.h - b.doubles - b.triples - b.hr
      numerator += W.bb * (b.bb - b.ibb) + W.hbp * b.hbp
        + W.single * singles + W.double * b.doubles + W.triple * b.triples + W.hr * b.hr
      denominator += b.ab + (b.bb - b.ibb) + b.sf + b.hbp
    }
    if (denominator >= window) points.push({ date: games[i]!.date, value: numerator / denominator })
  }
  return points
}

/** Trailing-window ERA after each game; points start once `windowIp` innings accrue. */
export function rollingEra(unordered: GameLine[], windowIp = 30): RollingPoint[] {
  const games = chronological(unordered)
  const points: RollingPoint[] = []
  for (let i = 0; i < games.length; i++) {
    let er = 0
    let ip = 0
    for (let j = i; j >= 0 && ip < windowIp; j--) {
      const p = games[j]!.pit
      if (!p) continue
      er += p.er
      ip += p.ip
    }
    if (ip >= windowIp) points.push({ date: games[i]!.date, value: (er * 9) / ip })
  }
  return points
}

async function fetchNews(mlbamId: number, season: string): Promise<NewsItem[]> {
  const today = new Date().toISOString().slice(0, 10)
  const data = await getJson<AnyObj>(
    `${API}/transactions?playerId=${mlbamId}&startDate=${season}-01-01&endDate=${today}`,
  )
  const items: AnyObj[] = data.transactions ?? []
  return items
    .filter(t => t.typeDesc !== 'Number Change' && t.description)
    .reverse()
    .slice(0, 8)
    .map(t => ({ date: String(t.date ?? ''), description: String(t.description) }))
}

/** Fetch everything the drawer's live sections need; nulls where a call failed. */
export async function fetchLivePlayerData(
  mlbamId: number,
  group: StatGroup,
  season: string,
): Promise<LivePlayerData> {
  const [splits, games, news] = await Promise.allSettled([
    fetchSplits(mlbamId, group, season),
    fetchGameLog(mlbamId, group, season),
    fetchNews(mlbamId, season),
  ])
  return {
    splits: splits.status === 'fulfilled' ? splits.value : null,
    games: games.status === 'fulfilled' ? games.value : null,
    news: news.status === 'fulfilled' ? news.value : null,
  }
}
