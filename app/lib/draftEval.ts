/**
 * Draft evaluation: what each pick actually returned this season, what a pick
 * in that slot typically returned, and the difference.
 *
 * The chain is:
 *
 *   value     sum of z-scores across the league's scored categories, measured
 *             against the pool of every drafted player in the same role.
 *             Hitters and pitchers never share a pool — six categories each.
 *   VAR       value minus replacement level, where replacement is the 15th
 *             percentile of that role's pool. Puts both pools on one scale:
 *             zero means "no better than the last useful drafted player".
 *   expected  a monotone non-increasing fit of VAR against overall pick
 *             number — what a pick in that slot returned this year, league
 *             wide. Fitted on real picks only.
 *   surplus   VAR minus expected. The actual grade: did this slot beat what
 *             the slot was worth?
 *
 * Two deliberate choices worth knowing:
 *
 * Keepers are in the POOL but not in the CURVE. They are drafted players, so
 * they belong in the distribution that defines an average drafted player and
 * replacement level. They are not real picks — KP hands every team five at no
 * cost in the late rounds — so including them would drag the tail of the
 * expected curve up and flatter every genuine late pick. They are reported
 * separately and excluded from team totals.
 *
 * A pick with no season line scores as a zero, not as missing. A first-round
 * pick who never reached the majors cost his drafter a first-round pick; that
 * is the outcome, and dropping him would quietly reward the miss.
 *
 * Pure functions over domain types (no React/DOM), like leagueTrends.ts.
 */
import type { DraftBatting, DraftPick, DraftPitching, DraftShard } from '../../src/domain/draft'

export type DraftRole = 'batting' | 'pitching'

/** One scored category: how to read it, and which way is good. */
interface CategorySpec {
  abbr: string
  read: (line: DraftBatting & DraftPitching) => number
  /** Rate stats are weighted by volume; counting stats are not. */
  isRate: boolean
  higherIsBetter: boolean
}

/**
 * The league's 12 scoring categories, six per role. AB and IP are not scored
 * — they are the volume that weights the rate categories.
 */
const CATEGORIES: Record<DraftRole, CategorySpec[]> = {
  batting: [
    { abbr: 'R', read: l => l.r, isRate: false, higherIsBetter: true },
    { abbr: 'HR', read: l => l.hr, isRate: false, higherIsBetter: true },
    { abbr: 'RBI', read: l => l.rbi, isRate: false, higherIsBetter: true },
    { abbr: 'SB', read: l => l.sb, isRate: false, higherIsBetter: true },
    { abbr: 'AVG', read: l => l.avg, isRate: true, higherIsBetter: true },
    { abbr: 'OBP', read: l => l.obp, isRate: true, higherIsBetter: true },
  ],
  pitching: [
    { abbr: 'W', read: l => l.w, isRate: false, higherIsBetter: true },
    { abbr: 'L', read: l => l.l, isRate: false, higherIsBetter: false },
    { abbr: 'SV', read: l => l.sv, isRate: false, higherIsBetter: true },
    { abbr: 'K', read: l => l.k, isRate: false, higherIsBetter: true },
    { abbr: 'ERA', read: l => l.era, isRate: true, higherIsBetter: false },
    { abbr: 'WHIP', read: l => l.whip, isRate: true, higherIsBetter: false },
  ],
}

const ZERO_LINE: DraftBatting & DraftPitching = {
  ab: 0, r: 0, hr: 0, rbi: 0, sb: 0, avg: 0, obp: 0,
  ip: 0, w: 0, l: 0, sv: 0, k: 0, era: 0, whip: 0,
}

/** Replacement level: the 15th percentile of a role's pool. */
const REPLACEMENT_PERCENTILE = 15

/** Round buckets the team table reports surplus over. */
export const ROUND_BUCKETS = [
  { label: '1-5', min: 1, max: 5 },
  { label: '6-10', min: 6, max: 10 },
  { label: '11+', min: 11, max: Infinity },
] as const

// ── Small statistics helpers (exported for testing) ───────────────────

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Population standard deviation. */
export function stdev(values: number[]): number {
  if (values.length === 0) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map(v => (v - m) ** 2)))
}

/**
 * Linear-interpolated percentile (`p` in 0-100) of an unsorted sample.
 * Matches the common "R type 7" definition, so the 0th and 100th
 * percentiles are exactly the min and max.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]!
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (rank - lo) * (sorted[hi]! - sorted[lo]!)
}

/**
 * Pool-adjacent-violators isotonic regression, constrained NON-INCREASING.
 *
 * Points must already be ordered by x. Walks left to right pushing each y as
 * its own block, then merges any block whose mean rose above its predecessor
 * — the one thing a non-increasing fit forbids — until the sequence is
 * monotone again. The result is the least-squares best non-increasing fit,
 * and it reproduces the input exactly when the input already descends.
 */
export function isotonicNonIncreasing(ys: number[]): number[] {
  const blocks: Array<{ sum: number; count: number }> = []
  for (const y of ys) {
    blocks.push({ sum: y, count: 1 })
    while (blocks.length >= 2) {
      const last = blocks[blocks.length - 1]!
      const prev = blocks[blocks.length - 2]!
      if (prev.sum / prev.count >= last.sum / last.count) break
      blocks.splice(blocks.length - 2, 2, {
        sum: prev.sum + last.sum,
        count: prev.count + last.count,
      })
    }
  }
  const fitted: number[] = []
  for (const block of blocks) {
    const value = block.sum / block.count
    for (let i = 0; i < block.count; i++) fitted.push(value)
  }
  return fitted
}

// ── Valuation ─────────────────────────────────────────────────────────

/**
 * How one category is standardised within a role.
 *
 * Counting stats are plain z-scores. Rate stats are NOT: standardising a raw
 * rate lets a tiny sample destroy the category. In 2026 one pitcher threw a
 * third of an inning and gave up six runs — a 162.00 ERA — which by itself
 * pushed the pool's ERA standard deviation to 15.29 against an innings-
 * weighted 1.44. Dividing every real pitcher's ERA by a number ten times too
 * large flattened ERA and WHIP to almost nothing, so two of the six pitching
 * categories silently stopped counting. Batting averages are bounded and
 * never blow up like that, so the damage was one-sided.
 *
 * Instead a rate is scored by its IMPACT: how far it moves the pool's own
 * aggregate rate, scaled by how much of it the player actually threw or
 * batted. That is the quantity a manager feels, it is immune to a
 * third-of-an-inning disaster (which carries a third of an inning of weight),
 * and standardising it puts all twelve categories on one footing.
 */
type Moment =
  | { kind: 'counting'; mean: number; sd: number }
  /** `weightedMean` is the pool's aggregate rate; `impactSd` scales impact. */
  | { kind: 'rate'; weightedMean: number; impactSd: number }

/** Per-category standardisation for one role, plus the volume scale. */
interface Pool {
  role: DraftRole
  /** One per category, in CATEGORIES order. */
  moments: Moment[]
  /** Mean AB (hitters) or IP (pitchers) among players who actually played. */
  meanVolume: number
  /** Raw sum-of-z value for every member. */
  values: number[]
  /**
   * Centre and scale that put this pool's values on a common footing with the
   * other pool's — see standardize().
   */
  centre: number
  scale: number
  /** Replacement level, in standardised units. */
  replacement: number
}

/**
 * Express a raw value as standard deviations above an average drafted player
 * of the same role, so hitters and pitchers can be compared at all.
 *
 * Summed z-scores are NOT comparable across roles as they stand, because the
 * two roles' categories correlate differently. A good hitter tends to be good
 * at everything — runs, homers and RBI move together — so his six z-scores
 * add up. Pitchers are split between starters and relievers whose profiles
 * partly cancel: saves run against wins and strikeouts. The pitching pool
 * therefore comes out narrower (sd 3.4 against 4.1 in 2026) even when every
 * category is measured correctly.
 *
 * Left alone, that difference is a thumb on the scale: replacement sits about
 * one standard deviation below the mean in each pool, so an average hitter
 * would bank more value over replacement than an average pitcher for no
 * reason but the shape of his pool, and a team would gain VAR simply by
 * drafting bats. Dividing by each pool's own spread removes that, and leaves
 * the honest question: how exceptional was this player among the drafted
 * players he was actually competing with?
 */
function standardize(pool: Pool, value: number): number {
  return (value - pool.centre) / pool.scale
}

function lineOf(pick: DraftPick): DraftBatting & DraftPitching {
  return {
    ...ZERO_LINE,
    ...(pick.batting ?? {}),
    ...(pick.pitching ?? {}),
  }
}

function volumeOf(role: DraftRole, line: DraftBatting & DraftPitching): number {
  return role === 'batting' ? line.ab : line.ip
}

function buildPool(role: DraftRole, picks: DraftPick[]): Pool {
  const members = picks.filter(p => p.role === role)
  const lines = members.map(lineOf)
  const volumes = lines.map(l => volumeOf(role, l))
  // "Average" volume means average among players who played. Including the
  // season-long absences would drag it down and inflate every rate weight.
  const played = volumes.filter(v => v > 0)
  const meanVolume = played.length > 0 ? mean(played) : 1

  const specs = CATEGORIES[role]
  const moments: Moment[] = specs.map(spec => {
    if (!spec.isRate) {
      // A zero is a real result for a counting stat, so everyone counts:
      // a player who missed the season really did hit no home runs.
      return { kind: 'counting', mean: mean(lines.map(spec.read)), sd: stdev(lines.map(spec.read)) }
    }
    // The pool's aggregate rate — total hits over total at-bats, in effect —
    // which is the baseline a player either lifts or drags.
    const totalVolume = volumes.reduce((a, b) => a + b, 0)
    const weightedMean = totalVolume === 0
      ? 0
      : lines.reduce((sum, line, i) => sum + spec.read(line) * volumes[i]!, 0) / totalVolume
    const impacts = lines.map((line, i) => rateImpact(spec, line, volumes[i]!, weightedMean, meanVolume))
    return { kind: 'rate', weightedMean, impactSd: stdev(impacts) }
  })

  const pool: Pool = {
    role, moments, meanVolume, values: [], centre: 0, scale: 1, replacement: 0,
  }
  pool.values = members.map((_, i) => valueOf(pool, lines[i]!, volumes[i]!))
  pool.centre = mean(pool.values)
  // A pool with one member (or identical members) has no spread to divide by.
  pool.scale = stdev(pool.values) || 1
  pool.replacement = percentile(
    pool.values.map(value => standardize(pool, value)),
    REPLACEMENT_PERCENTILE,
  )
  return pool
}

/**
 * How far this player moves the pool's aggregate rate, in whole-player units.
 * A .320 average over 600 at-bats shifts it far more than the same average
 * over 40, and a player who never batted shifts it not at all.
 */
function rateImpact(
  spec: CategorySpec,
  line: DraftBatting & DraftPitching,
  volume: number,
  weightedMean: number,
  meanVolume: number,
): number {
  if (volume <= 0 || meanVolume <= 0) return 0
  const delta = (spec.read(line) - weightedMean) * (volume / meanVolume)
  return spec.higherIsBetter ? delta : -delta
}

/** Sum of z-scores for one line against its pool, over that role's six categories. */
function valueOf(pool: Pool, line: DraftBatting & DraftPitching, volume: number): number {
  const specs = CATEGORIES[pool.role]
  let total = 0
  specs.forEach((spec, i) => {
    const moment = pool.moments[i]!
    if (moment.kind === 'counting') {
      if (moment.sd === 0) return
      const z = (spec.read(line) - moment.mean) / moment.sd
      total += spec.higherIsBetter ? z : -z
      return
    }
    if (moment.impactSd === 0) return
    const impact = rateImpact(spec, line, volume, moment.weightedMean, pool.meanVolume)
    total += impact / moment.impactSd
  })
  return total
}

// ── Public shapes ─────────────────────────────────────────────────────

export interface PickValue {
  pick: DraftPick
  /** Raw sum of z-scores over the role's six categories, before standardising. */
  value: number
  /**
   * Value over replacement, in standard deviations of the player's own pool.
   * Comparable between hitters and pitchers; `value` is not.
   */
  var: number
  /** What this slot returned league wide. null for keepers. */
  expected: number | null
  /** VAR minus expected. null for keepers. */
  surplus: number | null
}

export type Grade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F'

export interface TeamDraft {
  teamKey: string
  totalVar: number
  totalExpected: number
  surplus: number
  /** Surplus within each ROUND_BUCKETS range, same order. */
  byBucket: number[]
  best: PickValue | null
  worst: PickValue | null
  /** Real picks only — teams trade picks, so this varies. */
  picksUsed: number
  grade: Grade
  picks: PickValue[]
  keepers: PickValue[]
}

export interface DraftEvaluation {
  teams: TeamDraft[]
  /** Real picks, best surplus first. */
  bestPicks: PickValue[]
  worstPicks: PickValue[]
  /** Mean fitted expected VAR per round, for the by-round chart. */
  byRound: Array<{ round: number; expected: number }>
  /** Replacement level per pool, in standardised units. */
  replacement: Record<DraftRole, number>
  /** Raw value spread per pool — the gap standardize() exists to close. */
  poolScale: Record<DraftRole, number>
}

/**
 * Grade on a curve: the z-score of a team's surplus against the twelve
 * teams. Thresholds rather than one-grade-per-rank, so a cluster of teams
 * that drafted about as well as each other shares a grade instead of being
 * split by hundredths.
 */
export function gradeFromZ(z: number): Grade {
  if (z >= 1.5) return 'A+'
  if (z >= 1.0) return 'A'
  if (z >= 0.6) return 'A-'
  if (z >= 0.3) return 'B+'
  if (z >= 0.1) return 'B'
  if (z >= -0.1) return 'B-'
  if (z >= -0.3) return 'C+'
  if (z >= -0.6) return 'C'
  if (z >= -1.0) return 'C-'
  if (z >= -1.5) return 'D'
  return 'F'
}

/** A pick's season line as one display string. */
export function seasonLine(pick: DraftPick): string {
  if (pick.role === 'pitching') {
    const p = pick.pitching
    if (!p) return 'did not pitch'
    return `${p.ip.toFixed(1)} IP · ${p.w}-${p.l} · ${p.sv} SV · ${p.k} K · ` +
      `${p.era.toFixed(2)} ERA · ${p.whip.toFixed(2)} WHIP`
  }
  const b = pick.batting
  if (!b) return 'did not play'
  return `${b.ab} AB · ${b.r} R · ${b.hr} HR · ${b.rbi} RBI · ${b.sb} SB · ` +
    `${b.avg.toFixed(3).replace(/^0/, '')} AVG · ${b.obp.toFixed(3).replace(/^0/, '')} OBP`
}

// ── Entry point ───────────────────────────────────────────────────────

export function evaluateDraft(shard: DraftShard): DraftEvaluation {
  const picks = shard.picks
  const pools: Record<DraftRole, Pool> = {
    batting: buildPool('batting', picks),
    pitching: buildPool('pitching', picks),
  }

  // ── value and VAR for every pick, keepers included ──────────────────
  const valued = new Map<DraftPick, PickValue>()
  for (const pick of picks) {
    const pool = pools[pick.role]
    const line = lineOf(pick)
    const value = valueOf(pool, line, volumeOf(pick.role, line))
    valued.set(pick, {
      pick,
      value,
      var: standardize(pool, value) - pool.replacement,
      expected: null,
      surplus: null,
    })
  }

  // ── expected curve over real picks only ─────────────────────────────
  const real = picks
    .filter(p => !p.keeper)
    .sort((a, b) => a.overall - b.overall)
  const fitted = isotonicNonIncreasing(real.map(p => valued.get(p)!.var))
  real.forEach((pick, i) => {
    const entry = valued.get(pick)!
    entry.expected = fitted[i]!
    entry.surplus = entry.var - entry.expected
  })

  // ── per team ────────────────────────────────────────────────────────
  const byTeam = new Map<string, PickValue[]>()
  for (const pick of picks) {
    const list = byTeam.get(pick.teamKey) ?? []
    list.push(valued.get(pick)!)
    byTeam.set(pick.teamKey, list)
  }

  const bySurplus = (a: PickValue, b: PickValue) => (b.surplus ?? 0) - (a.surplus ?? 0)
  const byPick = (a: PickValue, b: PickValue) => a.pick.overall - b.pick.overall

  const drafts = [...byTeam.entries()].map(([teamKey, entries]) => {
    const teamPicks = entries.filter(e => !e.pick.keeper).sort(byPick)
    const keepers = entries.filter(e => e.pick.keeper).sort(byPick)
    const totalVar = teamPicks.reduce((sum, e) => sum + e.var, 0)
    const totalExpected = teamPicks.reduce((sum, e) => sum + (e.expected ?? 0), 0)
    const ranked = [...teamPicks].sort(bySurplus)
    return {
      teamKey,
      totalVar,
      totalExpected,
      surplus: totalVar - totalExpected,
      byBucket: ROUND_BUCKETS.map(bucket =>
        teamPicks
          .filter(e => e.pick.round >= bucket.min && e.pick.round <= bucket.max)
          .reduce((sum, e) => sum + (e.surplus ?? 0), 0)),
      best: ranked[0] ?? null,
      worst: ranked[ranked.length - 1] ?? null,
      picksUsed: teamPicks.length,
      grade: 'B-' as Grade, // replaced below, once the league spread is known
      picks: teamPicks,
      keepers,
    }
  })

  // Grades need every team's surplus first, so they are a second pass.
  const surpluses = drafts.map(d => d.surplus)
  const m = mean(surpluses)
  const sd = stdev(surpluses)
  for (const draft of drafts) {
    draft.grade = gradeFromZ(sd === 0 ? 0 : (draft.surplus - m) / sd)
  }
  drafts.sort((a, b) => b.surplus - a.surplus)

  const realValued = real.map(p => valued.get(p)!)
  const rankedAll = [...realValued].sort(bySurplus)

  const rounds = [...new Set(real.map(p => p.round))].sort((a, b) => a - b)
  const byRound = rounds.map(round => ({
    round,
    expected: mean(
      realValued.filter(e => e.pick.round === round).map(e => e.expected ?? 0),
    ),
  }))

  return {
    teams: drafts,
    bestPicks: rankedAll.slice(0, 10),
    worstPicks: rankedAll.slice(-10).reverse(),
    byRound,
    replacement: {
      batting: pools.batting.replacement,
      pitching: pools.pitching.replacement,
    },
    poolScale: {
      batting: pools.batting.scale,
      pitching: pools.pitching.scale,
    },
  }
}
