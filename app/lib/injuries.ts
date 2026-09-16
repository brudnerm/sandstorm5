/**
 * Pure helpers for the Injuries view: week-range labels, weeks-lost totals,
 * the playoff-weeks set (derived from the season's matchups, never
 * hand-coded, so it tracks whatever weeks Yahoo has actually tagged as
 * playoffs), and the league-summary aggregates.
 */
import type { Matchup } from '../../src/domain/matchups'
import type { InjuryStint } from '../../src/domain/rosters'

export function weeksLabel(stint: Pick<InjuryStint, 'firstWeek' | 'lastWeek'>): string {
  if (stint.lastWeek === null) return `Wk ${stint.firstWeek}-`
  if (stint.lastWeek === stint.firstWeek) return `Wk ${stint.firstWeek}`
  return `Wk ${stint.firstWeek}-${stint.lastWeek}`
}

export function weeksLost(stint: Pick<InjuryStint, 'firstWeek' | 'lastWeek'>, asOfWeek: number): number {
  const end = stint.lastWeek ?? asOfWeek
  return end - stint.firstWeek + 1
}

/** Weeks any matchup was tagged isPlayoffs, straight from the season matchups shard. */
export function playoffWeeksFrom(weeks: Record<string, Matchup[]>): Set<number> {
  const set = new Set<number>()
  for (const [wk, matchups] of Object.entries(weeks)) {
    if (matchups.some(m => m.isPlayoffs)) set.add(Number(wk))
  }
  return set
}

export function isPlayoffImpact(
  stint: Pick<InjuryStint, 'teamKey' | 'firstWeek' | 'lastWeek'>,
  asOfWeek: number,
  playoffWeeks: Set<number>,
  playoffTeamKeys: Set<string>,
): boolean {
  if (playoffWeeks.size === 0 || !playoffTeamKeys.has(stint.teamKey)) return false
  const end = stint.lastWeek ?? asOfWeek
  for (let w = stint.firstWeek; w <= end; w++) {
    if (playoffWeeks.has(w)) return true
  }
  return false
}

export interface TeamStintCount {
  teamKey: string
  count: number
}

/** One row per team (0 included), most IL stints first. */
export function stintCountsByTeam(stints: InjuryStint[], teamKeys: string[]): TeamStintCount[] {
  const counts = new Map<string, number>(teamKeys.map(k => [k, 0]))
  for (const s of stints) counts.set(s.teamKey, (counts.get(s.teamKey) ?? 0) + 1)
  return teamKeys
    .map((teamKey): TeamStintCount => ({ teamKey, count: counts.get(teamKey) ?? 0 }))
    .sort((a, b) => b.count - a.count)
}

export interface WeeksLostEntry {
  stint: InjuryStint
  weeksLost: number
}

/** Players who lost the most weeks league-wide, longest first. */
export function mostWeeksLost(stints: InjuryStint[], asOfWeek: number, limit = 5): WeeksLostEntry[] {
  return stints
    .map((stint): WeeksLostEntry => ({ stint, weeksLost: weeksLost(stint, asOfWeek) }))
    .sort((a, b) => b.weeksLost - a.weeksLost)
    .slice(0, limit)
}
