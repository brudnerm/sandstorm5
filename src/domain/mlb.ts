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

/**
 * Savant percentile rankings, 0–100, always oriented so higher = better
 * (a batter with a low strikeout rate gets a HIGH kPct percentile).
 * Batter-only and pitcher-only fields are null for the other role.
 */
export interface PercentileSet {
  xwoba: number | null
  xba: number | null
  xslg: number | null
  /** Pitchers only. */
  xera: number | null
  exitVelocity: number | null
  maxEv: number | null
  barrelPct: number | null
  hardHitPct: number | null
  kPct: number | null
  bbPct: number | null
  whiffPct: number | null
  chasePct: number | null
  /** Batters only from here down (except fbVelocity). */
  sprintSpeed: number | null
  oaa: number | null
  armStrength: number | null
  batSpeed: number | null
  squaredUp: number | null
  /** Pitchers only. */
  fbVelocity: number | null
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
  /** Prior-season Statcast lines, for year-over-year trend display. */
  prevBatting: StatcastBatting | null
  prevPitching: StatcastPitching | null
  battingPct: PercentileSet | null
  pitchingPct: PercentileSet | null
}

/** data/mlb/players.json */
export interface MlbShard {
  season: string
  /** The season prevBatting/prevPitching cover. */
  prevSeason: string
  players: MlbPlayer[]
}

/** One scraped fantasy-news blurb, matched to players by normalized name. */
export interface NewsStory {
  source: 'CBS' | 'RotoWire'
  playerName: string
  /** Display position/team context as scraped, e.g. "C | DET". */
  context: string | null
  headline: string
  detail: string
  /** Display timestamp as scraped ("26M ago", "July 16, 2026"). */
  time: string
  url: string | null
}

/** data/mlb/news.json */
export interface NewsShard {
  fetchedAt: string
  stories: NewsStory[]
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
