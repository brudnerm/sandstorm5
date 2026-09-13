/**
 * Draft evaluation against fixtures small enough to check by hand.
 *
 * The isotonic tests use bare number sequences; the pool tests use a
 * six-pick draft whose means and deviations are round numbers, so every
 * expectation below is arithmetic you can redo on paper.
 */
import { describe, expect, it } from 'vitest'
import {
  evaluateDraft,
  gradeFromZ,
  isotonicNonIncreasing,
  mean,
  percentile,
  seasonLine,
  stdev,
} from '../app/lib/draftEval.js'
import { parseInnings, type DraftPick, type DraftShard } from '../src/domain/draft.js'

describe('isotonicNonIncreasing', () => {
  it('leaves an already-descending sequence untouched', () => {
    expect(isotonicNonIncreasing([5, 4, 3, 2, 1])).toEqual([5, 4, 3, 2, 1])
  })

  it('averages a single adjacent violation', () => {
    // 3 then 5 violates; they pool to 4 each, which still sits below 6.
    expect(isotonicNonIncreasing([6, 3, 5, 1])).toEqual([6, 4, 4, 1])
  })

  it('flattens a strictly increasing sequence to its mean', () => {
    expect(isotonicNonIncreasing([1, 2, 3, 4])).toEqual([2.5, 2.5, 2.5, 2.5])
  })

  it('cascades merges when pooling creates a new violation', () => {
    // [10, 1, 2, 9]: 1&2 pool to 1.5; 9 then pools with them to 4.
    expect(isotonicNonIncreasing([10, 1, 2, 9])).toEqual([10, 4, 4, 4])
  })

  it('preserves the sum, so the fit is unbiased', () => {
    const input = [3, 1, 4, 1, 5, 9, 2, 6]
    const fit = isotonicNonIncreasing(input)
    expect(mean(fit) * fit.length).toBeCloseTo(mean(input) * input.length, 10)
  })

  it('produces a non-increasing result for a noisy descent', () => {
    const fit = isotonicNonIncreasing([9, 7, 8, 6, 7, 2, 3, 1])
    for (let i = 1; i < fit.length; i++) {
      expect(fit[i]!).toBeLessThanOrEqual(fit[i - 1]!)
    }
  })

  it('handles the degenerate sizes', () => {
    expect(isotonicNonIncreasing([])).toEqual([])
    expect(isotonicNonIncreasing([7])).toEqual([7])
  })
})

describe('percentile', () => {
  it('returns the min and max at the ends', () => {
    const values = [4, 1, 3, 2]
    expect(percentile(values, 0)).toBe(1)
    expect(percentile(values, 100)).toBe(4)
  })

  it('interpolates between samples', () => {
    // Sorted [0,10,20,30,40]: rank = 0.5 * 4 = 2 → exactly 20.
    expect(percentile([0, 10, 20, 30, 40], 50)).toBe(20)
    // rank = 0.15 * 4 = 0.6 → 0 + 0.6 * 10.
    expect(percentile([0, 10, 20, 30, 40], 15)).toBeCloseTo(6, 10)
  })
})

describe('parseInnings', () => {
  it('reads thirds notation rather than decimals', () => {
    expect(parseInnings('85.2')).toBeCloseTo(85.667, 3)
    expect(parseInnings('43.0')).toBe(43)
    expect(parseInnings('0.1')).toBeCloseTo(0.333, 3)
  })

  it('is zero for missing or unparseable values', () => {
    expect(parseInnings('')).toBe(0)
    expect(parseInnings(null)).toBe(0)
    expect(parseInnings(undefined)).toBe(0)
  })
})

// ── A six-pick draft with hand-picked numbers ─────────────────────────

function hitter(
  overall: number,
  teamKey: string,
  name: string,
  hr: number,
  ab: number,
  avg: number,
  keeper = false,
): DraftPick {
  return {
    round: Math.ceil(overall / 2),
    overall,
    teamKey,
    playerKey: `p.${overall}`,
    name,
    position: 'OF',
    role: 'batting',
    mlbTeam: 'DET',
    keeper,
    mlbamId: overall,
    // R/RBI/SB/OBP held constant so only HR and AVG move the value.
    batting: { ab, r: 50, hr, rbi: 50, sb: 5, avg, obp: 0.33 },
    pitching: null,
  }
}

function shardOf(picks: DraftPick[]): DraftShard {
  return {
    leagueId: 'test',
    leagueKey: '469.l.1',
    season: '2026',
    picks,
    mlbamByName: {},
    unmatched: [],
  }
}

describe('z-score pool', () => {
  // HR: 30, 20, 10 → mean 20, population sd 8.16497.
  // Every hitter has the same AB, so each AVG weight is exactly 1.
  const picks = [
    hitter(1, 'T1', 'Ace', 30, 500, 0.3),
    hitter(2, 'T2', 'Mid', 20, 500, 0.3),
    hitter(3, 'T1', 'Bust', 10, 500, 0.3),
  ]
  const evaluation = evaluateDraft(shardOf(picks))
  const all = evaluation.teams.flatMap(t => t.picks)
  const byName = new Map(all.map(e => [e.pick.name, e]))

  it('scores only the categories that vary, and scores them symmetrically', () => {
    // AVG/R/RBI/SB/OBP are identical across the pool, so sd = 0 and they
    // contribute nothing. Value is the HR z-score alone.
    const sd = stdev([30, 20, 10])
    expect(byName.get('Ace')!.value).toBeCloseTo(10 / sd, 10)
    expect(byName.get('Mid')!.value).toBeCloseTo(0, 10)
    expect(byName.get('Bust')!.value).toBeCloseTo(-10 / sd, 10)
  })

  it('measures VAR against the 15th percentile of the pool', () => {
    const sd = stdev([30, 20, 10])
    const values = [-10 / sd, 0, 10 / sd]
    const replacement = percentile(values, 15)
    expect(evaluation.replacement.batting).toBeCloseTo(replacement, 10)
    expect(byName.get('Ace')!.var).toBeCloseTo(10 / sd - replacement, 10)
  })

  it('keeps hitters and pitchers in separate pools', () => {
    const pitcher: DraftPick = {
      round: 2, overall: 4, teamKey: 'T2', playerKey: 'p.4', name: 'Arm',
      position: 'SP', role: 'pitching', mlbTeam: 'KC', keeper: false,
      mlbamId: 4, batting: null,
      pitching: { ip: 200, w: 15, l: 5, sv: 0, k: 220, era: 3, whip: 1 },
    }
    const withPitcher = evaluateDraft(shardOf([...picks, pitcher]))
    const hitterValues = withPitcher.teams
      .flatMap(t => t.picks)
      .filter(e => e.pick.role === 'batting')
      .map(e => e.value)
    // Adding a pitcher must not disturb the hitters' pool at all.
    expect(hitterValues.sort()).toEqual(all.map(e => e.value).sort())
    // A lone pitcher has zero variance in his own pool, so zero value.
    const arm = withPitcher.teams.flatMap(t => t.picks).find(e => e.pick.name === 'Arm')!
    expect(arm.value).toBeCloseTo(0, 10)
  })
})

describe('rate-stat weighting', () => {
  it('scales a rate by volume against the pool average', () => {
    // Two .300 hitters at 600 AB and one at 300 AB, versus a .200 hitter.
    // Mean AB among players who played is 500, so weights are 1.2/1.2/0.6.
    const picks = [
      hitter(1, 'T1', 'Full', 20, 600, 0.3),
      hitter(2, 'T1', 'AlsoFull', 20, 600, 0.3),
      hitter(3, 'T2', 'Part', 20, 300, 0.3),
      hitter(4, 'T2', 'Poor', 20, 500, 0.2),
    ]
    const evaluation = evaluateDraft(shardOf(picks))
    const byName = new Map(
      evaluation.teams.flatMap(t => t.picks).map(e => [e.pick.name, e]),
    )
    const sd = stdev([0.3, 0.3, 0.3, 0.2])
    const z = (0.3 - mean([0.3, 0.3, 0.3, 0.2])) / sd
    // Same average, half the at-bats, half the credit.
    expect(byName.get('Full')!.value).toBeCloseTo(z * (600 / 500), 10)
    expect(byName.get('Part')!.value).toBeCloseTo(z * (300 / 500), 10)
    expect(byName.get('Part')!.value).toBeCloseTo(byName.get('Full')!.value / 2, 10)
  })

  it('gives a player who never played no rate credit, but a real zero for counting stats', () => {
    const absent = hitter(4, 'T2', 'Absent', 0, 0, 0)
    absent.batting = null
    absent.mlbamId = null
    const evaluation = evaluateDraft(shardOf([
      hitter(1, 'T1', 'Ace', 30, 500, 0.3),
      hitter(2, 'T2', 'Mid', 20, 500, 0.28),
      hitter(3, 'T1', 'Low', 10, 500, 0.26),
      absent,
    ]))
    const all = evaluation.teams.flatMap(t => t.picks)
    const entry = all.find(e => e.pick.name === 'Absent')!
    // His zeroes count against him in HR/R/RBI/SB, so he is the worst in the
    // pool — a missed season is a real cost, not missing data.
    expect(entry.value).toBe(Math.min(...all.map(e => e.value)))

    // Spelled out for the .260 hitter, every term by hand:
    //   HR   over all four: mean 15, so (10 - 15) / sd([30,20,10,0])
    //   R/RBI/SB over all four: mean 37.5, so (50 - 37.5) / sd([50,50,50,0])
    //   AVG  over the three who PLAYED: mean .280, weight 500/500 = 1
    //   OBP  identical for all three who played, so sd 0 and no contribution
    const low = all.find(e => e.pick.name === 'Low')!
    const expected =
      (10 - 15) / stdev([30, 20, 10, 0]) +
      3 * ((50 - 37.5) / stdev([50, 50, 50, 0])) +
      (0.26 - 0.28) / stdev([0.3, 0.28, 0.26])
    expect(low.value).toBeCloseTo(expected, 10)

    // The point of that AVG term: it is negative, because .260 trails the
    // .280 the players who actually batted averaged. Had the absent player's
    // .000 been folded in, the mean would be .210 and .260 would score as
    // ABOVE average — the exact error this guards against.
    expect((0.26 - 0.28) / stdev([0.3, 0.28, 0.26])).toBeLessThan(0)
    expect(0.26 - mean([0.3, 0.28, 0.26, 0])).toBeGreaterThan(0)
  })
})

describe('keepers', () => {
  const picks = [
    hitter(1, 'T1', 'First', 30, 500, 0.3),
    hitter(2, 'T2', 'Second', 25, 500, 0.29),
    hitter(3, 'T1', 'Third', 20, 500, 0.28),
    hitter(4, 'T2', 'Fourth', 15, 500, 0.27),
    hitter(99, 'T1', 'Kept', 40, 500, 0.31, true),
  ]
  const evaluation = evaluateDraft(shardOf(picks))

  it('reports keepers separately and leaves them out of team totals', () => {
    const t1 = evaluation.teams.find(t => t.teamKey === 'T1')!
    expect(t1.picks.map(e => e.pick.name)).toEqual(['First', 'Third'])
    expect(t1.keepers.map(e => e.pick.name)).toEqual(['Kept'])
    expect(t1.picksUsed).toBe(2)
    expect(t1.totalVar).toBeCloseTo(t1.picks.reduce((s, e) => s + e.var, 0), 10)
  })

  it('gives keepers no expected value or surplus', () => {
    const kept = evaluation.teams
      .flatMap(t => t.keepers)
      .find(e => e.pick.name === 'Kept')!
    expect(kept.expected).toBeNull()
    expect(kept.surplus).toBeNull()
    // But they are still valued, and still in the pool that sets the mean.
    expect(kept.var).toBeGreaterThan(0)
  })

  it('excludes keepers from the expected curve', () => {
    // The curve is fitted on four real picks, so it has four points — the
    // kept player's big season must not appear in it.
    const withExpected = evaluation.teams
      .flatMap(t => [...t.picks, ...t.keepers])
      .filter(e => e.expected !== null)
    expect(withExpected).toHaveLength(4)
  })

  it('keeps every real pick out of the best/worst lists when it is a keeper', () => {
    const names = [...evaluation.bestPicks, ...evaluation.worstPicks].map(e => e.pick.name)
    expect(names).not.toContain('Kept')
  })
})

describe('expected curve and surplus', () => {
  it('makes surplus sum to zero across the league', () => {
    // Isotonic regression preserves the total, so total VAR equals total
    // expected — every team's gain is another's loss.
    const picks = [
      hitter(1, 'T1', 'A', 10, 500, 0.25),
      hitter(2, 'T2', 'B', 35, 500, 0.31),
      hitter(3, 'T1', 'C', 25, 500, 0.28),
      hitter(4, 'T2', 'D', 15, 500, 0.26),
      hitter(5, 'T1', 'E', 30, 500, 0.3),
      hitter(6, 'T2', 'F', 5, 500, 0.22),
    ]
    const evaluation = evaluateDraft(shardOf(picks))
    const totalSurplus = evaluation.teams.reduce((s, t) => s + t.surplus, 0)
    expect(totalSurplus).toBeCloseTo(0, 10)
  })

  it('rewards a late pick who outproduced his slot', () => {
    const picks = [
      hitter(1, 'T1', 'Early', 10, 500, 0.24),
      hitter(2, 'T2', 'Mid', 20, 500, 0.27),
      hitter(3, 'T1', 'LateSteal', 40, 500, 0.32),
    ]
    const evaluation = evaluateDraft(shardOf(picks))
    const steal = evaluation.teams
      .flatMap(t => t.picks)
      .find(e => e.pick.name === 'LateSteal')!
    expect(steal.surplus!).toBeGreaterThan(0)
    expect(evaluation.bestPicks[0]!.pick.name).toBe('LateSteal')
  })

  it('fits a non-increasing curve by overall pick', () => {
    const picks = Array.from({ length: 12 }, (_, i) =>
      hitter(i + 1, i % 2 === 0 ? 'T1' : 'T2', `P${i}`, 40 - i * 3, 500, 0.3 - i * 0.005))
    const evaluation = evaluateDraft(shardOf(picks))
    const curve = evaluation.teams
      .flatMap(t => t.picks)
      .sort((a, b) => a.pick.overall - b.pick.overall)
      .map(e => e.expected!)
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!).toBeLessThanOrEqual(curve[i - 1]! + 1e-12)
    }
  })
})

describe('grades', () => {
  it('maps the curve from the top down', () => {
    expect(gradeFromZ(2)).toBe('A+')
    expect(gradeFromZ(1.2)).toBe('A')
    expect(gradeFromZ(0)).toBe('B-')
    expect(gradeFromZ(-0.5)).toBe('C')
    expect(gradeFromZ(-2)).toBe('F')
  })

  it('gives everyone the middle grade when no team stands out', () => {
    // Two teams with identical drafts have zero spread, so neither is graded
    // above the other.
    const picks = [
      hitter(1, 'T1', 'A', 20, 500, 0.28),
      hitter(2, 'T2', 'B', 20, 500, 0.28),
    ]
    const evaluation = evaluateDraft(shardOf(picks))
    expect(evaluation.teams.map(t => t.grade)).toEqual(['B-', 'B-'])
  })
})

describe('seasonLine', () => {
  it('formats a hitter and a pitcher', () => {
    expect(seasonLine(hitter(1, 'T1', 'Bat', 30, 550, 0.301)))
      .toBe('550 AB · 50 R · 30 HR · 50 RBI · 5 SB · .301 AVG · .330 OBP')
    const arm: DraftPick = {
      round: 1, overall: 1, teamKey: 'T1', playerKey: 'p', name: 'Arm',
      position: 'SP', role: 'pitching', mlbTeam: 'KC', keeper: false, mlbamId: 1,
      batting: null,
      pitching: { ip: 155.667, w: 8, l: 8, sv: 0, k: 127, era: 4.1, whip: 1.15 },
    }
    expect(seasonLine(arm)).toBe('155.7 IP · 8-8 · 0 SV · 127 K · 4.10 ERA · 1.15 WHIP')
  })

  it('says so when a player never appeared', () => {
    const absent = hitter(1, 'T1', 'Ghost', 0, 0, 0)
    absent.batting = null
    expect(seasonLine(absent)).toBe('did not play')
  })
})
