/**
 * League-trend computations against a tiny synthetic season built for
 * hand-checkable expectations: 4 teams, 2 scored categories (HR up,
 * ERA down) + 1 display-only, 2 completed weeks, 1 live week, 1 empty
 * future week, and 1 playoff week that must be ignored.
 */
import { describe, expect, it } from 'vitest'
import {
  completedWeeks,
  computeAllPlay,
  computeCategoryForm,
  computeCategoryLeaders,
  computeTrajectories,
  rankTeams,
  winPct,
} from '../app/lib/leagueTrends.js'
import type { Matchup, MatchupTeam, SeasonMatchups, TeamScore } from '../src/domain/matchups.js'
import { compareStat, statKey, type LeagueSeasonSettings, type StatOutcome } from '../src/domain/stats.js'

const settings: LeagueSeasonSettings = {
  leagueKey: '469.l.1',
  leagueId: 'test',
  season: '2026',
  name: 'Test League',
  numTeams: 4,
  scoringType: 'headone',
  draftType: 'snake',
  currentWeek: 3,
  startWeek: 1,
  endWeek: 5,
  categories: [
    { statId: 60, role: 'batting', abbr: 'H/AB', name: 'Hits / At Bats', higherIsBetter: true, isDisplayOnly: true },
    { statId: 12, role: 'batting', abbr: 'HR', name: 'Home Runs', higherIsBetter: true, isDisplayOnly: false },
    { statId: 26, role: 'pitching', abbr: 'ERA', name: 'Earned Run Average', higherIsBetter: false, isDisplayOnly: false },
  ],
}

const HR = statKey('batting', 12)
const ERA = statKey('pitching', 26)

/** Team names chosen so alphabetical tie-breaks are predictable. */
const NAMES: Record<string, string> = { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta' }

function team(id: string, hr: number, era: number): MatchupTeam {
  return {
    teamKey: `t.${id}`,
    name: NAMES[id]!,
    manager: id,
    managerGuid: null,
    logoUrl: null,
    stats: { [HR]: String(hr), [ERA]: era.toFixed(2) },
    results: {},
    score: { w: 0, l: 0, t: 0 },
    liveGames: null,
    completedGames: null,
    remainingGames: null,
  }
}

/** Fill in results + score from stats, the way the pipeline does. */
function matchup(week: number, status: string, a: MatchupTeam, b: MatchupTeam, isPlayoffs = false): Matchup {
  for (const category of settings.categories) {
    if (category.isDisplayOnly) continue
    const key = statKey(category.role, category.statId)
    const outcome = compareStat(category, a.stats[key] ?? '', b.stats[key] ?? '')
    const flip: Record<StatOutcome, StatOutcome> = { win: 'loss', loss: 'win', tie: 'tie' }
    a.results[key] = outcome
    b.results[key] = flip[outcome]
    for (const [t, o] of [[a, outcome], [b, flip[outcome]]] as const) {
      if (o === 'win') t.score.w++
      else if (o === 'loss') t.score.l++
      else t.score.t++
    }
  }
  return { week, weekStart: null, weekEnd: null, status, isPlayoffs, teams: [a, b] }
}

// Week 1: A sweeps B; C beats D on ERA, ties HR.
// Week 2: C sweeps A; B sweeps D.
const season: SeasonMatchups = {
  leagueId: 'test',
  season: '2026',
  weeks: {
    '1': [
      matchup(1, 'postevent', team('A', 5, 3.00), team('B', 3, 4.00)),
      matchup(1, 'postevent', team('C', 4, 2.00), team('D', 4, 5.00)),
    ],
    '2': [
      matchup(2, 'postevent', team('A', 2, 5.00), team('C', 6, 3.50)),
      matchup(2, 'postevent', team('B', 7, 1.00), team('D', 1, 6.00)),
    ],
    '3': [
      matchup(3, 'midevent', team('A', 1, 2.00), team('D', 3, 9.00)),
      matchup(3, 'midevent', team('B', 9, 0.50), team('C', 2, 4.00)),
    ],
    '4': [],
    '5': [
      matchup(5, 'postevent', team('A', 9, 1.00), team('B', 0, 9.00), true),
    ],
  },
}

const liveScoreboard = season.weeks['3']!

function trajectoryOf(name: string) {
  const t = computeTrajectories(season, liveScoreboard).find(t => t.team.name === name)
  expect(t).toBeDefined()
  return t!
}

describe('completedWeeks', () => {
  it('keeps only non-empty, postevent, regular-season weeks', () => {
    expect(completedWeeks(season)).toEqual([1, 2])
  })
})

describe('rankTeams / winPct', () => {
  it('ranks by pct, then wins, then stable teamKey', () => {
    const records = new Map([
      ['t.A', { meta: { teamKey: 't.A', name: 'Alpha', manager: 'A', logoUrl: null }, record: { w: 2, l: 2, t: 0 } }],
      ['t.B', { meta: { teamKey: 't.B', name: 'Bravo', manager: 'B', logoUrl: null }, record: { w: 2, l: 2, t: 0 } }],
      ['t.C', { meta: { teamKey: 't.C', name: 'Charlie', manager: 'C', logoUrl: null }, record: { w: 1, l: 1, t: 2 } }],
    ])
    const ranks = rankTeams(records)
    // C has same pct (.500) but fewer wins; A beats B on teamKey.
    expect(ranks.get('t.A')).toBe(1)
    expect(ranks.get('t.B')).toBe(2)
    expect(ranks.get('t.C')).toBe(3)
  })

  it('winPct counts ties as half-wins and guards zero games', () => {
    expect(winPct({ w: 3, l: 0, t: 1 })).toBeCloseTo(0.875)
    expect(winPct({ w: 0, l: 0, t: 0 })).toBe(0)
  })
})

describe('computeTrajectories', () => {
  it('ranks each completed week cumulatively', () => {
    // After W1: A 2-0 (1st), C 1-0-1 (2nd), D 0-1-1 (3rd), B 0-2 (4th).
    // After W2: C 3-0-1 (1st), A/B 2-2 → teamKey tie-break A 2nd B 3rd, D 4th.
    expect(trajectoryOf('Alpha').points.filter(p => !p.provisional).map(p => p.rank)).toEqual([1, 2])
    expect(trajectoryOf('Charlie').points.filter(p => !p.provisional).map(p => p.rank)).toEqual([2, 1])
    expect(trajectoryOf('Bravo').points.filter(p => !p.provisional).map(p => p.rank)).toEqual([4, 3])
    expect(trajectoryOf('Delta').points.filter(p => !p.provisional).map(p => p.rank)).toEqual([3, 4])
  })

  it('movement is positive when climbing, from completed weeks only', () => {
    expect(trajectoryOf('Charlie').movement).toBe(1)
    expect(trajectoryOf('Alpha').movement).toBe(-1)
  })

  it('appends one provisional point per team from the live scoreboard', () => {
    // Live W3: A+D split, B sweeps C → B 4-2 (1st), C 3-2-1 (2nd), A 3-3 (3rd), D 1-4-1 (4th).
    const bravo = trajectoryOf('Bravo')
    const last = bravo.points.at(-1)!
    expect(last).toEqual({ week: 3, rank: 1, provisional: true })
    expect(bravo.points).toHaveLength(3)
  })

  it('movement is null with fewer than two completed weeks', () => {
    const oneWeek: SeasonMatchups = { ...season, weeks: { '1': season.weeks['1']! } }
    for (const t of computeTrajectories(oneWeek, null)) expect(t.movement).toBeNull()
  })
})

describe('computeCategoryForm', () => {
  it('computes recent-window vs season rates with trend threshold', () => {
    // window=1 → recent = week 2 only.
    const form = computeCategoryForm(season, settings, 1)
    const alpha = form.find(f => f.team.name === 'Alpha')!
    const hr = alpha.cells.find(c => c.key === HR)!
    expect(hr.recentRate).toBe(0)          // lost HR in week 2
    expect(hr.seasonRate).toBeCloseTo(0.5) // 1-1 on the season
    expect(hr.trend).toBe('down')

    const charlie = form.find(f => f.team.name === 'Charlie')!
    const chr = charlie.cells.find(c => c.key === HR)!
    expect(chr.recentRate).toBe(1)
    expect(chr.seasonRate).toBeCloseTo(0.75) // win + tie
    expect(chr.trend).toBe('up')
  })

  it('excludes display-only categories', () => {
    for (const teamForm of computeCategoryForm(season, settings)) {
      expect(teamForm.cells.map(c => c.abbr)).toEqual(['HR', 'ERA'])
    }
  })

  it('is flat inside the threshold', () => {
    // window=2 covers the whole season → recent === season → flat.
    for (const teamForm of computeCategoryForm(season, settings, 2)) {
      for (const cell of teamForm.cells) expect(cell.trend).toBe('flat')
    }
  })
})

describe('computeAllPlay', () => {
  const rows = computeAllPlay(season, settings)
  const row = (name: string) => rows.find(r => r.team.name === name)!

  it('is symmetric: total wins equal total losses, ties even', () => {
    const w = rows.reduce((s, r) => s + r.allPlay.w, 0)
    const l = rows.reduce((s, r) => s + r.allPlay.l, 0)
    const t = rows.reduce((s, r) => s + r.allPlay.t, 0)
    expect(w).toBe(l)
    expect(t % 2).toBe(0)
  })

  it('every team plays (teams−1) × cats games per completed week', () => {
    for (const r of rows) {
      expect(r.allPlay.w + r.allPlay.l + r.allPlay.t).toBe(2 * 3 * 2)
    }
  })

  it('hand-checked luck: Charlie beat his stats, Alpha lagged his', () => {
    // Charlie: actual 3-0-1 (.875) vs all-play 8-3-1 (.7083) → +.1667.
    expect(row('Charlie').actual).toEqual({ w: 3, l: 0, t: 1 } satisfies TeamScore)
    expect(row('Charlie').luck).toBeCloseTo(0.875 - 8.5 / 12)
    // Alpha: actual 2-2 (.500) vs all-play 7-5 (.5833) → −.0833.
    expect(row('Alpha').allPlay).toEqual({ w: 7, l: 5, t: 0 } satisfies TeamScore)
    expect(row('Alpha').luck).toBeCloseTo(0.5 - 7 / 12)
    // Delta: exactly as unlucky as he is bad.
    expect(row('Delta').luck).toBeCloseTo(0)
  })

  it('sorts luckiest first', () => {
    expect(rows[0]!.team.name).toBe('Charlie')
  })
})

describe('computeCategoryLeaders', () => {
  const leaders = computeCategoryLeaders(season, settings)

  it('finds one leader per scored category, in settings order', () => {
    expect(leaders.map(l => l.category.abbr)).toEqual(['HR', 'ERA'])
  })

  it('leads by category record rate', () => {
    const [hr, era] = leaders
    expect(hr!.team.name).toBe('Charlie')   // 1-0-1 (.75) beats everyone's .5
    expect(hr!.record).toEqual({ w: 1, l: 0, t: 1 } satisfies TeamScore)
    expect(era!.team.name).toBe('Charlie')  // 2-0 (1.000)
    expect(era!.rate).toBe(1)
  })

  it('returns nothing with zero completed weeks', () => {
    const empty: SeasonMatchups = { ...season, weeks: { '4': [] } }
    expect(computeCategoryLeaders(empty, settings)).toEqual([])
    expect(computeTrajectories(empty, null)).toEqual([])
  })
})
