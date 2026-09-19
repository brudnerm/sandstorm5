/**
 * Weekly records: the best and worst single team-weeks in each category.
 *
 * Three things here are policy rather than arithmetic, and all three are
 * stated on the page rather than buried:
 *
 *   - **Qualifiers.** A rate computed over a handful of innings or at-bats is
 *     not a record, it is a small sample. See QUALIFIERS for the thresholds
 *     and docs/trophy-room/stage4-qualifiers.md for the evidence behind them.
 *   - **Which weeks count.** Regular-season, championship and placement weeks
 *     all count. Consolation weeks are excluded entirely.
 *   - **Ties.** Several categories have hundreds of team-weeks tied on zero,
 *     so a "top five" is a slice of a much larger tie. Tied rows share a rank,
 *     are ordered oldest first so the list is stable, and the table says how
 *     many share the value at the cut.
 */

export type Mode = 'standard' | 'all' | 'perDay'

/** A team-week as the record tables need it, decoded from the weekly shard. */
export interface TeamWeek {
  season: number
  week: number
  ownerIndex: number
  days: number
  bracket: string
  values: Record<string, number | null>
  ab: number | null
  ip: number | null
  completedGames: number | null
}

export interface Qualifier {
  minIp?: number
  minAb?: number
  /**
   * What to do when the denominator is not recorded at all.
   *
   * Yahoo carries no at-bat count before 2023, and dropping fourteen seasons
   * of batting records over a missing column would lose far more than it
   * protects. In every season the count does exist, a completed week clears
   * the bar with room to spare: of 980 standard team-weeks only one full week
   * falls short, and it batted .216. The pre-2023 leaders are all normal
   * weeks of 86 to 102 completed games, so nothing at the top of those boards
   * rests on a thin sample.
   *
   * So a missing denominator is assumed to have met the minimum. A team-week
   * that completed no games never is, which covers the one occasion in league
   * history anyone reached the end of a week without fielding a side.
   */
  assumeWhenMissing?: boolean
}

/**
 * Minimum playing time for the rate categories.
 *
 * 25 innings is the lowest bar at which the ERA and WHIP boards stop
 * changing: raising it to 30 or 35 alters nothing, while 40 starts evicting
 * genuine records. Below it sit 0.00 ERAs over nine and seventeen innings.
 * It keeps 97.7% of team-weeks.
 *
 * 150 at-bats removes the only sub-qualified outlier, a partial week that
 * topped OBP on 85 at-bats, and leaves the AVG board untouched. It keeps
 * 98.4% of the team-weeks that have an at-bat count at all, and is assumed
 * met for the seasons that record no at-bat count — see assumeWhenMissing.
 */
export const QUALIFIERS: Record<string, Qualifier> = {
  ERA: { minIp: 25 },
  WHIP: { minIp: 25 },
  AVG: { minAb: 150, assumeWhenMissing: true },
  OBP: { minAb: 150, assumeWhenMissing: true },
}

/** Categories that are already a rate, so dividing them by days is nonsense. */
export const RATE_CATEGORIES = new Set(['AVG', 'OBP', 'SLG', 'ERA', 'WHIP'])

export const isRate = (abbr: string) => RATE_CATEGORIES.has(abbr)

/** Consolation games never count toward a record. */
export const countsTowardRecords = (bracket: string) => bracket !== 'consolation'

export interface RecordRow {
  /** Competition rank: tied rows share a rank and the next rank skips. */
  rank: number
  teamWeek: TeamWeek
  /** The value as ranked, already divided by days in per-day mode. */
  value: number
  tiedWith: number
}

export interface Leaderboard {
  rows: RecordRow[]
  /** How many team-weeks were eligible after filtering. */
  pool: number
  /** How many share the value at the cut, when the cut falls inside a tie. */
  tiedAtCut: number
  /** Seasons the pool actually spans, for a span label. */
  seasons: number[]
  /** Seasons whose qualifier was assumed because the count is not recorded. */
  assumed: number[]
}

function qualifies(tw: TeamWeek, abbr: string): boolean {
  const q = QUALIFIERS[abbr]
  if (!q) return true
  // A week in which nobody was started has no denominator in any sense, so it
  // never qualifies for a rate however the numbers were recorded.
  if (tw.completedGames === 0) return false

  if (q.minIp !== undefined) {
    if (tw.ip === null) { if (!q.assumeWhenMissing) return false }
    else if (tw.ip < q.minIp) return false
  }
  if (q.minAb !== undefined) {
    if (tw.ab === null) { if (!q.assumeWhenMissing) return false }
    else if (tw.ab < q.minAb) return false
  }
  return true
}

/** True when this team-week is taken on trust because the count is missing. */
export function qualifierAssumed(tw: TeamWeek, abbr: string): boolean {
  const q = QUALIFIERS[abbr]
  if (!q?.assumeWhenMissing) return false
  if (q.minIp !== undefined && tw.ip === null) return true
  if (q.minAb !== undefined && tw.ab === null) return true
  return false
}

/**
 * Eligible team-weeks for a category in a mode, before ranking.
 *
 * Per-day mode drops the rate categories entirely rather than dividing them,
 * and drops any week with no day count to divide by.
 */
export function eligible(weeks: TeamWeek[], abbr: string, mode: Mode): TeamWeek[] {
  return weeks.filter(tw => {
    if (!countsTowardRecords(tw.bracket)) return false
    if (tw.values[abbr] === null || tw.values[abbr] === undefined) return false
    if (!qualifies(tw, abbr)) return false
    if (mode === 'standard' && tw.days !== 7) return false
    if (mode === 'perDay' && (isRate(abbr) || !tw.days)) return false
    return true
  })
}

export const valueFor = (tw: TeamWeek, abbr: string, mode: Mode): number => {
  const raw = tw.values[abbr]!
  return mode === 'perDay' && !isRate(abbr) ? raw / tw.days : raw
}

/**
 * Rank the eligible team-weeks, best or worst first.
 *
 * `higherIsBetter` comes from the category definition, so ERA and WHIP sort
 * the other way round and their "worst" list is the highest values.
 */
export function leaderboard(
  weeks: TeamWeek[],
  abbr: string,
  mode: Mode,
  higherIsBetter: boolean,
  end: 'best' | 'worst',
  limit: number,
): Leaderboard {
  const pool = eligible(weeks, abbr, mode)
  const wantHigh = end === 'best' ? higherIsBetter : !higherIsBetter

  const scored = pool
    .map(tw => ({ tw, value: valueFor(tw, abbr, mode) }))
    // Ties are ordered oldest first so the same five come back every time.
    .sort((a, b) =>
      a.value !== b.value
        ? (wantHigh ? b.value - a.value : a.value - b.value)
        : a.tw.season - b.tw.season || a.tw.week - b.tw.week || a.tw.ownerIndex - b.tw.ownerIndex,
    )

  const counts = new Map<number, number>()
  for (const s of scored) counts.set(s.value, (counts.get(s.value) ?? 0) + 1)

  const rows: RecordRow[] = []
  let rank = 0
  let seen = 0
  let lastValue: number | null = null
  for (const s of scored.slice(0, limit)) {
    seen++
    if (lastValue === null || s.value !== lastValue) {
      rank = seen
      lastValue = s.value
    }
    rows.push({ rank, teamWeek: s.tw, value: s.value, tiedWith: counts.get(s.value)! - 1 })
  }

  const cutValue = rows[rows.length - 1]?.value
  const tiedAtCut = cutValue === undefined ? 0 : (counts.get(cutValue) ?? 0)
  return {
    rows,
    pool: pool.length,
    tiedAtCut: tiedAtCut > rows.filter(r => r.value === cutValue).length ? tiedAtCut : 0,
    seasons: [...new Set(pool.map(tw => tw.season))].sort((a, b) => a - b),
    assumed: assumedSeasons(pool, abbr),
  }
}

/** "minimum 25 IP" style label for a category, or null when it has none. */
export function qualifierLabel(abbr: string): string | null {
  const q = QUALIFIERS[abbr]
  if (!q) return null
  if (q.minIp !== undefined) return `Minimum ${q.minIp} innings pitched`
  if (q.minAb !== undefined) return `Minimum ${q.minAb} at-bats`
  return null
}

/** Seasons in a pool whose qualifier was assumed rather than measured. */
export function assumedSeasons(weeks: TeamWeek[], abbr: string): number[] {
  return [...new Set(weeks.filter(tw => qualifierAssumed(tw, abbr)).map(tw => tw.season))]
    .sort((a, b) => a - b)
}
