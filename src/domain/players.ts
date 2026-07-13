/**
 * Player-level shapes: team rosters with per-window stat lines, and the
 * free-agent watchlist. Player stats are keyed by StatKey exactly like
 * team stats — the role comes from the league's stat categories, never
 * from the player.
 */
import type { StatKey } from './stats.js'

/**
 * Stat coverage windows delivered per player.
 *  - week:      the selected fantasy week (matchup contribution)
 *  - lastweek:  trailing 7 days
 *  - lastmonth: trailing 30 days
 *  - season:    full season
 */
export type StatWindow = 'week' | 'lastweek' | 'lastmonth' | 'season'

export const STAT_WINDOWS: StatWindow[] = ['week', 'lastweek', 'lastmonth', 'season']

export interface PlayerCard {
  playerKey: string
  name: string
  /** MLB team abbreviation, e.g. 'DET'. */
  mlbTeam: string
  /** Yahoo position_type: 'B' batter, 'P' pitcher. */
  positionType: 'B' | 'P'
  /** Display position string, e.g. 'SS,OF'. */
  displayPosition: string
  eligiblePositions: string[]
  headshotUrl: string | null
  /** Injury/roster status: 'IL10', 'DTD', 'NA', ... or null when active. */
  status: string | null
  windows: Partial<Record<StatWindow, Record<StatKey, string>>>
}

export interface RosterPlayer extends PlayerCard {
  /** Today's lineup slot: 'C', 'Util', 'SP', 'BN', 'IL', ... */
  selectedPosition: string | null
}

export interface TeamRoster {
  teamKey: string
  players: RosterPlayer[]
}

/** data/{leagueId}/players/{season}.json — all rosters, all stat windows. */
export interface PlayersShard {
  leagueId: string
  season: string
  /** Fantasy week the 'week' window covers. */
  week: number
  rosters: TeamRoster[]
}

export interface FreeAgent extends PlayerCard {
  /** Percent of Yahoo leagues where this player is rostered. */
  percentOwned: number | null
  /** Week-over-week change in percentOwned. */
  ownershipDelta: number | null
}

/** data/{leagueId}/players/freeagents.json — waiver-wire watchlist. */
export interface FreeAgentsShard {
  leagueId: string
  season: string
  week: number
  players: FreeAgent[]
}
