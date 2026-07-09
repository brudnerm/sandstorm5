/**
 * Matchup, standings, and data-shard shapes. Team stats are keyed by
 * StatKey (`role:stat_id`) — see src/domain/stats.ts for why.
 */
import type { StatKey, StatOutcome } from './stats.js'

export interface TeamScore {
  w: number
  l: number
  t: number
}

export interface MatchupTeam {
  teamKey: string
  name: string
  manager: string
  managerGuid: string | null
  logoUrl: string | null
  stats: Record<StatKey, string>
  /** Per-category outcome from this team's perspective (Yahoo stat_winners). */
  results: Record<StatKey, StatOutcome>
  /** Category W-L-T over scored categories. */
  score: TeamScore
  liveGames: number | null
  completedGames: number | null
  remainingGames: number | null
}

export interface Matchup {
  week: number
  weekStart: string | null
  weekEnd: string | null
  /** Yahoo status: 'preevent' | 'midevent' | 'postevent' */
  status: string
  isPlayoffs: boolean
  teams: [MatchupTeam, MatchupTeam]
}

export interface StandingsRow {
  teamKey: string
  name: string
  manager: string
  managerGuid: string | null
  logoUrl: string | null
  rank: number
  playoffSeed: number | null
  wins: number
  losses: number
  ties: number
  /** Yahoo-formatted winning percentage, e.g. '.572' */
  percentage: string
  /** Yahoo-formatted games back; '-' for the leader */
  gamesBack: string
  waiverPriority: number | null
  faabBalance: number | null
  moves: number | null
  trades: number | null
}

/**
 * data/{leagueId}/live.json — everything the default view needs.
 * No timestamps here: freshness lives only in manifest.json so CI can
 * detect "nothing actually changed" by diffing shards.
 */
export interface LiveShard {
  leagueId: string
  leagueKey: string
  season: string
  currentWeek: number
  startWeek: number
  endWeek: number
  standings: StandingsRow[]
  scoreboard: Matchup[]
}

/** data/{leagueId}/matchups/{season}.json — full-season week browser. */
export interface SeasonMatchups {
  leagueId: string
  season: string
  weeks: Record<string, Matchup[]>
}

/** data/manifest.json — tiny root index the client loads first. */
export interface Manifest {
  generatedAt: string
  leagues: Array<{
    id: string
    name: string
    season: string
    currentWeek: number
  }>
}
