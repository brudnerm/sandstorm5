/**
 * Weekly-record ranking.
 *
 * The rules pinned down here are the ones that would silently produce a wrong
 * record book: counting a consolation week, comparing a fourteen-day week
 * with a normal one, ranking a rate category the wrong way round, letting a
 * nine-inning shutout stand as the best earned-run average, and presenting an
 * arbitrary five of a two-hundred-way tie as if it were a top five.
 */
import { describe, expect, it } from 'vitest'
import {
  QUALIFIERS, eligible, isRate, leaderboard, qualifierLabel, valueFor,
  type TeamWeek,
} from '../src/domain/records'

let seq = 0
function tw(over: Partial<TeamWeek> = {}): TeamWeek {
  seq++
  return {
    season: 2020, week: seq, ownerIndex: 0, days: 7, bracket: 'regular',
    values: { HR: 10, ERA: 3.5, AVG: 0.28 }, ab: 200, ip: 50, completedGames: 60,
    ...over,
  }
}

describe('eligibility', () => {
  it('never counts a consolation week', () => {
    const weeks = [tw({ bracket: 'regular' }), tw({ bracket: 'consolation' }), tw({ bracket: 'championship' }), tw({ bracket: 'placement' })]
    const brackets = eligible(weeks, 'HR', 'all').map(w => w.bracket)
    expect(brackets).toEqual(['regular', 'championship', 'placement'])
  })

  it('keeps only seven-day weeks in standard mode, and all of them in all mode', () => {
    const weeks = [tw({ days: 7 }), tw({ days: 14 }), tw({ days: 5 })]
    expect(eligible(weeks, 'HR', 'standard').map(w => w.days)).toEqual([7])
    expect(eligible(weeks, 'HR', 'all').map(w => w.days)).toEqual([7, 14, 5])
  })

  it('drops rate categories from per-day mode entirely', () => {
    const weeks = [tw()]
    expect(eligible(weeks, 'HR', 'perDay')).toHaveLength(1)
    expect(eligible(weeks, 'ERA', 'perDay')).toHaveLength(0)
    expect(isRate('ERA')).toBe(true)
    expect(isRate('HR')).toBe(false)
  })

  it('skips a team-week with no value for the category', () => {
    const weeks = [tw({ values: { HR: null } }), tw({ values: { HR: 4 } })]
    expect(eligible(weeks, 'HR', 'all')).toHaveLength(1)
  })
})

describe('qualifiers', () => {
  it('holds ERA and WHIP to a minimum innings count', () => {
    expect(QUALIFIERS['ERA']!.minIp).toBe(25)
    const weeks = [tw({ ip: 9, values: { ERA: 0 } }), tw({ ip: 40, values: { ERA: 2.1 } })]
    const board = leaderboard(weeks, 'ERA', 'all', false, 'best', 5)
    // The nine-inning shutout is not a record.
    expect(board.rows).toHaveLength(1)
    expect(board.rows[0]!.value).toBe(2.1)
  })

  it('rejects a week with no innings at all rather than treating it as zero', () => {
    const weeks = [tw({ ip: null, values: { ERA: 0 } })]
    expect(eligible(weeks, 'ERA', 'all')).toHaveLength(0)
  })

  it('holds AVG and OBP to a minimum at-bat count', () => {
    const weeks = [tw({ ab: 85, values: { AVG: 0.45 } }), tw({ ab: 200, values: { AVG: 0.31 } })]
    const board = leaderboard(weeks, 'AVG', 'all', true, 'best', 5)
    expect(board.rows).toHaveLength(1)
    expect(board.rows[0]!.value).toBeCloseTo(0.31)
  })

  it('leaves a counting category unqualified', () => {
    expect(qualifierLabel('HR')).toBeNull()
    expect(qualifierLabel('ERA')).toBe('Minimum 25 innings pitched')
    expect(qualifierLabel('AVG')).toBe('Minimum 150 at-bats')
  })
})

describe('direction', () => {
  const weeks = [
    tw({ ip: 40, values: { ERA: 1.0 } }),
    tw({ ip: 40, values: { ERA: 5.0 } }),
    tw({ ip: 40, values: { ERA: 3.0 } }),
  ]

  it('ranks a lower-is-better category so that best is lowest', () => {
    const best = leaderboard(weeks, 'ERA', 'all', false, 'best', 5)
    expect(best.rows.map(r => r.value)).toEqual([1, 3, 5])
  })

  it('makes the worst list of a lower-is-better category the highest values', () => {
    const worst = leaderboard(weeks, 'ERA', 'all', false, 'worst', 5)
    expect(worst.rows.map(r => r.value)).toEqual([5, 3, 1])
  })

  it('ranks a higher-is-better category the other way', () => {
    const hr = [tw({ values: { HR: 3 } }), tw({ values: { HR: 9 } })]
    expect(leaderboard(hr, 'HR', 'all', true, 'best', 5).rows.map(r => r.value)).toEqual([9, 3])
    expect(leaderboard(hr, 'HR', 'all', true, 'worst', 5).rows.map(r => r.value)).toEqual([3, 9])
  })
})

describe('per-day mode', () => {
  it('divides a counting category by the length of the week', () => {
    const long = tw({ days: 14, values: { HR: 21 } })
    const short = tw({ days: 7, values: { HR: 14 } })
    expect(valueFor(long, 'HR', 'perDay')).toBeCloseTo(1.5)
    expect(valueFor(short, 'HR', 'perDay')).toBeCloseTo(2)
    // The long week wins outright on the raw total and loses per day.
    expect(leaderboard([long, short], 'HR', 'all', true, 'best', 5).rows[0]!.teamWeek.days).toBe(14)
    expect(leaderboard([long, short], 'HR', 'perDay', true, 'best', 5).rows[0]!.teamWeek.days).toBe(7)
  })
})

describe('ties', () => {
  const tied = [
    tw({ season: 2019, week: 5, values: { HR: 0 } }),
    tw({ season: 2012, week: 3, values: { HR: 0 } }),
    tw({ season: 2015, week: 9, values: { HR: 0 } }),
    tw({ season: 2021, week: 1, values: { HR: 0 } }),
    tw({ season: 2011, week: 7, values: { HR: 0 } }),
    tw({ season: 2024, week: 2, values: { HR: 0 } }),
    tw({ season: 2009, week: 4, values: { HR: 2 } }),
  ]

  it('gives tied team-weeks the same rank', () => {
    const board = leaderboard(tied, 'HR', 'all', true, 'worst', 5)
    expect(board.rows.map(r => r.rank)).toEqual([1, 1, 1, 1, 1])
  })

  it('orders a tie oldest first, so the same five come back every time', () => {
    const board = leaderboard(tied, 'HR', 'all', true, 'worst', 5)
    expect(board.rows.map(r => r.teamWeek.season)).toEqual([2011, 2012, 2015, 2019, 2021])
    const again = leaderboard([...tied].reverse(), 'HR', 'all', true, 'worst', 5)
    expect(again.rows.map(r => r.teamWeek.season)).toEqual([2011, 2012, 2015, 2019, 2021])
  })

  it('reports how many share the value at the cut', () => {
    const board = leaderboard(tied, 'HR', 'all', true, 'worst', 5)
    expect(board.tiedAtCut).toBe(6)
  })

  it('reports no tie at the cut when the cut is clean', () => {
    const clean = [tw({ values: { HR: 5 } }), tw({ values: { HR: 4 } }), tw({ values: { HR: 3 } })]
    expect(leaderboard(clean, 'HR', 'all', true, 'best', 2).tiedAtCut).toBe(0)
  })

  it('skips the rank after a tie, as competition ranking does', () => {
    const weeks = [tw({ values: { HR: 9 } }), tw({ values: { HR: 9 } }), tw({ values: { HR: 4 } })]
    expect(leaderboard(weeks, 'HR', 'all', true, 'best', 5).rows.map(r => r.rank)).toEqual([1, 1, 3])
  })
})

describe('pool reporting', () => {
  it('reports the seasons the pool actually covers', () => {
    const weeks = [
      tw({ season: 2023, ab: 200, values: { AVG: 0.3 } }),
      tw({ season: 2026, ab: 200, values: { AVG: 0.29 } }),
      tw({ season: 2011, ab: null, values: { AVG: 0.4 } }),
    ]
    const board = leaderboard(weeks, 'AVG', 'all', true, 'best', 5)
    // 2011 has no at-bat count, so it cannot qualify and is not in the span.
    expect(board.seasons).toEqual([2023, 2026])
    expect(board.pool).toBe(2)
  })
})
