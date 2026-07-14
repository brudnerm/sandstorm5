/**
 * League-agnostic MLB reference data: the Yahoo→MLBAM identity bridge plus
 * Statcast-era quality-of-contact and expected stats from Baseball Savant.
 * One shard serves both leagues; the client matches Yahoo players by
 * normalized name (+ team abbreviation when names collide).
 */

export interface StatcastBatting {
  pa: number | null
  ba: number | null
  xba: number | null
  slg: number | null
  xslg: number | null
  woba: number | null
  xwoba: number | null
  /** Average exit velocity (mph). */
  ev: number | null
  /** Max exit velocity (mph). */
  maxEv: number | null
  /** Hard-hit rate: % of batted balls ≥95 mph. */
  hardHitPct: number | null
  /** Barrels per batted-ball event, %. */
  barrelPct: number | null
  /** Sweet-spot rate (8–32° launch), %. */
  sweetSpotPct: number | null
}

export interface StatcastPitching {
  pa: number | null
  ba: number | null
  xba: number | null
  woba: number | null
  xwoba: number | null
  era: number | null
  xera: number | null
  /** Contact quality allowed. */
  ev: number | null
  hardHitPct: number | null
  barrelPct: number | null
}

export interface MlbPlayer {
  /** MLBAM person id — the key into statsapi.mlb.com and Savant. */
  mlbamId: number
  name: string
  /** Team abbreviation in Yahoo's style (AZ, CWS, WSH, ...). */
  team: string
  position: string
  bats: string | null
  throws: string | null
  batting: StatcastBatting | null
  pitching: StatcastPitching | null
}

/** data/mlb/players.json */
export interface MlbShard {
  season: string
  players: MlbPlayer[]
}

/**
 * Normalize a player name for Yahoo↔MLBAM matching: lowercase, strip
 * diacritics and punctuation, drop generational suffixes and Yahoo's
 * two-way parentheticals ("Shohei Ohtani (Batter)").
 */
export function normalizeName(name: string): string {
  return name
    .replace(/\(.*?\)/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
