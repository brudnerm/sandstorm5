/**
 * Pure helpers for the Injuries view: week-range labels, the playoff-week
 * flag, and the league-summary aggregates.
 *
 * Weeks lost are no longer recomputed here. The pipeline counts the weeks a
 * player actually sat in an IL slot and ships that as `stint.weeksLost`;
 * deriving it in the view as `lastWeek - firstWeek + 1` is what previously
 * billed teams for weeks the player was off their roster entirely.
 */
import type { InjuriesShard, InjuryStint } from '../../src/domain/rosters'
import type { StandingsRow } from '../../src/domain/matchups'

export function weeksLabel(stint: Pick<InjuryStint, 'firstWeek' | 'lastWeek'>): string {
  if (stint.lastWeek === null) return `Wk ${stint.firstWeek}-`
  if (stint.lastWeek === stint.firstWeek) return `Wk ${stint.firstWeek}`
  return `Wk ${stint.firstWeek}-${stint.lastWeek}`
}

/** "4 wk", or "15+ wk" while the stint is still open. */
export function weeksLostLabel(stint: Pick<InjuryStint, 'weeksLost' | 'lastWeek'>): string {
  return `${stint.weeksLost}${stint.lastWeek === null ? '+' : ''} wk`
}

/**
 * Teams in the playoff field, by the league's own bracket size — 6 in most of
 * our seasons, but 4 in 2020 and 8 in sidebar 2012, so it is read from the
 * shard rather than assumed. Before the bracket is settled this is the
 * projected field, since `playoffSeed` tracks the live standings.
 */
export function playoffTeamKeys(
  standings: StandingsRow[],
  numPlayoffTeams: number | null,
): Set<string> {
  if (!numPlayoffTeams) return new Set()
  return new Set(
    standings
      .filter(r => r.playoffSeed !== null && r.playoffSeed <= numPlayoffTeams)
      .map(r => r.teamKey),
  )
}

/**
 * Did this stint cost a playoff team roster time during the bracket?
 *
 * Only meaningful because stints are now real: when every stint ran week 1 to
 * the final week, this fired on every stint of every contending team and just
 * restated the standings.
 */
export function isPlayoffImpact(
  stint: Pick<InjuryStint, 'teamKey' | 'teams' | 'firstWeek' | 'lastWeek'>,
  asOfWeek: number,
  playoffStartWeek: number | null,
  playoffTeams: Set<string>,
): boolean {
  if (playoffStartWeek === null) return false
  const end = stint.lastWeek ?? asOfWeek
  if (end < playoffStartWeek) return false
  // Any team that held the IL slot counts — a stint traded mid-bracket cost
  // both managers, not just the one it started on.
  const holders = stint.teams.length > 0 ? stint.teams.map(t => t.teamKey) : [stint.teamKey]
  return holders.some(key => playoffTeams.has(key))
}

export interface TeamInjuryTotals {
  teamKey: string
  stints: number
  weeksLost: number
}

/**
 * One row per team (0 included), most weeks lost first.
 *
 * Attribution follows `stint.teams`, the pipeline's per-team split, so a
 * stint that changed hands mid-injury charges each manager only the weeks
 * they actually carried the IL slot.
 */
export function teamInjuryTotals(stints: InjuryStint[], teamKeys: string[]): TeamInjuryTotals[] {
  const totals = new Map<string, TeamInjuryTotals>(
    teamKeys.map(k => [k, { teamKey: k, stints: 0, weeksLost: 0 }]),
  )
  const bump = (teamKey: string, weeks: number) => {
    const row = totals.get(teamKey) ?? { teamKey, stints: 0, weeksLost: 0 }
    row.stints++
    row.weeksLost += weeks
    totals.set(teamKey, row)
  }
  for (const stint of stints) {
    if (stint.teams.length === 0) bump(stint.teamKey, stint.weeksLost)
    else for (const share of stint.teams) bump(share.teamKey, share.weeks)
  }
  return [...totals.values()].sort(
    (a, b) => b.weeksLost - a.weeksLost || b.stints - a.stints || a.teamKey.localeCompare(b.teamKey),
  )
}

/**
 * The longest stints league-wide. Ties break on the earlier onset and then
 * the player key, so the order is stable across refreshes rather than
 * depending on how the stints happened to be enumerated.
 */
export function longestStints(stints: InjuryStint[], limit = 5): InjuryStint[] {
  return [...stints]
    .sort(
      (a, b) =>
        b.weeksLost - a.weeksLost ||
        a.firstWeek - b.firstWeek ||
        a.playerKey.localeCompare(b.playerKey),
    )
    .slice(0, limit)
}

export interface LeagueInjurySummary {
  stints: number
  ongoing: number
  teamsHit: number
  weeksLost: number
}

export function summarize(shard: InjuriesShard, teamKeys: string[]): LeagueInjurySummary {
  const totals = teamInjuryTotals(shard.stints, teamKeys)
  return {
    stints: shard.stints.length,
    ongoing: shard.stints.filter(s => s.lastWeek === null).length,
    teamsHit: totals.filter(t => t.stints > 0).length,
    weeksLost: totals.reduce((sum, t) => sum + t.weeksLost, 0),
  }
}
