/**
 * Injury stint derivation against small hand-built weekly roster fixtures.
 *
 * Stints come from the IL *lineup slot*, which Yahoo scopes to the requested
 * week. `status` is deliberately set to misleading values in several of these
 * fixtures: it is the player's status at fetch time, not that week's, so the
 * derivation must ignore it. See the note at the top of src/domain/rosters.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  deriveInjuryStints,
  isInjuredStatus,
  isInjurySlot,
  statLineToSeasonLine,
  type WeekSnapshot,
  type WeeklyRosterPlayer,
} from '../src/domain/rosters.js'
import { statKey, type StatCategory } from '../src/domain/stats.js'

function player(overrides: Partial<WeeklyRosterPlayer> & { playerKey: string }): WeeklyRosterPlayer {
  return {
    name: 'Test Player',
    positions: ['OF'],
    selectedPosition: 'OF',
    status: null,
    ...overrides,
  }
}

/** Shorthand: a player sitting in the IL slot that week. */
function il(playerKey: string, overrides: Partial<WeeklyRosterPlayer> = {}): WeeklyRosterPlayer {
  return player({ playerKey, selectedPosition: 'IL', ...overrides })
}

function week(n: number, teams: Record<string, WeeklyRosterPlayer[]>): WeekSnapshot {
  return { week: n, teams: Object.entries(teams).map(([teamKey, players]) => ({ teamKey, players })) }
}

describe('isInjuredStatus', () => {
  it('treats every IL substatus as injured', () => {
    expect(isInjuredStatus('IL10')).toBe(true)
    expect(isInjuredStatus('IL15')).toBe(true)
    expect(isInjuredStatus('IL60')).toBe(true)
    expect(isInjuredStatus('IL')).toBe(true)
    expect(isInjuredStatus('IL7')).toBe(true)
  })

  it('does not treat DTD, NA, or active as injured', () => {
    expect(isInjuredStatus('DTD')).toBe(false)
    expect(isInjuredStatus('NA')).toBe(false)
    expect(isInjuredStatus(null)).toBe(false)
  })
})

describe('isInjurySlot', () => {
  it('matches the IL slots and nothing else', () => {
    expect(isInjurySlot('IL')).toBe(true)
    expect(isInjurySlot('IL+')).toBe(true)
    expect(isInjurySlot('BN')).toBe(false)
    expect(isInjurySlot('Util')).toBe(false)
    expect(isInjurySlot('NA')).toBe(false)
    expect(isInjurySlot(null)).toBe(false)
  })
})

describe('deriveInjuryStints', () => {
  const KEY = '469.l.1.p.1'

  it('derives the stint from the IL slot and ignores the status field', () => {
    // The whole point: `status` here is today's value stamped on every week
    // by a backfill. Week 3 says IL60 while he is back in the lineup, and
    // weeks 1-2 carry it too. Only the slot is week-scoped.
    const weeks: WeekSnapshot[] = [
      week(1, { A: [il(KEY, { status: 'IL60' })] }),
      week(2, { A: [il(KEY, { status: 'IL60' })] }),
      week(3, { A: [player({ playerKey: KEY, status: 'IL60' })] }),
    ]
    const stints = deriveInjuryStints(weeks)
    expect(stints).toHaveLength(1)
    expect(stints[0]!.firstWeek).toBe(1)
    expect(stints[0]!.lastWeek).toBe(2)
    expect(stints[0]!.weeksLost).toBe(2)
  })

  it('ends the stint when the player is dropped, and does not call it ongoing', () => {
    // Regression: the first version checked "last observation for this player"
    // instead of "last week of the season", so anyone dropped while hurt was
    // reported as still out, for every remaining week of the season.
    const weeks: WeekSnapshot[] = [
      week(1, { A: [player({ playerKey: KEY })] }),
      week(2, { A: [il(KEY)] }),
      ...[3, 4, 5].map(w => week(w, { A: [player({ playerKey: 'other' })] })),
    ]
    const stints = deriveInjuryStints(weeks)
    expect(stints).toHaveLength(1)
    expect(stints[0]!.lastWeek).toBe(2)
    expect(stints[0]!.weeksLost).toBe(1)
    expect(stints[0]!.dropped).toBe(true)
    expect(stints[0]!.status).toBeNull()
  })

  it('charges a drop-and-repickup as two stints, one per manager', () => {
    // Week 1-2 IL-slotted on A, dropped in week 3, picked up and re-IL-slotted
    // by B in week 4. A paid two weeks; B paid one. Neither paid for week 3.
    const weeks: WeekSnapshot[] = [
      week(1, { A: [il(KEY)] }),
      week(2, { A: [il(KEY)] }),
      week(3, { A: [player({ playerKey: 'other' })] }),
      week(4, { B: [il(KEY)] }),
      week(5, { B: [player({ playerKey: KEY })] }),
    ]
    const stints = deriveInjuryStints(weeks)
    expect(stints).toHaveLength(2)
    expect(stints[0]).toMatchObject({ teamKey: 'A', firstWeek: 1, lastWeek: 2, weeksLost: 2, dropped: true })
    expect(stints[1]).toMatchObject({ teamKey: 'B', firstWeek: 4, lastWeek: 4, weeksLost: 1, dropped: false })
  })

  it('keeps a mid-stint trade as one stint and splits the weeks by team', () => {
    const weeks: WeekSnapshot[] = [
      week(1, { A: [il(KEY)] }),
      week(2, { A: [il(KEY)] }),
      week(3, { B: [il(KEY)] }),
      week(4, { B: [player({ playerKey: KEY })] }),
    ]
    const stints = deriveInjuryStints(weeks)
    expect(stints).toHaveLength(1)
    const stint = stints[0]!
    expect(stint.traded).toBe(true)
    expect(stint.dropped).toBe(false)
    expect(stint.weeksLost).toBe(3)
    expect(stint.teams).toEqual([{ teamKey: 'A', weeks: 2 }, { teamKey: 'B', weeks: 1 }])
  })

  it('leaves lastWeek null, and keeps the live status, only at the latest snapshot', () => {
    const weeks: WeekSnapshot[] = [
      week(1, { A: [player({ playerKey: KEY })] }),
      week(2, { A: [il(KEY, { status: 'IL60' })] }),
      week(3, { A: [il(KEY, { status: 'IL60' })] }),
    ]
    const stints = deriveInjuryStints(weeks)
    expect(stints).toHaveLength(1)
    expect(stints[0]!.firstWeek).toBe(2)
    expect(stints[0]!.lastWeek).toBeNull()
    expect(stints[0]!.weeksLost).toBe(2)
    expect(stints[0]!.status).toBe('IL60')
  })

  it('produces two separate stints for two distinct injuries', () => {
    const weeks: WeekSnapshot[] = [
      week(1, { A: [player({ playerKey: KEY, status: 'DTD' })] }),
      week(2, { A: [il(KEY)] }),
      week(3, { A: [player({ playerKey: KEY })] }),
      week(4, { A: [player({ playerKey: KEY })] }),
      week(5, { A: [il(KEY)] }),
    ]
    const stints = deriveInjuryStints(weeks)
    expect(stints).toHaveLength(2)
    expect(stints[0]).toMatchObject({ firstWeek: 2, lastWeek: 2, weeksLost: 1 })
    expect(stints[1]).toMatchObject({ firstWeek: 5, lastWeek: null, weeksLost: 1 })
  })

  it('does not treat a bench or NA slot as an IL stint', () => {
    const weeks: WeekSnapshot[] = [
      week(1, { A: [player({ playerKey: KEY, selectedPosition: 'BN', status: 'IL10' })] }),
      week(2, { A: [player({ playerKey: KEY, selectedPosition: 'NA', status: 'NA' })] }),
    ]
    expect(deriveInjuryStints(weeks)).toHaveLength(0)
  })
})

describe('statLineToSeasonLine', () => {
  const categories: StatCategory[] = [
    { statId: 60, role: 'batting', abbr: 'H/AB', name: 'Hits / At Bats', higherIsBetter: true, isDisplayOnly: true },
    { statId: 7, role: 'batting', abbr: 'R', name: 'Runs', higherIsBetter: true, isDisplayOnly: false },
    { statId: 12, role: 'batting', abbr: 'HR', name: 'Home Runs', higherIsBetter: true, isDisplayOnly: false },
    { statId: 3, role: 'batting', abbr: 'AVG', name: 'Batting Average', higherIsBetter: true, isDisplayOnly: false },
    { statId: 50, role: 'pitching', abbr: 'IP', name: 'Innings Pitched', higherIsBetter: true, isDisplayOnly: true },
    { statId: 26, role: 'pitching', abbr: 'ERA', name: 'Earned Run Average', higherIsBetter: false, isDisplayOnly: false },
  ]

  it('parses at-bats out of the H/AB display stat', () => {
    const stats = {
      [statKey('batting', 60)]: '137/528',
      [statKey('batting', 7)]: '94',
      [statKey('batting', 12)]: '37',
      [statKey('batting', 3)]: '.259',
    }
    const line = statLineToSeasonLine('batting', stats, categories)
    expect(line.batting).toEqual({ ab: 528, r: 94, hr: 37, rbi: 0, sb: 0, avg: 0.259, obp: 0 })
    expect(line.pitching).toBeNull()
  })

  it('parses thirds-notation innings for pitchers', () => {
    const stats = {
      [statKey('pitching', 50)]: '85.2',
      [statKey('pitching', 26)]: '3.45',
    }
    const line = statLineToSeasonLine('pitching', stats, categories)
    expect(line.pitching?.ip).toBeCloseTo(85.667, 3)
    expect(line.pitching?.era).toBe(3.45)
    expect(line.batting).toBeNull()
  })
})
