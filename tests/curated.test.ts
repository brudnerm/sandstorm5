/**
 * Curated content.
 *
 * The whole point of these entries is that they record what the data cannot,
 * so the guard rails matter more than usual. A curated entry may be
 * hand-written but it may not be wrong: a cited statistic is checked against
 * the stored record and a mismatch fails the build. Drafts must not reach
 * the live site, and a keeper claim is cross-checked wherever the draft data
 * can speak to it.
 */
import { describe, expect, it } from 'vitest'
import {
  validateCurated, visibleCurated, yearsKept,
  type CuratedShard,
} from '../src/domain/curated'
import type { SeasonsShard, TrophySeason, WeeklyShard } from '../src/domain/trophy'

function season(year: number): TrophySeason {
  return {
    season: year, leagueKey: `x.l.${year}`, numTeams: 2, categories: [], statOrder: ['HR'],
    hasAtBats: false, weeks: [], regularSeasonWeeks: [1], playoffWeeks: [],
    playoffStartWeek: null, numPlayoffTeams: null, standings: [],
    seedSource: 'yahoo-playoff-seed', tiebreak: 'head-to-head',
    champion: null, runnerUp: null, lastPlace: null, isFinished: true, retroSlugs: {}, notes: [],
  }
}

const shard: SeasonsShard = {
  leagueId: 'kp',
  owners: ['ann', 'bob'].map(id => ({
    id, displayName: id.toUpperCase(), firstSeason: 2024, lastSeason: 2026,
    seasonsPlayed: 3, teamNames: {},
  })),
  weeklyColumns: [], matchupColumns: [],
  seasons: [season(2024), season(2025), season(2026)],
}

/** ann had 20 home runs in week 24 of 2026; bob had 6. */
const weekly: WeeklyShard = {
  leagueId: 'kp',
  columns: ['season', 'week', 'owner', 'days', 'bracket', 'HR', 'ab', 'ip', 'completedGames'],
  rows: [
    [2026, 24, 0, 7, 1, 20, 200, 50, 90],
    [2026, 24, 1, 7, 1, 6, 200, 50, 90],
  ],
}

const empty: CuratedShard = { leagueId: 'kp', vetoes: [], keepers: [], plaques: [] }

const plaque = (over: Record<string, unknown> = {}) => ({
  id: 'p1', status: 'draft' as const, source: 'confirmed' as const,
  title: 'A plaque', season: 2026, week: 24, ownerId: 'ann', description: 'Something happened.',
  evidence: { kind: 'team-week' as const, season: 2026, week: 24, ownerId: 'ann', category: 'HR', value: 20 },
  ...over,
})

describe('cited statistics', () => {
  it('accepts a plaque whose figure matches the record', () => {
    const curated = { ...empty, plaques: [plaque()] }
    expect(validateCurated(curated, shard, weekly)).toEqual([])
  })

  it('fatally rejects a plaque whose figure does not match', () => {
    const curated = { ...empty, plaques: [plaque({ evidence: { ...plaque().evidence, value: 21 } })] }
    const problems = validateCurated(curated, shard, weekly)
    expect(problems).toHaveLength(1)
    expect(problems[0]!.fatal).toBe(true)
    expect(problems[0]!.problem).toContain('claims HR 21 but the record says 20')
  })

  it('rejects a citation to a team-week that does not exist', () => {
    const curated = { ...empty, plaques: [plaque({ evidence: { ...plaque().evidence, week: 9 } })] }
    const problems = validateCurated(curated, shard, weekly)
    expect(problems[0]!.fatal).toBe(true)
    expect(problems[0]!.problem).toContain('no team-week')
  })

  it('rejects a citation to a category that does not exist', () => {
    const curated = { ...empty, plaques: [plaque({ evidence: { ...plaque().evidence, category: 'XYZ' } })] }
    expect(validateCurated(curated, shard, weekly)[0]!.problem).toContain('unknown category')
  })

  it('catches a plaque crediting the wrong owner', () => {
    // bob hit six, not twenty, so crediting bob with the record must fail.
    const curated = {
      ...empty,
      plaques: [plaque({ ownerId: 'bob', evidence: { ...plaque().evidence, ownerId: 'bob' } })],
    }
    expect(validateCurated(curated, shard, weekly)[0]!.problem).toContain('the record says 6')
  })

  it('accepts a plaque with no citation at all', () => {
    const curated = { ...empty, plaques: [plaque({ evidence: null })] }
    expect(validateCurated(curated, shard, weekly)).toEqual([])
  })
})

describe('identity and dates', () => {
  it('rejects an unknown owner anywhere', () => {
    const curated = { ...empty, plaques: [plaque({ ownerId: 'nobody', evidence: null })] }
    expect(validateCurated(curated, shard, weekly)[0]!.problem).toContain('unknown owner')
  })

  it('rejects a season the league never played', () => {
    const curated = { ...empty, plaques: [plaque({ season: 1998, evidence: null })] }
    expect(validateCurated(curated, shard, weekly)[0]!.problem).toContain('not in the record')
  })

  it('rejects a keeper span that ends before it starts', () => {
    const curated = {
      ...empty,
      keepers: [{
        id: 'k1', status: 'draft' as const, source: 'reported' as const,
        ownerId: 'ann', playerName: 'Someone', fromSeason: 2026, toSeason: 2024,
      }],
    }
    expect(validateCurated(curated, shard, weekly).some(p => p.fatal)).toBe(true)
  })
})

describe('keeper cross-check', () => {
  const keeper = {
    id: 'k1', status: 'draft' as const, source: 'reported' as const,
    ownerId: 'ann', playerName: 'Kept Player', fromSeason: 2024, toSeason: 2026,
  }

  it('says nothing when the draft data agrees', () => {
    const derived = [2024, 2025, 2026].map(s => ({ season: s, ownerId: 'ann', playerName: 'Kept Player' }))
    expect(validateCurated({ ...empty, keepers: [keeper] }, shard, weekly, derived)).toEqual([])
  })

  it('reports, without failing, a season the draft data contradicts', () => {
    // The data covers all three seasons but only lists the player in two.
    const derived = [
      { season: 2024, ownerId: 'ann', playerName: 'Kept Player' },
      { season: 2025, ownerId: 'ann', playerName: 'Someone Else' },
      { season: 2026, ownerId: 'ann', playerName: 'Kept Player' },
    ]
    const problems = validateCurated({ ...empty, keepers: [keeper] }, shard, weekly, derived)
    expect(problems).toHaveLength(1)
    expect(problems[0]!.fatal).toBe(false)
    expect(problems[0]!.problem).toContain('2025')
  })

  it('stays silent about seasons the draft data cannot speak to', () => {
    // Keepers are only derivable from 2015 on; 2024 here stands in for a
    // season with no keeper data at all.
    const derived = [{ season: 2026, ownerId: 'ann', playerName: 'Kept Player' }]
    const problems = validateCurated({ ...empty, keepers: [keeper] }, shard, weekly, derived)
    expect(problems).toEqual([])
  })
})

describe('publication', () => {
  const curated: CuratedShard = {
    leagueId: 'kp',
    vetoes: [{
      id: 'v1', status: 'approved', source: 'confirmed', season: 2024,
      proposedBy: ['ann'], players: [], vote: null, outcome: 'vetoed', description: 'x',
    }],
    keepers: [{
      id: 'k1', status: 'draft', source: 'reported',
      ownerId: 'ann', playerName: 'Someone', fromSeason: 2024, toSeason: 2025,
    }],
    plaques: [plaque()],
  }

  it('publishes only approved entries', () => {
    const live = visibleCurated(curated, false)
    expect(live.vetoes).toHaveLength(1)
    expect(live.keepers).toHaveLength(0)
    expect(live.plaques).toHaveLength(0)
  })

  it('shows drafts when they are explicitly allowed', () => {
    const preview = visibleCurated(curated, true)
    expect(preview.keepers).toHaveLength(1)
    expect(preview.plaques).toHaveLength(1)
  })
})

describe('yearsKept', () => {
  it('counts both end seasons', () => {
    expect(yearsKept({
      id: 'k', status: 'draft', source: 'reported',
      ownerId: 'ann', playerName: 'x', fromSeason: 2016, toSeason: 2020,
    })).toBe(5)
  })
})
