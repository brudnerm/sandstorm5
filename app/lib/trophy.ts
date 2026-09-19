/**
 * Trophy Room client helpers: loading the shards and deriving the handful of
 * figures the landing page leads with.
 *
 * Everything here is computed from the shards. No figure in the Trophy Room
 * is ever written into copy by hand, so every headline number on the page
 * traces back to a row a validator checked.
 */
import type { TeamWeek } from '../../src/domain/records'
import {
  BRACKET_BY_CODE,
  type MatchupShard,
  type SeasonsShard,
  type TrophySeason,
  type TransactionsShard,
  type TrophyWeek,
  type WeeklyShard,
} from '../../src/domain/trophy'
import type { CuratedShard } from '../../src/domain/curated'
import type { CopyShard } from '../../src/trophy/copy'
import type { DraftsShard } from '../../src/trophy/drafts'
import { useJson } from './useJson'

export type Tone = 'praise' | 'shame'

export function useTrophySeasons(leagueId: string) {
  return useJson<SeasonsShard>(`data/${leagueId}/trophy/seasons.json`)
}

export interface OwnerLookup {
  name: (ownerId: string) => string
  teamName: (ownerId: string, season: number) => string | null
  /** The positional shards reference owners by index into shard.owners. */
  byIndex: (index: number) => string
}

export function ownerLookup(shard: SeasonsShard): OwnerLookup {
  const byId = new Map(shard.owners.map(o => [o.id, o]))
  return {
    name: id => byId.get(id)?.displayName ?? id,
    teamName: (id, season) => byId.get(id)?.teamNames[String(season)] ?? null,
    byIndex: index => shard.owners[index]?.id ?? '',
  }
}

/** Seasons Yahoo has marked finished, newest first. */
export function finishedSeasons(shard: SeasonsShard): TrophySeason[] {
  return shard.seasons.filter(s => s.isFinished).sort((a, b) => b.season - a.season)
}

export interface HeroTile {
  label: string
  /** Owner display names. More than one means a genuine tie. */
  names: string[]
  /** The number that earns the tile, already formatted. */
  value: string
  /** Season, team name, or whatever else makes the number checkable. */
  detail: string
  tone: Tone
}

/**
 * The four figures the landing page leads with. Ties are returned as ties
 * rather than broken arbitrarily — three owners share the title lead and two
 * share the longest drought, and quietly picking one would be a lie.
 */
export function heroSummary(shard: SeasonsShard): HeroTile[] {
  const lookup = ownerLookup(shard)
  const finished = finishedSeasons(shard)
  const tiles: HeroTile[] = []
  if (finished.length === 0) return tiles

  const latest = finished[0]!
  const currentSeason = Math.max(...shard.seasons.map(s => s.season))

  if (latest.champion) {
    tiles.push({
      label: 'Reigning champion',
      names: [lookup.name(latest.champion.ownerId)],
      value: String(latest.season),
      detail: latest.champion.teamName,
      tone: 'praise',
    })
  }

  // Most titles
  const titles = new Map<string, number>()
  for (const season of finished) {
    if (!season.champion) continue
    titles.set(season.champion.ownerId, (titles.get(season.champion.ownerId) ?? 0) + 1)
  }
  const mostTitles = Math.max(0, ...titles.values())
  if (mostTitles > 0) {
    const leaders = [...titles.entries()].filter(([, n]) => n === mostTitles).map(([id]) => id)
    tiles.push({
      label: 'Most titles',
      names: leaders.map(lookup.name),
      value: `${mostTitles} ${mostTitles === 1 ? 'title' : 'titles'}`,
      detail: leaders.length > 1 ? `${leaders.length}-way tie` : 'outright',
      tone: 'praise',
    })
  }

  // Longest active drought. An owner who has never won is measured from their
  // first season, so "never" reads as a length rather than as an absence.
  const active = shard.owners.filter(o => o.teamNames[String(currentSeason)])
  let longest = -1
  let droughtLeaders: Array<{ id: string; everWon: boolean }> = []
  for (const owner of active) {
    const wins = finished.filter(s => s.champion?.ownerId === owner.id).map(s => s.season)
    const lastWin = wins.length > 0 ? Math.max(...wins) : null
    const played = Object.keys(owner.teamNames).map(Number).sort((a, b) => a - b)
    const drought = lastWin === null ? currentSeason - played[0]! + 1 : currentSeason - lastWin
    if (drought > longest) {
      longest = drought
      droughtLeaders = [{ id: owner.id, everWon: lastWin !== null }]
    } else if (drought === longest) {
      droughtLeaders.push({ id: owner.id, everWon: lastWin !== null })
    }
  }
  if (droughtLeaders.length > 0) {
    // Equal droughts among title-holders imply the same last-won season, so
    // the detail can name it. A mix of never-won and won cannot, so it says
    // nothing rather than something misleading.
    const neverWon = droughtLeaders.every(l => !l.everWon)
    const allWon = droughtLeaders.every(l => l.everWon)
    tiles.push({
      label: 'Longest active drought',
      names: droughtLeaders.map(l => lookup.name(l.id)),
      value: `${longest} ${longest === 1 ? 'season' : 'seasons'}`,
      detail: neverWon ? 'never won a title' : allWon ? `last won ${currentSeason - longest}` : 'since their last title',
      tone: 'shame',
    })
  }

  if (latest.lastPlace) {
    tiles.push({
      label: 'Reigning last place',
      names: [lookup.name(latest.lastPlace.ownerId)],
      value: String(latest.season),
      detail: latest.lastPlace.teamName,
      tone: 'shame',
    })
  }

  return tiles
}

export interface Wing {
  slug: string
  title: string
  blurb: string
  tone: Tone
}

/**
 * The wings, in the order the landing page lists them. Each is its own hash
 * route so a single section can be linked straight from a league email.
 */
export const WINGS: Wing[] = [
  {
    slug: 'champions',
    title: 'Hall of Champions',
    blurb: 'Every title since 2009, with the final that decided it.',
    tone: 'praise',
  },
  {
    slug: 'records',
    title: 'Weekly Records',
    blurb: 'The best and worst single weeks in every category.',
    tone: 'praise',
  },
  {
    slug: 'owners',
    title: 'Owners',
    blurb: 'All-time standings, and a page for every manager.',
    tone: 'praise',
  },
  {
    slug: 'rivalries',
    title: 'Rivalries',
    blurb: 'Head to head, all time, owner against owner.',
    tone: 'praise',
  },
  {
    slug: 'shame',
    title: 'Hall of Shame',
    blurb: 'Last place, repeat offenders, and the worst records on file.',
    tone: 'shame',
  },
  {
    slug: 'archive',
    title: 'Archive',
    blurb: 'Team names, transactions, streaks and the rest of the record.',
    tone: 'praise',
  },
  {
    slug: 'museum',
    title: 'The Museum',
    blurb: 'Vetoed trades, long-held keepers and one-off plaques, entered by hand.',
    tone: 'praise',
  },
]

export function wingBySlug(slug: string | null): Wing | null {
  return WINGS.find(w => w.slug === slug) ?? null
}

/** Range label for a stat that did not exist in every season, e.g. "2023-2026". */
export function seasonSpan(seasons: TrophySeason[]): string {
  if (seasons.length === 0) return ''
  const years = seasons.map(s => s.season).sort((a, b) => a - b)
  return `${years[0]}–${years[years.length - 1]}`
}

// ---------------------------------------------------------------- shards

/** An empty league id means "this view does not need the shard", so skip it. */
const shardPath = (leagueId: string, name: string): string | null =>
  leagueId ? `data/${leagueId}/trophy/${name}` : null

export function useTrophyMatchups(leagueId: string) {
  return useJson<MatchupShard>(shardPath(leagueId, 'matchups.json'))
}
export function useTrophyDrafts(leagueId: string) {
  return useJson<DraftsShard>(shardPath(leagueId, 'drafts.json'))
}
export function useTrophyCopy(leagueId: string) {
  return useJson<CopyShard>(shardPath(leagueId, 'copy.json'))
}
export function useTrophyWeekly(leagueId: string) {
  return useJson<WeeklyShard>(shardPath(leagueId, 'weekly.json'))
}
export function useTrophyTransactions(leagueId: string) {
  return useJson<TransactionsShard>(shardPath(leagueId, 'transactions.json'))
}
export function useTrophyCurated(leagueId: string) {
  return useJson<CuratedShard>(shardPath(leagueId, 'curated.json'))
}

/**
 * Decode the positional weekly rows into something the record tables can
 * rank. The column order is declared in the shard rather than assumed here,
 * so adding a category to the league does not silently shift every value.
 */
export function decodeWeekly(weekly: WeeklyShard, statOrder: string[]): TeamWeek[] {
  const col = (name: string) => weekly.columns.indexOf(name)
  const idx = {
    season: col('season'), week: col('week'), owner: col('owner'),
    days: col('days'), bracket: col('bracket'),
    ab: col('ab'), ip: col('ip'), completedGames: col('completedGames'),
  }
  const statCols = statOrder.map(abbr => [abbr, col(abbr)] as const)
  return weekly.rows.map(r => ({
    season: r[idx.season] as number,
    week: r[idx.week] as number,
    ownerIndex: r[idx.owner] as number,
    days: r[idx.days] as number,
    bracket: BRACKET_BY_CODE[r[idx.bracket] as number] ?? 'regular',
    values: Object.fromEntries(statCols.map(([abbr, i]) => [abbr, i >= 0 ? r[i] ?? null : null])),
    ab: idx.ab >= 0 ? r[idx.ab] ?? null : null,
    ip: idx.ip >= 0 ? r[idx.ip] ?? null : null,
    completedGames: idx.completedGames >= 0 ? r[idx.completedGames] ?? null : null,
  }))
}

/**
 * The blurb for a key, or null when there is nothing to show.
 *
 * An approved entry always renders. A draft renders only when `allowDrafts`
 * is set, which the view supplies from `import.meta.env.DEV` — a build-time
 * constant, so on the deployed site unapproved text is not merely hidden,
 * the branch is gone. Nothing anyone has not read can reach the league.
 */
export function usableCopy(
  shard: CopyShard | null,
  key: string,
  allowDrafts: boolean,
): { text: string; isDraft: boolean } | null {
  const entry = shard?.entries?.[key]
  if (!entry) return null
  if (entry.status === 'approved') return { text: entry.text, isDraft: false }
  return allowDrafts ? { text: entry.text, isDraft: true } : null
}

// ------------------------------------------------------------- champions

export interface FinalDetail {
  opponentId: string
  opponentTeamName: string
  /** From the champion's point of view. */
  w: number
  l: number
  t: number
  categories: Array<{ abbr: string; outcome: 'W' | 'L' | 'T' | '.' }>
  week: TrophyWeek | undefined
}

/** The championship final of a season, from the champion's point of view. */
export function finalDetail(
  seasonsShard: SeasonsShard,
  matchups: MatchupShard,
  season: TrophySeason,
): FinalDetail | null {
  if (!season.champion || season.playoffWeeks.length === 0) return null
  const c = matchups.columns
  const i = {
    season: c.indexOf('season'), week: c.indexOf('week'),
    a: c.indexOf('ownerA'), b: c.indexOf('ownerB'),
    bracket: c.indexOf('bracket'), results: c.indexOf('results'),
  }
  const finalWeek = Math.max(...season.playoffWeeks)
  const row = matchups.rows.find(
    r => r[i.season] === season.season && r[i.week] === finalWeek &&
      BRACKET_BY_CODE[r[i.bracket] as number] === 'championship',
  )
  if (!row) return null

  const owners = seasonsShard.owners
  const aId = owners[row[i.a] as number]?.id
  const bId = owners[row[i.b] as number]?.id
  const championIsA = aId === season.champion.ownerId
  const opponentId = (championIsA ? bId : aId) ?? ''
  const raw = String(row[i.results])
  const flipped = championIsA
    ? raw
    : [...raw].map(ch => (ch === 'W' ? 'L' : ch === 'L' ? 'W' : ch)).join('')

  const categories = [...flipped].map((outcome, idx) => ({
    abbr: season.statOrder[idx] ?? seasonsShard.weeklyColumns[idx + 5] ?? '?',
    outcome: outcome as 'W' | 'L' | 'T' | '.',
  }))
  return {
    opponentId,
    opponentTeamName: season.standings.find(r => r.ownerId === opponentId)?.teamName ?? '',
    w: [...flipped].filter(ch => ch === 'W').length,
    l: [...flipped].filter(ch => ch === 'L').length,
    t: [...flipped].filter(ch => ch === 'T').length,
    categories,
    week: season.weeks.find(w => w.week === finalWeek),
  }
}

export interface TitleCount {
  ownerId: string
  titles: number
  seasons: number[]
}

export function titleCounts(shard: SeasonsShard): TitleCount[] {
  const by = new Map<string, number[]>()
  for (const season of finishedSeasons(shard)) {
    if (!season.champion) continue
    by.set(season.champion.ownerId, [...(by.get(season.champion.ownerId) ?? []), season.season])
  }
  return [...by.entries()]
    .map(([ownerId, seasons]) => ({ ownerId, titles: seasons.length, seasons: seasons.sort((a, b) => a - b) }))
    .sort((a, b) => b.titles - a.titles || b.seasons[b.seasons.length - 1]! - a.seasons[a.seasons.length - 1]!)
}

const ORDINAL_LABELS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th']
const ordinalLabel = (n: number): string => ORDINAL_LABELS[n] ?? `${n}th`

export interface ChampionRecord {
  label: string
  ownerIds: string[]
  value: string
  detail: string
}

/** The handful of championship extremes the wing leads with. */
export function championRecords(shard: SeasonsShard): ChampionRecord[] {
  const finished = finishedSeasons(shard)
  const lookup = ownerLookup(shard)
  const out: ChampionRecord[] = []
  const withSeed = finished
    .filter(s => s.champion)
    .map(s => ({ season: s, seed: s.standings.find(r => r.ownerId === s.champion!.ownerId)?.seed ?? 0 }))
    .filter(x => x.seed > 0)

  if (withSeed.length > 0) {
    const worst = Math.max(...withSeed.map(x => x.seed))
    const picks = withSeed.filter(x => x.seed === worst)
    out.push({
      label: 'Lowest seed to win',
      ownerIds: picks.map(p => p.season.champion!.ownerId),
      value: `${ordinalLabel(worst)} seed`,
      detail: picks.map(p => p.season.season).join(', '),
    })
    const best = Math.min(...withSeed.map(x => x.seed))
    const bestPicks = withSeed.filter(x => x.seed === best)
    out.push({
      label: 'Titles from the top seed',
      ownerIds: [...new Set(bestPicks.map(p => p.season.champion!.ownerId))],
      value: `${bestPicks.length}`,
      detail: bestPicks.map(p => p.season.season).join(', '),
    })
  }

  // Best regular season by a champion, compared on winning percentage so the
  // shortened 2020 season is not judged against full ones.
  const byPct = finished
    .filter(s => s.champion)
    .map(s => ({ season: s, row: s.standings.find(r => r.ownerId === s.champion!.ownerId) }))
    .filter(x => x.row)
  if (byPct.length > 0) {
    const best = byPct.reduce((a, b) => (Number(b.row!.percentage) > Number(a.row!.percentage) ? b : a))
    out.push({
      label: 'Best regular season by a champion',
      ownerIds: [best.season.champion!.ownerId],
      value: `${best.row!.wins}-${best.row!.losses}-${best.row!.ties}`,
      detail: `${best.season.season}, ${best.row!.percentage}`,
    })
    const worst = byPct.reduce((a, b) => (Number(b.row!.percentage) < Number(a.row!.percentage) ? b : a))
    out.push({
      label: 'Worst regular season by a champion',
      ownerIds: [worst.season.champion!.ownerId],
      value: `${worst.row!.wins}-${worst.row!.losses}-${worst.row!.ties}`,
      detail: `${worst.season.season}, ${worst.row!.percentage}`,
    })
  }

  const repeat = titleCounts(shard).filter(t => t.titles > 1)
  if (repeat.length > 0) {
    out.push({
      label: 'Repeat champions',
      ownerIds: repeat.map(r => r.ownerId),
      value: `${repeat.length}`,
      detail: repeat.map(r => `${lookup.name(r.ownerId)} ${r.titles}`).join(', '),
    })
  }
  return out
}

// ----------------------------------------------------------------- shame

export interface LastPlaceCount {
  ownerId: string
  finishes: number
  seasons: number[]
}

export function lastPlaceCounts(shard: SeasonsShard): LastPlaceCount[] {
  const by = new Map<string, number[]>()
  for (const season of finishedSeasons(shard)) {
    if (!season.lastPlace) continue
    by.set(season.lastPlace.ownerId, [...(by.get(season.lastPlace.ownerId) ?? []), season.season])
  }
  return [...by.entries()]
    .map(([ownerId, seasons]) => ({ ownerId, finishes: seasons.length, seasons: seasons.sort((a, b) => a - b) }))
    .sort((a, b) => b.finishes - a.finishes || b.seasons[b.seasons.length - 1]! - a.seasons[a.seasons.length - 1]!)
}

export interface SeasonRecordRow {
  ownerId: string
  season: number
  teamName: string
  wins: number
  losses: number
  ties: number
  percentage: string
  seed: number
}

/**
 * Every team-season's regular-season record, worst first. Ranked on winning
 * percentage rather than raw wins, so the shortened 2020 season sits on the
 * same scale as a full one.
 */
export function worstSeasonRecords(shard: SeasonsShard, limit = 10): SeasonRecordRow[] {
  const rows: SeasonRecordRow[] = []
  for (const season of finishedSeasons(shard)) {
    for (const row of season.standings) {
      rows.push({ ...row, season: season.season })
    }
  }
  return rows
    .sort((a, b) => Number(a.percentage) - Number(b.percentage) || a.wins - b.wins)
    .slice(0, limit)
}

/** The gap between last place and the team immediately above it. */
export function gapToPenultimate(season: TrophySeason): {
  wins: number
  levelOnRecord: boolean
  place: number
} | null {
  const rows = season.standings
  const last = rows[rows.length - 1]
  const above = rows[rows.length - 2]
  if (!last || !above) return null
  return {
    wins: above.wins - last.wins,
    levelOnRecord: last.percentage === above.percentage,
    place: rows.length - 1,
  }
}
