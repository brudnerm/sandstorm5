/**
 * Injury stint derivation against small hand-built weekly roster fixtures.
 */
import { describe, expect, it } from 'vitest'
import {
  deriveInjuryStints,
  isInjuredStatus,
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

describe('deriveInjuryStints', () => {
  const KEY = '469.l.1.p.1'

  it('merges a drop-and-reappear on another team into one stint', () => {
    // Week 1-2: hurt on Team A. Week 3: dropped (no team rosters him).
    // Week 4: picked up by Team B, still hurt. Week 5: activated on Team B.
    const weeks: WeekSnapshot[] = [
      week(1, { A: [player({ playerKey: KEY, status: 'IL10' })] }),
      week(2, { A: [player({ playerKey: KEY, status: 'IL10' })] }),
      week(4, { B: [player({ playerKey: KEY, status: 'IL10' })] }),
      week(5, { B: [player({ playerKey: KEY, status: null })] }),
    ]

    const stints = deriveInjuryStints(weeks)
    expect(stints).toHaveLength(1)
    const stint = stints[0]!
    expect(stint.playerKey).toBe(KEY)
    expect(stint.teamKey).toBe('A')
    expect(stint.firstWeek).toBe(1)
    expect(stint.lastWeek).toBe(4)
    expect(stint.status).toBe('IL10')
    expect(stint.dropped).toBe(true)
    expect(stint.traded).toBe(false)
    expect(stint.weeksRosteredAfter).toBe(1)
  })

  it('flags a same-week team change with no gap as a trade, not a drop', () => {
    const weeks: WeekSnapshot[] = [
      week(1, { A: [player({ playerKey: KEY, status: 'IL10' })] }),
      week(2, { B: [player({ playerKey: KEY, status: 'IL10' })] }),
      week(3, { B: [player({ playerKey: KEY, status: null })] }),
    ]
    const stints = deriveInjuryStints(weeks)
    expect(stints).toHaveLength(1)
    expect(stints[0]!.dropped).toBe(false)
    expect(stints[0]!.traded).toBe(true)
    expect(stints[0]!.lastWeek).toBe(2)
  })

  it('leaves lastWeek null when the stint is still open at the latest snapshot', () => {
    const weeks: WeekSnapshot[] = [
      week(1, { A: [player({ playerKey: KEY, status: null })] }),
      week(2, { A: [player({ playerKey: KEY, status: 'IL60' })] }),
      week(3, { A: [player({ playerKey: KEY, status: 'IL60' })] }),
    ]
    const stints = deriveInjuryStints(weeks)
    expect(stints).toHaveLength(1)
    expect(stints[0]!.firstWeek).toBe(2)
    expect(stints[0]!.lastWeek).toBeNull()
    expect(stints[0]!.weeksRosteredBefore).toBe(1)
    expect(stints[0]!.weeksRosteredAfter).toBe(0)
  })

  it('produces two separate stints for two distinct injuries', () => {
    const weeks: WeekSnapshot[] = [
      week(1, { A: [player({ playerKey: KEY, status: 'DTD' })] }),
      week(2, { A: [player({ playerKey: KEY, status: 'IL10' })] }),
      week(3, { A: [player({ playerKey: KEY, status: null })] }),
      week(4, { A: [player({ playerKey: KEY, status: null })] }),
      week(5, { A: [player({ playerKey: KEY, status: 'IL15' })] }),
    ]
    const stints = deriveInjuryStints(weeks)
    expect(stints).toHaveLength(2)
    expect(stints[0]!.firstWeek).toBe(2)
    expect(stints[0]!.lastWeek).toBe(2)
    expect(stints[1]!.firstWeek).toBe(5)
    expect(stints[1]!.lastWeek).toBeNull()
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
