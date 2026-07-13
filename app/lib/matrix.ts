/**
 * The vs-field matrix: how the home team's week would score against every
 * other team in the league, plus schedule context (when each opponent is
 * actually played). All comparisons run through compareStat so category
 * direction always comes from league settings.
 */
import type { Matchup, MatchupTeam, TeamScore } from '../../src/domain/matchups'
import {
  compareStat,
  scoredCategories,
  statKey,
  type LeagueSeasonSettings,
  type StatKey,
  type StatOutcome,
} from '../../src/domain/stats'

export interface MatrixRow {
  team: MatchupTeam
  /** Hypothetical category record from the home team's perspective. */
  score: TeamScore
  /**
   * Per-category outcome from the HOME team's perspective (win = the home
   * team takes this category from the row team).
   */
  outcomes: Record<StatKey, StatOutcome>
  /** True when this is the home team's real opponent this week. */
  isActualOpponent: boolean
  /** Next week (after the selected one) the home team plays this team. */
  nextMeetingWeek: number | null
}

export interface Matrix {
  home: MatchupTeam
  rows: MatrixRow[]
  wouldBeat: number
  wouldLoseTo: number
  wouldTie: number
  best: MatrixRow | null
  worst: MatrixRow | null
}

/** All teams in a week's scoreboard, with each team's actual opponent key. */
function teamsOfWeek(matchups: Matchup[]): Array<{ team: MatchupTeam; opponentKey: string }> {
  const out: Array<{ team: MatchupTeam; opponentKey: string }> = []
  for (const m of matchups) {
    out.push({ team: m.teams[0], opponentKey: m.teams[1].teamKey })
    out.push({ team: m.teams[1], opponentKey: m.teams[0].teamKey })
  }
  return out
}

/** Weeks (ascending) in which the two teams face each other. */
export function meetingWeeks(
  weeks: Record<string, Matchup[]>,
  teamA: string,
  teamB: string,
): number[] {
  const found: number[] = []
  for (const [week, matchups] of Object.entries(weeks)) {
    for (const m of matchups) {
      const keys = [m.teams[0].teamKey, m.teams[1].teamKey]
      if (keys.includes(teamA) && keys.includes(teamB)) found.push(Number(week))
    }
  }
  return found.sort((a, b) => a - b)
}

function compareRecords(a: TeamScore, b: TeamScore): number {
  return (a.w - a.l) - (b.w - b.l)
}

export function computeMatrix(
  homeKey: string,
  weekMatchups: Matchup[],
  seasonWeeks: Record<string, Matchup[]> | null,
  selectedWeek: number,
  settings: LeagueSeasonSettings,
): Matrix | null {
  const entries = teamsOfWeek(weekMatchups)
  const homeEntry = entries.find(e => e.team.teamKey === homeKey)
  if (!homeEntry) return null

  const categories = scoredCategories(settings)
  const rows: MatrixRow[] = []

  for (const { team } of entries) {
    if (team.teamKey === homeKey) continue

    const score: TeamScore = { w: 0, l: 0, t: 0 }
    const outcomes: Record<StatKey, StatOutcome> = {}
    for (const category of categories) {
      const key = statKey(category.role, category.statId)
      const homeOutcome = compareStat(
        category,
        homeEntry.team.stats[key] ?? '',
        team.stats[key] ?? '',
      )
      outcomes[key] = homeOutcome
      if (homeOutcome === 'win') score.w++
      else if (homeOutcome === 'loss') score.l++
      else score.t++
    }

    const meetings = seasonWeeks ? meetingWeeks(seasonWeeks, homeKey, team.teamKey) : []
    rows.push({
      team,
      score,
      outcomes,
      isActualOpponent: team.teamKey === homeEntry.opponentKey,
      nextMeetingWeek: meetings.find(w => w > selectedWeek) ?? null,
    })
  }

  // Schedule order: this week's opponent first, then the soonest future
  // meetings; teams with no remaining meetings sink to the bottom.
  rows.sort((a, b) => {
    if (a.isActualOpponent !== b.isActualOpponent) return a.isActualOpponent ? -1 : 1
    return (a.nextMeetingWeek ?? Infinity) - (b.nextMeetingWeek ?? Infinity)
  })

  let best: MatrixRow | null = null
  let worst: MatrixRow | null = null
  let wouldBeat = 0
  let wouldLoseTo = 0
  let wouldTie = 0
  for (const row of rows) {
    if (row.score.w > row.score.l) wouldBeat++
    else if (row.score.w < row.score.l) wouldLoseTo++
    else wouldTie++
    if (!best || compareRecords(row.score, best.score) > 0) best = row
    if (!worst || compareRecords(row.score, worst.score) < 0) worst = row
  }

  return { home: homeEntry.team, rows, wouldBeat, wouldLoseTo, wouldTie, best, worst }
}
