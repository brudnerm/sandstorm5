/**
 * League-trend computations for the Standings view, all derived from the
 * season matchups shard: weekly standings trajectories (rank by week),
 * per-category recent form, all-play "luck" records, and category leaders.
 *
 * Only completed regular-season weeks count — playoff weeks are excluded
 * because Yahoo freezes standings once they start, and the current
 * mid-event week only ever contributes an explicitly-provisional point.
 *
 * Pure functions over domain types (no React/DOM), like matrix.ts.
 */
import type { Matchup, MatchupTeam, SeasonMatchups, TeamScore } from '../../src/domain/matchups'
import {
  compareStat,
  scoredCategories,
  statKey,
  type LeagueSeasonSettings,
  type StatCategory,
  type StatKey,
} from '../../src/domain/stats'

export interface TeamMeta {
  teamKey: string
  name: string
  manager: string
  logoUrl: string | null
}

export interface WeeklyRankPoint {
  week: number
  rank: number
  /** True for the in-progress week's point (dashed in the chart). */
  provisional: boolean
}

export interface TeamTrajectory {
  team: TeamMeta
  points: WeeklyRankPoint[]
  /**
   * Rank change between the last two completed weeks; positive = climbed
   * (e.g. +2 means up two spots). Null with fewer than two completed weeks.
   */
  movement: number | null
}

export interface CategoryFormCell {
  key: StatKey
  abbr: string
  /** (wins + ties/2) / games over the recent window; null with no games. */
  recentRate: number | null
  seasonRate: number | null
  trend: 'up' | 'down' | 'flat'
}

export interface TeamCategoryForm {
  team: TeamMeta
  cells: CategoryFormCell[]
}

export interface AllPlayRow {
  team: TeamMeta
  /** Actual category record: the sum of weekly matchup scores. */
  actual: TeamScore
  /** Record if every category were scored against every team, every week. */
  allPlay: TeamScore
  actualPct: number
  allPlayPct: number
  /** actualPct − allPlayPct: positive = friendlier schedule than deserved. */
  luck: number
}

export interface CategoryLeader {
  category: StatCategory
  team: TeamMeta
  record: TeamScore
  rate: number
}

/** How far recent form must diverge from season rate to count as a trend. */
const TREND_THRESHOLD = 0.10

function teamMeta(team: MatchupTeam): TeamMeta {
  return { teamKey: team.teamKey, name: team.name, manager: team.manager, logoUrl: team.logoUrl }
}

/** Winning percentage with ties as half-wins; 0 when no games. */
export function winPct(record: TeamScore): number {
  const games = record.w + record.l + record.t
  return games > 0 ? (record.w + record.t / 2) / games : 0
}

/**
 * Completed regular-season weeks, ascending. Skips empty week arrays
 * (future weeks), in-progress weeks, and playoffs.
 */
export function completedWeeks(season: SeasonMatchups): number[] {
  return Object.entries(season.weeks)
    .filter(([, matchups]) =>
      matchups.length > 0 &&
      matchups.every(m => m.status === 'postevent') &&
      !matchups.some(m => m.isPlayoffs))
    .map(([week]) => Number(week))
    .sort((a, b) => a - b)
}

function teamsOfWeek(matchups: Matchup[]): MatchupTeam[] {
  return matchups.flatMap(m => m.teams)
}

/**
 * Rank cumulative records Yahoo-style: winning percentage, then total
 * wins. The final tie-break is the immutable teamKey — NOT the display
 * name, which teams rename mid-season and would create phantom
 * week-over-week movement on exact ties. Returns 1-based ranks.
 */
export function rankTeams(
  records: Map<string, { meta: TeamMeta; record: TeamScore }>,
): Map<string, number> {
  const ordered = [...records.values()].sort((a, b) =>
    winPct(b.record) - winPct(a.record) ||
    b.record.w - a.record.w ||
    a.meta.teamKey.localeCompare(b.meta.teamKey))
  return new Map(ordered.map((entry, i) => [entry.meta.teamKey, i + 1]))
}

function addScore(into: TeamScore, score: TeamScore): void {
  into.w += score.w
  into.l += score.l
  into.t += score.t
}

/**
 * Rank-by-week trajectories. Cumulative records accrue over completed
 * weeks; a team missing a week (bye) keeps its prior record and is still
 * ranked. When `liveScoreboard` covers a week beyond the completed ones,
 * its in-progress scores yield one extra provisional point per team.
 */
export function computeTrajectories(
  season: SeasonMatchups,
  liveScoreboard: Matchup[] | null,
): TeamTrajectory[] {
  const weeks = completedWeeks(season)
  const cumulative = new Map<string, { meta: TeamMeta; record: TeamScore }>()
  const pointsByTeam = new Map<string, WeeklyRankPoint[]>()

  const rankAndRecord = (week: number, provisional: boolean) => {
    const ranks = rankTeams(cumulative)
    for (const [teamKey, rank] of ranks) {
      const points = pointsByTeam.get(teamKey) ?? []
      points.push({ week, rank, provisional })
      pointsByTeam.set(teamKey, points)
    }
  }

  for (const week of weeks) {
    for (const team of teamsOfWeek(season.weeks[String(week)] ?? [])) {
      const entry = cumulative.get(team.teamKey) ??
        { meta: teamMeta(team), record: { w: 0, l: 0, t: 0 } }
      entry.meta = teamMeta(team) // teams rename mid-season; keep the latest
      addScore(entry.record, team.score)
      cumulative.set(team.teamKey, entry)
    }
    rankAndRecord(week, false)
  }

  // Provisional point from the live week, layered on top of a COPY of the
  // completed cumulative records.
  const liveWeek = liveScoreboard?.[0]?.week
  if (liveScoreboard && liveWeek !== undefined && !weeks.includes(liveWeek) &&
      !liveScoreboard.some(m => m.isPlayoffs)) {
    const snapshot = new Map(
      [...cumulative].map(([k, v]) => [k, { meta: v.meta, record: { ...v.record } }]),
    )
    for (const team of teamsOfWeek(liveScoreboard)) {
      const entry = snapshot.get(team.teamKey) ??
        { meta: teamMeta(team), record: { w: 0, l: 0, t: 0 } }
      addScore(entry.record, team.score)
      snapshot.set(team.teamKey, entry)
    }
    const ranks = rankTeams(snapshot)
    for (const [teamKey, rank] of ranks) {
      const points = pointsByTeam.get(teamKey) ?? []
      points.push({ week: liveWeek, rank, provisional: true })
      pointsByTeam.set(teamKey, points)
      if (!cumulative.has(teamKey)) cumulative.set(teamKey, snapshot.get(teamKey)!)
    }
  }

  return [...cumulative.values()].map(({ meta }) => {
    const points = pointsByTeam.get(meta.teamKey) ?? []
    const completed = points.filter(p => !p.provisional)
    const movement = completed.length >= 2
      ? completed[completed.length - 2]!.rank - completed[completed.length - 1]!.rank
      : null
    return { team: meta, points, movement }
  })
}

/**
 * Per-team, per-category win rates: the recent window vs the whole season,
 * from the precomputed weekly `results`.
 */
export function computeCategoryForm(
  season: SeasonMatchups,
  settings: LeagueSeasonSettings,
  window = 4,
): TeamCategoryForm[] {
  const weeks = completedWeeks(season)
  const recentWeeks = new Set(weeks.slice(-window))
  const categories = scoredCategories(settings)

  interface Tally { meta: TeamMeta; recent: Map<StatKey, TeamScore>; seasonTotals: Map<StatKey, TeamScore> }
  const tallies = new Map<string, Tally>()

  for (const week of weeks) {
    for (const team of teamsOfWeek(season.weeks[String(week)] ?? [])) {
      const tally = tallies.get(team.teamKey) ??
        { meta: teamMeta(team), recent: new Map(), seasonTotals: new Map() }
      tally.meta = teamMeta(team) // keep the latest team name
      for (const category of categories) {
        const key = statKey(category.role, category.statId)
        const outcome = team.results[key]
        if (!outcome) continue
        for (const bucket of recentWeeks.has(week) ? [tally.seasonTotals, tally.recent] : [tally.seasonTotals]) {
          const record = bucket.get(key) ?? { w: 0, l: 0, t: 0 }
          if (outcome === 'win') record.w++
          else if (outcome === 'loss') record.l++
          else record.t++
          bucket.set(key, record)
        }
      }
      tallies.set(team.teamKey, tally)
    }
  }

  const rate = (record: TeamScore | undefined): number | null =>
    record && record.w + record.l + record.t > 0 ? winPct(record) : null

  return [...tallies.values()].map(tally => ({
    team: tally.meta,
    cells: categories.map(category => {
      const key = statKey(category.role, category.statId)
      const recentRate = rate(tally.recent.get(key))
      const seasonRate = rate(tally.seasonTotals.get(key))
      let trend: CategoryFormCell['trend'] = 'flat'
      if (recentRate !== null && seasonRate !== null) {
        if (recentRate - seasonRate >= TREND_THRESHOLD) trend = 'up'
        else if (seasonRate - recentRate >= TREND_THRESHOLD) trend = 'down'
      }
      return { key, abbr: category.abbr, recentRate, seasonRate, trend }
    }),
  }))
}

/**
 * All-play records: every completed week, every scored category, every
 * team scored against every other team. Comparing a team's actual record
 * to its all-play record separates schedule luck from stat quality.
 */
export function computeAllPlay(
  season: SeasonMatchups,
  settings: LeagueSeasonSettings,
): AllPlayRow[] {
  const categories = scoredCategories(settings)
  const rows = new Map<string, { meta: TeamMeta; actual: TeamScore; allPlay: TeamScore }>()

  for (const week of completedWeeks(season)) {
    const teams = teamsOfWeek(season.weeks[String(week)] ?? [])
    for (const team of teams) {
      const row = rows.get(team.teamKey) ??
        { meta: teamMeta(team), actual: { w: 0, l: 0, t: 0 }, allPlay: { w: 0, l: 0, t: 0 } }
      row.meta = teamMeta(team) // keep the latest team name
      addScore(row.actual, team.score)
      rows.set(team.teamKey, row)
    }
    // Each unordered pair once, credited symmetrically.
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const a = rows.get(teams[i]!.teamKey)!
        const b = rows.get(teams[j]!.teamKey)!
        for (const category of categories) {
          const key = statKey(category.role, category.statId)
          const outcome = compareStat(category, teams[i]!.stats[key] ?? '', teams[j]!.stats[key] ?? '')
          if (outcome === 'win') { a.allPlay.w++; b.allPlay.l++ }
          else if (outcome === 'loss') { a.allPlay.l++; b.allPlay.w++ }
          else { a.allPlay.t++; b.allPlay.t++ }
        }
      }
    }
  }

  return [...rows.values()]
    .map(row => {
      const actualPct = winPct(row.actual)
      const allPlayPct = winPct(row.allPlay)
      return { team: row.meta, actual: row.actual, allPlay: row.allPlay, actualPct, allPlayPct, luck: actualPct - allPlayPct }
    })
    .sort((a, b) => b.luck - a.luck)
}

/**
 * Season leader per scored category, by cumulative weekly category record
 * (weekly rates like ERA can't be summed across weeks, so leaders are by
 * record — uniform across categories). Tie-break: wins, then name.
 */
export function computeCategoryLeaders(
  season: SeasonMatchups,
  settings: LeagueSeasonSettings,
): CategoryLeader[] {
  const categories = scoredCategories(settings)
  const records = new Map<string, Map<StatKey, TeamScore>>() // teamKey → key → record
  const metas = new Map<string, TeamMeta>()

  for (const week of completedWeeks(season)) {
    for (const team of teamsOfWeek(season.weeks[String(week)] ?? [])) {
      metas.set(team.teamKey, teamMeta(team))
      const byKey = records.get(team.teamKey) ?? new Map<StatKey, TeamScore>()
      for (const category of categories) {
        const key = statKey(category.role, category.statId)
        const outcome = team.results[key]
        if (!outcome) continue
        const record = byKey.get(key) ?? { w: 0, l: 0, t: 0 }
        if (outcome === 'win') record.w++
        else if (outcome === 'loss') record.l++
        else record.t++
        byKey.set(key, record)
      }
      records.set(team.teamKey, byKey)
    }
  }

  const leaders: CategoryLeader[] = []
  for (const category of categories) {
    const key = statKey(category.role, category.statId)
    let leader: CategoryLeader | null = null
    for (const [teamKey, byKey] of records) {
      const record = byKey.get(key)
      if (!record || record.w + record.l + record.t === 0) continue
      const candidate: CategoryLeader = { category, team: metas.get(teamKey)!, record, rate: winPct(record) }
      if (!leader ||
          candidate.rate > leader.rate ||
          (candidate.rate === leader.rate && candidate.record.w > leader.record.w) ||
          (candidate.rate === leader.rate && candidate.record.w === leader.record.w &&
            candidate.team.name.localeCompare(leader.team.name) < 0)) {
        leader = candidate
      }
    }
    if (leader) leaders.push(leader)
  }
  return leaders
}
