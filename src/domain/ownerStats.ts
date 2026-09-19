/**
 * All-time owner standings and the head-to-head matrix.
 *
 * Two rules run through everything here:
 *
 *   - **Regular season only, for the standings.** The league's own rule is
 *     that regular-season records come from regular-season standings, and the
 *     matrix's regular-season tab is required to sum to exactly the same
 *     totals. `reconcile()` is what proves it.
 *   - **Percentage counts a tie as half a win**, which is how Yahoo computes
 *     the column and the only way a 2020 season of 84 decisions compares with
 *     a full one of 252.
 */
import { BRACKET_BY_CODE, type MatchupShard, type SeasonsShard, type TrophySeason } from './trophy.js'

export interface AllTimeRow {
  ownerId: string
  seasonsPlayed: number
  firstSeason: number
  lastSeason: number
  active: boolean
  wins: number
  losses: number
  ties: number
  /** Ties count as half a win, as Yahoo computes it. */
  percentage: number
  playoffAppearances: number
  titles: number
  runnerUps: number
  lastPlaces: number
  /** Mean regular-season finishing position. Lower is better. */
  averageFinish: number
  /** Best regular-season finish, and the seasons it happened. */
  bestFinish: number
}

/**
 * Whether a season's regular season is complete, tested against the arithmetic
 * rather than against Yahoo's `is_finished` flag.
 *
 * The flag stays false until the playoffs end, but the regular season is over
 * well before that and its records are final. Reading the flag instead would
 * leave the current season out of the all-time standings while the matrix,
 * which works from matchups, counted it — which is exactly how the two came to
 * disagree. Testing the arithmetic also keeps a genuinely mid-flight season
 * out, where the flag alone would not.
 */
export function regularSeasonComplete(season: TrophySeason): boolean {
  const expected = season.categories.length * season.regularSeasonWeeks.length
  if (expected === 0 || season.standings.length === 0) return false
  return season.standings.every(r => r.wins + r.losses + r.ties === expected)
}

export const winPct = (w: number, l: number, t: number): number =>
  w + l + t === 0 ? 0 : (w + t / 2) / (w + l + t)

/** Format a percentage the way the rest of the league does: ".571". */
export const formatPct = (value: number): string =>
  value >= 1 ? '1.000' : value.toFixed(3).replace(/^0/, '')

export function allTimeStandings(shard: SeasonsShard): AllTimeRow[] {
  // Records come from every season whose regular season is over; honours are
  // only counted once the season itself has finished, so a title in progress
  // is never awarded early.
  const counted = shard.seasons.filter(regularSeasonComplete)
  const currentSeason = Math.max(...shard.seasons.map(s => s.season))
  const rows: AllTimeRow[] = []

  for (const owner of shard.owners) {
    let wins = 0, losses = 0, ties = 0
    let playoffAppearances = 0, titles = 0, runnerUps = 0, lastPlaces = 0
    const finishes: number[] = []
    const seasonsPlayed: number[] = []

    for (const season of counted) {
      const row = season.standings.find(r => r.ownerId === owner.id)
      if (!row) continue
      seasonsPlayed.push(season.season)
      wins += row.wins
      losses += row.losses
      ties += row.ties
      finishes.push(row.seed)
      if (season.numPlayoffTeams !== null && row.seed <= season.numPlayoffTeams) playoffAppearances++
      if (season.isFinished) {
        if (season.champion?.ownerId === owner.id) titles++
        if (season.runnerUp?.ownerId === owner.id) runnerUps++
        if (season.lastPlace?.ownerId === owner.id) lastPlaces++
      }
    }
    if (seasonsPlayed.length === 0) continue

    rows.push({
      ownerId: owner.id,
      seasonsPlayed: seasonsPlayed.length,
      firstSeason: Math.min(...seasonsPlayed),
      lastSeason: Math.max(...seasonsPlayed),
      active: !!owner.teamNames[String(currentSeason)],
      wins, losses, ties,
      percentage: winPct(wins, losses, ties),
      playoffAppearances, titles, runnerUps, lastPlaces,
      averageFinish: finishes.reduce((a, b) => a + b, 0) / finishes.length,
      bestFinish: Math.min(...finishes),
    })
  }

  return rows.sort((a, b) => b.percentage - a.percentage)
}

// ------------------------------------------------------------ head to head

export type BracketScope = 'regular' | 'playoffs'

export interface Meeting {
  season: number
  week: number
  bracket: string
  /** From the row owner's point of view. */
  wins: number
  losses: number
  ties: number
}

export interface HeadToHead {
  wins: number
  losses: number
  ties: number
  meetings: number
  percentage: number
  series: Meeting[]
}

export interface Matrix {
  ownerIds: string[]
  /** `get(a, b)` is a's record against b. */
  get: (a: string, b: string) => HeadToHead | null
  scope: BracketScope
}

/**
 * Playoffs here means every bracket game that is not consolation, so a
 * placement game counts as a meeting. It happened, and leaving it out would
 * make the matrix disagree with the matchup record.
 */
const inScope = (bracket: string, scope: BracketScope): boolean =>
  scope === 'regular' ? bracket === 'regular' : bracket === 'championship' || bracket === 'placement'

export function headToHead(
  shard: SeasonsShard,
  matchups: MatchupShard,
  scope: BracketScope,
): Matrix {
  // Same seasons as the standings, so the two can be reconciled.
  const countedSeasons = new Set(shard.seasons.filter(regularSeasonComplete).map(s => s.season))
  const c = matchups.columns
  const idx = {
    season: c.indexOf('season'), week: c.indexOf('week'),
    a: c.indexOf('ownerA'), b: c.indexOf('ownerB'),
    bracket: c.indexOf('bracket'), results: c.indexOf('results'),
  }
  const byPair = new Map<string, HeadToHead>()
  const key = (a: string, b: string) => `${a}|${b}`
  const bump = (a: string, b: string, w: number, l: number, t: number, meeting: Meeting) => {
    const cur = byPair.get(key(a, b)) ?? { wins: 0, losses: 0, ties: 0, meetings: 0, percentage: 0, series: [] }
    cur.wins += w; cur.losses += l; cur.ties += t
    cur.meetings++
    cur.series.push(meeting)
    byPair.set(key(a, b), cur)
  }

  for (const row of matchups.rows) {
    if (!countedSeasons.has(row[idx.season] as number)) continue
    const bracket = BRACKET_BY_CODE[row[idx.bracket] as number] ?? 'regular'
    if (!inScope(bracket, scope)) continue
    const aId = shard.owners[row[idx.a] as number]?.id
    const bId = shard.owners[row[idx.b] as number]?.id
    if (!aId || !bId) continue
    const results = String(row[idx.results])
    const w = [...results].filter(ch => ch === 'W').length
    const l = [...results].filter(ch => ch === 'L').length
    const t = [...results].filter(ch => ch === 'T').length
    const season = row[idx.season] as number
    const week = row[idx.week] as number
    bump(aId, bId, w, l, t, { season, week, bracket, wins: w, losses: l, ties: t })
    bump(bId, aId, l, w, t, { season, week, bracket, wins: l, losses: w, ties: t })
  }

  for (const cell of byPair.values()) {
    cell.percentage = winPct(cell.wins, cell.losses, cell.ties)
    cell.series.sort((x, y) => x.season - y.season || x.week - y.week)
  }

  return {
    ownerIds: shard.owners.map(o => o.id),
    scope,
    get: (a, b) => byPair.get(key(a, b)) ?? null,
  }
}

export interface Rivalry {
  a: string
  b: string
  record: HeadToHead
}

/**
 * The most one-sided pairing, among those that have met often enough for the
 * margin to mean anything. The minimum is stated on the page rather than
 * hidden, because a 12-0 from two meetings is not a rivalry.
 */
export function mostLopsided(
  matrix: Matrix,
  minimumMeetings: number,
): Rivalry | null {
  let best: Rivalry | null = null
  for (const a of matrix.ownerIds) {
    for (const b of matrix.ownerIds) {
      if (a >= b) continue
      const record = matrix.get(a, b)
      if (!record || record.meetings < minimumMeetings) continue
      const margin = Math.abs(record.percentage - 0.5)
      const bestMargin = best ? Math.abs(best.record.percentage - 0.5) : -1
      if (margin > bestMargin) {
        // Orient the pair so the dominant owner is named first.
        best = record.percentage >= 0.5
          ? { a, b, record }
          : { a: b, b: a, record: matrix.get(b, a)! }
      }
    }
  }
  return best
}

// ------------------------------------------------------------- reconcile

export interface ReconcileResult {
  ok: boolean
  rows: Array<{
    ownerId: string
    standings: { wins: number; losses: number; ties: number }
    matrix: { wins: number; losses: number; ties: number }
    ok: boolean
  }>
}

/**
 * Every owner's regular-season matrix totals must equal their all-time
 * standings row exactly. If they ever disagree, one of the two is wrong and
 * the page should not be published.
 */
export function reconcile(shard: SeasonsShard, matchups: MatchupShard): ReconcileResult {
  const standings = allTimeStandings(shard)
  const matrix = headToHead(shard, matchups, 'regular')
  const rows = standings.map(row => {
    let wins = 0, losses = 0, ties = 0
    for (const other of matrix.ownerIds) {
      if (other === row.ownerId) continue
      const cell = matrix.get(row.ownerId, other)
      if (!cell) continue
      wins += cell.wins; losses += cell.losses; ties += cell.ties
    }
    return {
      ownerId: row.ownerId,
      standings: { wins: row.wins, losses: row.losses, ties: row.ties },
      matrix: { wins, losses, ties },
      ok: wins === row.wins && losses === row.losses && ties === row.ties,
    }
  })
  return { ok: rows.every(r => r.ok), rows }
}
