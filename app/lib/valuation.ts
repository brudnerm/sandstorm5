/**
 * Category z-score valuation. A player's value in a stat window is the
 * mean of their z-scores across the league's scored categories for their
 * role, computed against the population of every rostered player plus the
 * free-agent watchlist. Direction always comes from league settings
 * (higherIsBetter), never from the abbreviation.
 *
 * Rate categories (AVG, ERA, ...) are shrunk toward league average by
 * playing time: a .647 AVG over 17 AB should not outrank a .320 over a
 * full month. Volume comes from the leagues' display-only stats (H/AB for
 * batters, IP for pitchers). Abbreviations are used ONLY to recognize
 * which categories are rates and where the volume lives — never to decide
 * scoring direction, which stays derived from Yahoo settings.
 *
 * Values are comparable across players and windows within a league:
 * 0 ≈ league-average, +1 ≈ a standard deviation above. Each z is clamped
 * to ±3; raw stat lines are always shown next to a value so the human can
 * judge the sample.
 */
import type { PlayerCard, StatWindow } from '../../src/domain/players'
import {
  scoredCategories,
  statKey,
  type LeagueSeasonSettings,
  type Role,
  type StatKey,
} from '../../src/domain/stats'

const Z_CLAMP = 3

/** Categories whose values are averages rather than accumulating counts. */
const RATE_ABBRS = new Set(['AVG', 'OBP', 'SLG', 'OPS', 'ERA', 'WHIP', 'K/9', 'BB/9', 'K/BB', 'BAA'])

interface CategoryBaseline {
  key: StatKey
  higherIsBetter: boolean
  isRate: boolean
  mean: number
  std: number
}

interface RoleBaseline {
  categories: CategoryBaseline[]
  /** Mean playing time (AB or IP) across players with any in this window. */
  meanVolume: number | null
}

export type Baselines = Partial<Record<StatWindow, Record<Role, RoleBaseline>>>

function roleOf(player: PlayerCard): Role {
  return player.positionType === 'P' ? 'pitching' : 'batting'
}

/** "58.1" innings means 58⅓ — Yahoo counts thirds in the decimal. */
function parseInnings(value: string): number | null {
  const match = /^(\d+)(?:\.([012]))?$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) + (match[2] ? Number(match[2]) / 3 : 0)
}

/**
 * Playing time in a window: AB for batters (from the H/AB display stat),
 * IP for pitchers. Null when the league or window doesn't carry it.
 */
export function playerVolume(
  player: PlayerCard,
  window: StatWindow,
  settings: LeagueSeasonSettings,
): number | null {
  const stats = player.windows[window]
  if (!stats) return null
  const role = roleOf(player)
  for (const category of settings.categories) {
    if (category.role !== role || !category.isDisplayOnly) continue
    const value = stats[statKey(category.role, category.statId)]
    if (value === undefined) continue
    if (role === 'batting' && category.abbr === 'H/AB') {
      const ab = Number(value.split('/')[1])
      return Number.isNaN(ab) ? null : ab
    }
    if (role === 'pitching' && category.abbr === 'IP') {
      return parseInnings(value)
    }
  }
  return null
}

export function buildBaselines(
  population: PlayerCard[],
  settings: LeagueSeasonSettings,
  windows: StatWindow[],
): Baselines {
  const baselines: Baselines = {}
  for (const window of windows) {
    const perRole = {} as Record<Role, RoleBaseline>
    for (const role of ['batting', 'pitching'] as Role[]) {
      const volumes: number[] = []
      for (const player of population) {
        if (roleOf(player) !== role) continue
        const v = playerVolume(player, window, settings)
        if (v !== null && v > 0) volumes.push(v)
      }
      perRole[role] = {
        categories: [],
        meanVolume: volumes.length > 0
          ? volumes.reduce((s, v) => s + v, 0) / volumes.length
          : null,
      }
    }
    for (const category of scoredCategories(settings)) {
      const key = statKey(category.role, category.statId)
      const values: number[] = []
      for (const player of population) {
        if (roleOf(player) !== category.role) continue
        const v = Number.parseFloat(player.windows[window]?.[key] ?? '')
        if (!Number.isNaN(v)) values.push(v)
      }
      if (values.length < 2) continue
      const mean = values.reduce((s, v) => s + v, 0) / values.length
      const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
      const std = Math.sqrt(variance)
      if (std === 0) continue
      perRole[category.role].categories.push({
        key,
        higherIsBetter: category.higherIsBetter,
        isRate: RATE_ABBRS.has(category.abbr),
        mean,
        std,
      })
    }
    baselines[window] = perRole
  }
  return baselines
}

/** Mean clamped z-score over the player's scored categories; null if no data. */
export function playerValue(
  player: PlayerCard,
  window: StatWindow,
  baselines: Baselines,
  settings: LeagueSeasonSettings,
): number | null {
  const roleBaseline = baselines[window]?.[roleOf(player)]
  const stats = player.windows[window]
  if (!roleBaseline || !stats) return null

  const volume = playerVolume(player, window, settings)
  const rateWeight = volume !== null && roleBaseline.meanVolume
    ? Math.min(1, volume / roleBaseline.meanVolume)
    : 1

  let sum = 0
  let count = 0
  for (const baseline of roleBaseline.categories) {
    const v = Number.parseFloat(stats[baseline.key] ?? '')
    if (Number.isNaN(v)) continue
    let z = (v - baseline.mean) / baseline.std
    if (!baseline.higherIsBetter) z = -z
    z = Math.max(-Z_CLAMP, Math.min(Z_CLAMP, z))
    if (baseline.isRate) z *= rateWeight
    sum += z
    count++
  }
  return count > 0 ? sum / count : null
}

/** Human label for a window's playing time: "26 AB" / "12.1 IP". */
export function volumeLabel(
  player: PlayerCard,
  window: StatWindow,
  settings: LeagueSeasonSettings,
): string | null {
  const stats = player.windows[window]
  if (!stats) return null
  const role = roleOf(player)
  for (const category of settings.categories) {
    if (category.role !== role || !category.isDisplayOnly) continue
    const value = stats[statKey(category.role, category.statId)]
    if (value === undefined) continue
    if (role === 'batting' && category.abbr === 'H/AB') {
      const ab = value.split('/')[1]
      return ab ? `${ab} AB` : null
    }
    if (role === 'pitching' && category.abbr === 'IP') return `${value} IP`
  }
  return null
}

/** Volume thresholds for treating a window as a meaningful sample. */
export function meaningfulSample(
  player: PlayerCard,
  window: StatWindow,
  settings: LeagueSeasonSettings,
  minAtBats: number,
  minInnings: number,
): boolean {
  const volume = playerVolume(player, window, settings)
  if (volume === null) return true // league doesn't expose volume — don't block
  return volume >= (roleOf(player) === 'pitching' ? minInnings : minAtBats)
}

/**
 * Real fielding positions two players could swap at — strips the slots
 * every batter (Util) or pitcher (P) shares so matches mean something.
 */
export function realPositions(player: PlayerCard): string[] {
  return player.eligiblePositions.filter(p => !['Util', 'P', 'BN', 'IL', 'IL+', 'NA'].includes(p))
}

export function positionsOverlap(a: PlayerCard, b: PlayerCard): boolean {
  if (a.positionType !== b.positionType) return false
  const bPositions = new Set(realPositions(b))
  return realPositions(a).some(p => bPositions.has(p))
}
