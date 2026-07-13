/**
 * Category z-score valuation. A player's value in a stat window is the
 * mean of their z-scores across the league's scored categories for their
 * role, computed against the population of every rostered player plus the
 * free-agent watchlist. Direction always comes from league settings
 * (higherIsBetter), never from the abbreviation.
 *
 * Values are comparable across players and windows within a league:
 * 0 ≈ league-average, +1 ≈ a standard deviation above. Small-sample rate
 * flukes are tempered by clamping each z to ±3; raw stat lines are always
 * shown next to a value so the human can judge the playing time.
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

interface CategoryBaseline {
  key: StatKey
  higherIsBetter: boolean
  mean: number
  std: number
}

export type Baselines = Partial<Record<StatWindow, Record<Role, CategoryBaseline[]>>>

function roleOf(player: PlayerCard): Role {
  return player.positionType === 'P' ? 'pitching' : 'batting'
}

export function buildBaselines(
  population: PlayerCard[],
  settings: LeagueSeasonSettings,
  windows: StatWindow[],
): Baselines {
  const baselines: Baselines = {}
  for (const window of windows) {
    const perRole: Record<Role, CategoryBaseline[]> = { batting: [], pitching: [] }
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
      perRole[category.role].push({ key, higherIsBetter: category.higherIsBetter, mean, std })
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
): number | null {
  const perCategory = baselines[window]?.[roleOf(player)]
  const stats = player.windows[window]
  if (!perCategory || !stats) return null

  let sum = 0
  let count = 0
  for (const baseline of perCategory) {
    const v = Number.parseFloat(stats[baseline.key] ?? '')
    if (Number.isNaN(v)) continue
    let z = (v - baseline.mean) / baseline.std
    if (!baseline.higherIsBetter) z = -z
    sum += Math.max(-Z_CLAMP, Math.min(Z_CLAMP, z))
    count++
  }
  return count > 0 ? sum / count : null
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
