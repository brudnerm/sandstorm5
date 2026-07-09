/**
 * The core stat model. Every stat in Sandstorm5 is identified by Yahoo's
 * stat_id plus the role it applies to — never by display abbreviation.
 * Abbreviations are non-unique (batter-GIDP vs pitcher-GIDP, batter-K vs
 * pitcher-K) and can score in opposite directions per role.
 */

export type Role = 'batting' | 'pitching'

/** Canonical key for a stat within a league, e.g. "pitching:33". */
export type StatKey = `${Role}:${number}`

export function statKey(role: Role, statId: number): StatKey {
  return `${role}:${statId}`
}

export interface StatCategory {
  statId: number
  role: Role
  /** Display abbreviation (non-unique across roles), e.g. "GIDP". */
  abbr: string
  /** Full display name, e.g. "Ground Into Double Play". */
  name: string
  /** Derived from Yahoo sort_order: false for ERA/WHIP/batter-GIDP etc. */
  higherIsBetter: boolean
  /** Yahoo is_only_display_stat — shown but never scored (H/AB, IP). */
  isDisplayOnly: boolean
}

export interface LeagueSeasonSettings {
  leagueKey: string
  /** Stable Sandstorm league slug from the registry ('kp', 'sidebar'). */
  leagueId: string
  season: string
  name: string
  numTeams: number
  scoringType: string
  draftType: 'snake' | 'auction'
  currentWeek: number | null
  startWeek: number | null
  endWeek: number | null
  categories: StatCategory[]
}

/** A single stat value, always carried with its canonical key. */
export interface StatValue {
  key: StatKey
  value: string
}

export type StatOutcome = 'win' | 'loss' | 'tie'

const EPSILON = 0.0001

export function findCategory(
  settings: LeagueSeasonSettings,
  key: StatKey,
): StatCategory | undefined {
  return settings.categories.find(c => statKey(c.role, c.statId) === key)
}

/** Categories that actually score matchups (excludes display-only). */
export function scoredCategories(settings: LeagueSeasonSettings): StatCategory[] {
  return settings.categories.filter(c => !c.isDisplayOnly)
}

/**
 * Compare a stat value from A's perspective, respecting the category's
 * per-(stat_id, role) direction. Non-numeric values tie.
 */
export function compareStat(
  category: StatCategory,
  valA: string,
  valB: string,
): StatOutcome {
  if (category.isDisplayOnly) return 'tie'
  const a = parseFloat(valA)
  const b = parseFloat(valB)
  if (Number.isNaN(a) || Number.isNaN(b)) return 'tie'
  if (Math.abs(a - b) < EPSILON) return 'tie'
  if (a > b) return category.higherIsBetter ? 'win' : 'loss'
  return category.higherIsBetter ? 'loss' : 'win'
}
