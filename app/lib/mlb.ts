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

export interface GameLine {
  date: string
  opponent: string
  home: boolean
  summary: string
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

function batterSummary(stat: AnyObj): string {
  const parts = [`${stat.hits ?? 0}-${stat.atBats ?? 0}`]
  if (stat.homeRuns > 0) parts.push(`${stat.homeRuns} HR`)
  if (stat.rbi > 0) parts.push(`${stat.rbi} RBI`)
  if (stat.runs > 0) parts.push(`${stat.runs} R`)
  if (stat.stolenBases > 0) parts.push(`${stat.stolenBases} SB`)
  if (stat.baseOnBalls > 0) parts.push(`${stat.baseOnBalls} BB`)
  return parts.join(', ')
}

function pitcherSummary(stat: AnyObj): string {
  const parts = [`${stat.inningsPitched ?? '0'} IP`, `${stat.earnedRuns ?? 0} ER`, `${stat.strikeOuts ?? 0} K`]
  if (stat.baseOnBalls > 0) parts.push(`${stat.baseOnBalls} BB`)
  if (stat.wins > 0) parts.push('W')
  if (stat.losses > 0) parts.push('L')
  if (stat.saves > 0) parts.push('SV')
  return parts.join(', ')
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
  return games.slice(-10).reverse().map(g => ({
    date: String(g.date ?? ''),
    opponent: abbrs.get(Number(g.opponent?.id)) ?? String(g.opponent?.name ?? ''),
    home: g.isHome === true,
    summary: group === 'hitting' ? batterSummary(g.stat ?? {}) : pitcherSummary(g.stat ?? {}),
  }))
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
