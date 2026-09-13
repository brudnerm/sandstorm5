/**
 * Draft results joined to full-season MLB production — the raw material for
 * the Draft view's "what did each pick actually return?" evaluation.
 *
 * Picks are keyed by Yahoo team_key, never by team name: names change
 * mid-season (seven of KP's twelve changed during 2026), so the client
 * joins to the current name from live.json.
 *
 * Season lines carry only the league's 12 scoring categories plus the two
 * volume stats needed to weight the rate categories (AB for AVG/OBP, IP for
 * ERA/WHIP). Everything is the season TOTAL — for a traded player that is
 * MLB's aggregate split, not the sum of his stops.
 */

/** Batting line: the six scored batting categories plus AB for weighting. */
export interface DraftBatting {
  ab: number
  r: number
  hr: number
  rbi: number
  sb: number
  avg: number
  obp: number
}

/** Pitching line: the six scored pitching categories plus IP for weighting. */
export interface DraftPitching {
  /** Innings as a true decimal (85.2 in Yahoo/MLB thirds notation → 85.667). */
  ip: number
  w: number
  l: number
  sv: number
  k: number
  era: number
  whip: number
}

export interface DraftPick {
  /** Yahoo draft round. Keepers are slotted into the late rounds. */
  round: number
  /** Overall pick number, 1-based across the whole draft. */
  overall: number
  teamKey: string
  playerKey: string
  name: string
  /** Yahoo display_position, e.g. "3B,SS" or "SP". */
  position: string
  /**
   * Which pool this pick is valued in, straight from Yahoo's position_type.
   * Stored rather than re-derived on the client so a pitcher's plate
   * appearances can never leak into the hitter pool, and so a player who
   * missed the whole season still lands in the right pool as a zero.
   */
  role: 'batting' | 'pitching'
  mlbTeam: string
  /**
   * True when Yahoo annotated the pick `type: 'keeper'`. KP requires five
   * keepers per team at no cost, so these are not real picks and are both
   * graded separately and excluded from the expected-value curve.
   */
  keeper: boolean
  /**
   * MLBAM id, or null when the name could not be resolved — which in practice
   * means the player never appeared in an MLB game that season (a prospect
   * who hasn't debuted, or someone who missed the year injured). Either way
   * the pick returned nothing, so the evaluation scores it as a zero rather
   * than dropping it.
   */
  mlbamId: number | null
  batting: DraftBatting | null
  pitching: DraftPitching | null
}

/** data/{leagueId}/draft/{season}.json */
export interface DraftShard {
  leagueId: string
  leagueKey: string
  season: string
  picks: DraftPick[]
  /**
   * Resolved Yahoo name → MLBAM id, cached so a later run (or a debugging
   * session) can see exactly how each name was matched.
   */
  mlbamByName: Record<string, number>
  /** Yahoo names that never resolved to an MLBAM id. Surfaced, not hidden. */
  unmatched: string[]
}

/**
 * MLB (and Yahoo) report innings in thirds notation: "85.2" means 85 and two
 * thirds, not 85.2. Reading it as a decimal quietly understates every
 * workload, which then mis-weights the ERA and WHIP contributions.
 */
export function parseInnings(value: unknown): number {
  const text = String(value ?? '').trim()
  if (text === '') return 0
  const [whole, thirds] = text.split('.')
  const innings = Number(whole)
  const outs = Number(thirds ?? 0)
  const total = (Number.isFinite(innings) ? innings : 0) + (Number.isFinite(outs) ? outs / 3 : 0)
  // Rounded so the shard carries 35.333 rather than 35.333333333333336.
  return Math.round(total * 1000) / 1000
}
