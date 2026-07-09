/**
 * Normalize a raw Yahoo `league/{key}/scoreboard[;week=N]` response.
 *
 * Requires the league-season settings: team stats arrive keyed by bare
 * stat_id, and only the settings know which role a stat_id belongs to and
 * which direction it scores. Yahoo's stat_winners are the source of truth
 * for per-category outcomes (they handle display rounding correctly); we
 * fall back to compareStat only when Yahoo hasn't scored a category yet.
 */
import type { Matchup, MatchupTeam, TeamScore } from '../../domain/matchups.js'
import {
  compareStat,
  statKey,
  type LeagueSeasonSettings,
  type StatCategory,
  type StatKey,
  type StatOutcome,
} from '../../domain/stats.js'
import type { YahooResponse } from '../client.js'
import { asObj, indexed, num, parseTeamInfo, type AnyObj } from './common.js'

interface StatWinner {
  winnerTeamKey: string | null
  isTied: boolean
}

function parseStatWinners(matchup: AnyObj): Map<number, StatWinner> {
  const winners = new Map<number, StatWinner>()
  const arr = matchup['stat_winners']
  if (!Array.isArray(arr)) return winners
  for (const entry of arr) {
    const sw = asObj(asObj(entry)['stat_winner'])
    const statId = num(sw['stat_id'])
    if (statId === null) continue
    winners.set(statId, {
      winnerTeamKey: sw['winner_team_key'] ? String(sw['winner_team_key']) : null,
      isTied: String(sw['is_tied'] ?? '0') === '1',
    })
  }
  return winners
}

interface ParsedTeam {
  info: ReturnType<typeof parseTeamInfo>
  stats: Record<StatKey, string>
  rawById: Map<number, string>
  liveGames: number | null
  completedGames: number | null
  remainingGames: number | null
}

function parseTeam(teamWrapper: unknown[], byId: Map<number, StatCategory>): ParsedTeam {
  const info = parseTeamInfo(teamWrapper[0] as unknown[])
  const data = asObj(teamWrapper[1])

  const stats: Record<StatKey, string> = {}
  const rawById = new Map<number, string>()
  const statsArr = asObj(data['team_stats'])['stats']
  if (Array.isArray(statsArr)) {
    for (const entry of statsArr) {
      const stat = asObj(asObj(entry)['stat'])
      const statId = num(stat['stat_id'])
      if (statId === null) continue
      const category = byId.get(statId)
      if (!category) continue // stat not in this league's categories
      const value = String(stat['value'] ?? '')
      stats[statKey(category.role, category.statId)] = value
      rawById.set(statId, value)
    }
  }

  const remaining = asObj(asObj(data['team_remaining_games'])['total'])
  return {
    info,
    stats,
    rawById,
    liveGames: num(remaining['live_games']),
    completedGames: num(remaining['completed_games']),
    remainingGames: num(remaining['remaining_games']),
  }
}

function resolveOutcomes(
  team: ParsedTeam,
  opponent: ParsedTeam,
  winners: Map<number, StatWinner>,
  settings: LeagueSeasonSettings,
): { results: Record<StatKey, StatOutcome>; score: TeamScore } {
  const results: Record<StatKey, StatOutcome> = {}
  const score: TeamScore = { w: 0, l: 0, t: 0 }

  for (const category of settings.categories) {
    const key = statKey(category.role, category.statId)
    if (!(key in team.stats)) continue

    let outcome: StatOutcome
    const winner = winners.get(category.statId)
    if (winner && (winner.isTied || winner.winnerTeamKey)) {
      outcome = winner.isTied
        ? 'tie'
        : winner.winnerTeamKey === team.info.teamKey
          ? 'win'
          : 'loss'
    } else {
      outcome = compareStat(
        category,
        team.rawById.get(category.statId) ?? '',
        opponent.rawById.get(category.statId) ?? '',
      )
    }

    results[key] = category.isDisplayOnly ? 'tie' : outcome
    if (!category.isDisplayOnly) {
      if (outcome === 'win') score.w++
      else if (outcome === 'loss') score.l++
      else score.t++
    }
  }
  return { results, score }
}

export function normalizeScoreboard(
  raw: YahooResponse,
  settings: LeagueSeasonSettings,
): { week: number; currentWeek: number; matchups: Matchup[] } {
  const leagueArr = raw.fantasy_content?.['league']
  if (!Array.isArray(leagueArr) || leagueArr.length < 2) {
    throw new Error('Unexpected scoreboard payload: fantasy_content.league is not a 2-element array')
  }
  const meta = asObj(leagueArr[0])
  const currentWeek = num(meta['current_week']) ?? 0

  const scoreboard = asObj(asObj(leagueArr[1])['scoreboard'])
  const week = num(scoreboard['week']) ?? currentWeek
  const matchupsObj = asObj(asObj(scoreboard['0'])['matchups'])

  const byId = new Map(settings.categories.map(c => [c.statId, c]))
  const matchups: Matchup[] = []

  for (const entry of indexed(matchupsObj)) {
    const matchup = asObj(asObj(entry)['matchup'])
    const teamsObj = asObj(asObj(matchup['0'])['teams'])

    const parsed: ParsedTeam[] = []
    for (const teamEntry of indexed(teamsObj)) {
      const teamWrapper = asObj(teamEntry)['team']
      if (!Array.isArray(teamWrapper) || teamWrapper.length < 2) {
        throw new Error(`Week ${week}: malformed team wrapper in matchup`)
      }
      parsed.push(parseTeam(teamWrapper, byId))
    }
    if (parsed.length !== 2) {
      throw new Error(`Week ${week}: expected 2 teams in matchup, got ${parsed.length}`)
    }
    const [a, b] = parsed as [ParsedTeam, ParsedTeam]

    const winners = parseStatWinners(matchup)
    const teams = [
      { self: a, other: b },
      { self: b, other: a },
    ].map(({ self, other }): MatchupTeam => {
      const { results, score } = resolveOutcomes(self, other, winners, settings)
      return {
        teamKey: self.info.teamKey,
        name: self.info.name,
        manager: self.info.manager,
        managerGuid: self.info.managerGuid,
        logoUrl: self.info.logoUrl,
        stats: self.stats,
        results,
        score,
        liveGames: self.liveGames,
        completedGames: self.completedGames,
        remainingGames: self.remainingGames,
      }
    })

    matchups.push({
      week: num(matchup['week']) ?? week,
      weekStart: matchup['week_start'] ? String(matchup['week_start']) : null,
      weekEnd: matchup['week_end'] ? String(matchup['week_end']) : null,
      status: String(matchup['status'] ?? 'unknown'),
      isPlayoffs: String(matchup['is_playoffs'] ?? '0') === '1',
      teams: teams as [MatchupTeam, MatchupTeam],
    })
  }

  return { week, currentWeek, matchups }
}
