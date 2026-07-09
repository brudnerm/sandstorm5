/**
 * Normalize a raw Yahoo `league/{key}/standings` response.
 */
import type { StandingsRow } from '../../domain/matchups.js'
import type { YahooResponse } from '../client.js'
import { asObj, indexed, num, parseTeamInfo } from './common.js'

export function normalizeStandings(raw: YahooResponse): StandingsRow[] {
  const leagueArr = raw.fantasy_content?.['league']
  if (!Array.isArray(leagueArr) || leagueArr.length < 2) {
    throw new Error('Unexpected standings payload: fantasy_content.league is not a 2-element array')
  }
  const standingsArr = asObj(leagueArr[1])['standings']
  const teamsObj = asObj(asObj(Array.isArray(standingsArr) ? standingsArr[0] : standingsArr)['teams'])

  const rows: StandingsRow[] = []
  for (const entry of indexed(teamsObj)) {
    const teamWrapper = asObj(entry)['team']
    if (!Array.isArray(teamWrapper)) continue

    const info = parseTeamInfo(teamWrapper[0] as unknown[])
    // team_standings rides at index 2 (index 1 is team_points)
    const standings = asObj(
      teamWrapper.map(asObj).find(o => 'team_standings' in o)?.['team_standings'],
    )
    const outcomes = asObj(standings['outcome_totals'])

    rows.push({
      teamKey: info.teamKey,
      name: info.name,
      manager: info.manager,
      managerGuid: info.managerGuid,
      logoUrl: info.logoUrl,
      rank: num(standings['rank']) ?? 0,
      playoffSeed: num(standings['playoff_seed']),
      wins: num(outcomes['wins']) ?? 0,
      losses: num(outcomes['losses']) ?? 0,
      ties: num(outcomes['ties']) ?? 0,
      percentage: String(outcomes['percentage'] ?? ''),
      gamesBack: String(standings['games_back'] ?? ''),
      waiverPriority: info.waiverPriority,
      faabBalance: info.faabBalance,
      moves: info.moves,
      trades: info.trades,
    })
  }

  return rows.sort((a, b) => a.rank - b.rank)
}
