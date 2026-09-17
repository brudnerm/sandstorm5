/**
 * Injuries view helpers. These had no coverage at all in the first version,
 * which is how a playoff flag that fired on every contender's every stint,
 * and a weeks-lost total that billed teams for weeks the player was off their
 * roster, both shipped unnoticed.
 */
import { describe, expect, it } from 'vitest'
import {
  isPlayoffImpact,
  longestStints,
  playoffTeamKeys,
  summarize,
  teamInjuryTotals,
  weeksLabel,
  weeksLostLabel,
} from '../app/lib/injuries.js'
import type { StandingsRow } from '../src/domain/matchups.js'
import type { InjuriesShard, InjuryStint } from '../src/domain/rosters.js'

function stint(over: Partial<InjuryStint> & { playerKey: string }): InjuryStint {
  const base: InjuryStint = {
    playerKey: over.playerKey,
    name: 'Test Player',
    teamKey: 'A',
    firstWeek: 1,
    lastWeek: 1,
    weeksLost: 1,
    teams: [{ teamKey: over.teamKey ?? 'A', weeks: over.weeksLost ?? 1 }],
    status: null,
    dropped: false,
    traded: false,
    seasonLine: null,
  }
  return { ...base, ...over }
}

function standing(teamKey: string, playoffSeed: number | null): StandingsRow {
  return {
    teamKey,
    name: teamKey,
    manager: teamKey,
    logoUrl: null,
    rank: playoffSeed ?? 99,
    playoffSeed,
  } as StandingsRow
}

describe('weeksLabel / weeksLostLabel', () => {
  it('labels a closed range, a single week, and an open stint', () => {
    expect(weeksLabel({ firstWeek: 3, lastWeek: 7 })).toBe('Wk 3-7')
    expect(weeksLabel({ firstWeek: 3, lastWeek: 3 })).toBe('Wk 3')
    expect(weeksLabel({ firstWeek: 3, lastWeek: null })).toBe('Wk 3-')
  })

  it('marks an open stint as a floor, not a total', () => {
    expect(weeksLostLabel({ weeksLost: 4, lastWeek: 7 })).toBe('4 wk')
    expect(weeksLostLabel({ weeksLost: 4, lastWeek: null })).toBe('4+ wk')
  })
})

describe('playoffTeamKeys', () => {
  const standings = [standing('A', 1), standing('B', 4), standing('C', 7), standing('D', null)]

  it('takes the bracket size from the league rather than assuming six', () => {
    expect(playoffTeamKeys(standings, 4)).toEqual(new Set(['A', 'B']))
    expect(playoffTeamKeys(standings, 8)).toEqual(new Set(['A', 'B', 'C']))
  })

  it('is empty when the league never reported a bracket size', () => {
    expect(playoffTeamKeys(standings, null).size).toBe(0)
  })
})

describe('isPlayoffImpact', () => {
  const field = new Set(['A'])

  it('flags a stint that runs into the bracket for a team in the field', () => {
    expect(isPlayoffImpact(stint({ playerKey: 'p', firstWeek: 21, lastWeek: 23 }), 25, 23, field)).toBe(true)
  })

  it('does not flag a stint that ended before the bracket', () => {
    expect(isPlayoffImpact(stint({ playerKey: 'p', firstWeek: 10, lastWeek: 22 }), 25, 23, field)).toBe(false)
  })

  it('does not flag a team that missed the field', () => {
    const s = stint({ playerKey: 'p', teamKey: 'Z', firstWeek: 24, lastWeek: 25, teams: [{ teamKey: 'Z', weeks: 2 }] })
    expect(isPlayoffImpact(s, 25, 23, field)).toBe(false)
  })

  it('treats an open stint as running through the latest week', () => {
    expect(isPlayoffImpact(stint({ playerKey: 'p', firstWeek: 20, lastWeek: null }), 24, 23, field)).toBe(true)
  })

  it('flags either side of a stint traded mid-bracket', () => {
    const s = stint({
      playerKey: 'p',
      teamKey: 'Z',
      firstWeek: 22,
      lastWeek: 25,
      teams: [{ teamKey: 'Z', weeks: 2 }, { teamKey: 'A', weeks: 2 }],
    })
    expect(isPlayoffImpact(s, 25, 23, field)).toBe(true)
  })

  it('stays off entirely when the league reported no bracket start', () => {
    expect(isPlayoffImpact(stint({ playerKey: 'p', firstWeek: 1, lastWeek: 25 }), 25, null, field)).toBe(false)
  })
})

describe('teamInjuryTotals', () => {
  it('splits a traded stint across both managers instead of charging the first', () => {
    const stints = [
      stint({
        playerKey: 'p1',
        teamKey: 'A',
        weeksLost: 5,
        teams: [{ teamKey: 'A', weeks: 2 }, { teamKey: 'B', weeks: 3 }],
      }),
    ]
    const totals = teamInjuryTotals(stints, ['A', 'B'])
    expect(totals).toEqual([
      { teamKey: 'B', stints: 1, weeksLost: 3 },
      { teamKey: 'A', stints: 1, weeksLost: 2 },
    ])
  })

  it('includes teams with no stints and orders by weeks lost', () => {
    const stints = [
      stint({ playerKey: 'p1', teamKey: 'A', weeksLost: 2, teams: [{ teamKey: 'A', weeks: 2 }] }),
      stint({ playerKey: 'p2', teamKey: 'B', weeksLost: 9, teams: [{ teamKey: 'B', weeks: 9 }] }),
    ]
    expect(teamInjuryTotals(stints, ['A', 'B', 'C'])).toEqual([
      { teamKey: 'B', stints: 1, weeksLost: 9 },
      { teamKey: 'A', stints: 1, weeksLost: 2 },
      { teamKey: 'C', stints: 0, weeksLost: 0 },
    ])
  })
})

describe('longestStints', () => {
  it('orders by weeks lost, breaking ties deterministically', () => {
    const stints = [
      stint({ playerKey: 'z', firstWeek: 5, weeksLost: 4 }),
      stint({ playerKey: 'a', firstWeek: 5, weeksLost: 4 }),
      stint({ playerKey: 'm', firstWeek: 2, weeksLost: 4 }),
      stint({ playerKey: 'q', firstWeek: 1, weeksLost: 9 }),
    ]
    expect(longestStints(stints, 4).map(s => s.playerKey)).toEqual(['q', 'm', 'a', 'z'])
    // Same input in another order must produce the same ranking.
    expect(longestStints([...stints].reverse(), 4).map(s => s.playerKey)).toEqual(['q', 'm', 'a', 'z'])
  })
})

describe('summarize', () => {
  it('counts open stints and total roster-weeks lost', () => {
    const shard: InjuriesShard = {
      leagueId: 'kp',
      season: '2026',
      asOfWeek: 25,
      playoffStartWeek: 23,
      numPlayoffTeams: 6,
      stints: [
        stint({ playerKey: 'p1', teamKey: 'A', weeksLost: 3, lastWeek: 4, teams: [{ teamKey: 'A', weeks: 3 }] }),
        stint({ playerKey: 'p2', teamKey: 'A', weeksLost: 2, lastWeek: null, teams: [{ teamKey: 'A', weeks: 2 }] }),
      ],
    }
    expect(summarize(shard, ['A', 'B'])).toEqual({ stints: 2, ongoing: 1, teamsHit: 1, weeksLost: 5 })
  })
})
