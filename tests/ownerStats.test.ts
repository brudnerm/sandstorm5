/**
 * All-time standings and the head-to-head matrix.
 *
 * The load-bearing property is that these two agree. They are computed from
 * different things — the standings from per-season outcome totals, the matrix
 * by summing category results out of every matchup — so if they reconcile,
 * both are right. Getting the set of counted seasons wrong is what breaks it,
 * and that is the first thing pinned down here.
 */
import { describe, expect, it } from 'vitest'
import {
  allTimeStandings, formatPct, headToHead, mostLopsided, reconcile,
  regularSeasonComplete, winPct,
} from '../src/domain/ownerStats'
import { BRACKET_CODES, type MatchupShard, type SeasonsShard, type TrophySeason } from '../src/domain/trophy'

const CATS = ['R', 'HR', 'RBI', 'SB']  // four categories keeps the fixtures readable

const standing = (ownerId: string, seed: number, w: number, l: number, t: number, pct = '.500') =>
  ({ ownerId, teamName: `${ownerId} team`, seed, wins: w, losses: l, ties: t, percentage: pct })

function season(year: number, over: Partial<TrophySeason> = {}): TrophySeason {
  return {
    season: year, leagueKey: `x.l.${year}`, numTeams: 2,
    categories: CATS.map((abbr, i) => ({
      statId: i, role: 'batting' as const, abbr, name: abbr,
      higherIsBetter: true, isDisplayOnly: false,
    })),
    statOrder: CATS, hasAtBats: false, weeks: [],
    regularSeasonWeeks: [1], playoffWeeks: [2], playoffStartWeek: 2, numPlayoffTeams: 1,
    standings: [], seedSource: 'yahoo-playoff-seed', tiebreak: 'head-to-head',
    champion: null, runnerUp: null, lastPlace: null, isFinished: true, retroSlugs: {}, notes: [],
    ...over,
  }
}

function shardOf(seasons: TrophySeason[]): SeasonsShard {
  return {
    leagueId: 'kp',
    owners: ['ann', 'bob'].map(id => ({
      id, displayName: id.toUpperCase(), firstSeason: 2024, lastSeason: 2025,
      seasonsPlayed: 2, teamNames: { '2024': `${id} 24`, '2025': `${id} 25` },
    })),
    weeklyColumns: [], matchupColumns: [], seasons,
  }
}

function matchupsOf(rows: Array<[number, number, string, keyof typeof BRACKET_CODES]>): MatchupShard {
  return {
    leagueId: 'kp',
    columns: ['season', 'week', 'ownerA', 'ownerB', 'bracket', 'results', 'winner'],
    rows: rows.map(([s, w, results, bracket]) => [s, w, 0, 1, BRACKET_CODES[bracket], results, 0]),
  }
}

describe('winPct', () => {
  it('counts a tie as half a win, as Yahoo does', () => {
    expect(winPct(146, 86, 20)).toBeCloseTo(0.619, 3)
    expect(winPct(1, 1, 0)).toBe(0.5)
    expect(winPct(0, 0, 0)).toBe(0)
  })
  it('formats without a leading zero', () => {
    expect(formatPct(0.571)).toBe('.571')
    expect(formatPct(1)).toBe('1.000')
  })
})

describe('which seasons count', () => {
  const complete = season(2025, { standings: [standing('ann', 1, 3, 1, 0), standing('bob', 2, 1, 3, 0)] })
  const partial = season(2026, { standings: [standing('ann', 1, 2, 0, 0), standing('bob', 2, 0, 2, 0)] })

  it('counts a season whose regular season is arithmetically complete', () => {
    // Four categories over one regular-season week is four decisions.
    expect(regularSeasonComplete(complete)).toBe(true)
  })

  it('excludes a season still in progress, whatever the finished flag says', () => {
    expect(regularSeasonComplete(partial)).toBe(false)
    expect(regularSeasonComplete({ ...partial, isFinished: true })).toBe(false)
  })

  it('counts an unfinished season once its regular season is over', () => {
    // This is the case that broke reconciliation: Yahoo leaves is_finished
    // false until the playoffs end, but the regular season is already final.
    const playoffsOngoing = { ...complete, isFinished: false }
    expect(regularSeasonComplete(playoffsOngoing)).toBe(true)
    const rows = allTimeStandings(shardOf([playoffsOngoing]))
    expect(rows.find(r => r.ownerId === 'ann')!.wins).toBe(3)
  })

  it('does not award honours from a season that has not finished', () => {
    const ongoing = {
      ...complete, isFinished: false,
      champion: { ownerId: 'ann', teamName: 'ann team' },
      lastPlace: { ownerId: 'bob', teamName: 'bob team' },
    }
    const rows = allTimeStandings(shardOf([ongoing]))
    expect(rows.find(r => r.ownerId === 'ann')!.titles).toBe(0)
    expect(rows.find(r => r.ownerId === 'bob')!.lastPlaces).toBe(0)
  })
})

describe('allTimeStandings', () => {
  const seasons = [
    season(2024, {
      standings: [standing('ann', 1, 3, 1, 0), standing('bob', 2, 1, 3, 0)],
      champion: { ownerId: 'ann', teamName: 'ann team' },
      runnerUp: { ownerId: 'bob', teamName: 'bob team' },
      lastPlace: { ownerId: 'bob', teamName: 'bob team' },
    }),
    season(2025, {
      standings: [standing('bob', 1, 4, 0, 0), standing('ann', 2, 0, 4, 0)],
      champion: { ownerId: 'bob', teamName: 'bob team' },
      lastPlace: { ownerId: 'ann', teamName: 'ann team' },
    }),
  ]
  const rows = allTimeStandings(shardOf(seasons))
  const ann = rows.find(r => r.ownerId === 'ann')!
  const bob = rows.find(r => r.ownerId === 'bob')!

  it('sums the regular-season record across seasons', () => {
    expect([ann.wins, ann.losses, ann.ties]).toEqual([3, 5, 0])
    expect([bob.wins, bob.losses, bob.ties]).toEqual([5, 3, 0])
  })

  it('counts honours and playoff appearances', () => {
    expect(ann.titles).toBe(1)
    expect(bob.titles).toBe(1)
    expect(bob.runnerUps).toBe(1)
    expect(ann.lastPlaces).toBe(1)
    // One playoff place per season, to whoever finished first.
    expect(ann.playoffAppearances).toBe(1)
    expect(bob.playoffAppearances).toBe(1)
  })

  it('averages the finishing position, where lower is better', () => {
    expect(ann.averageFinish).toBe(1.5)
    expect(ann.bestFinish).toBe(1)
  })
})

describe('headToHead', () => {
  // The standings must match the arithmetic of one regular-season week over
  // four categories, or the season is not counted and the matrix is empty.
  const seasons = [season(2024, { standings: [standing('ann', 1, 3, 1, 0), standing('bob', 2, 1, 3, 0)] })]
  const shard = shardOf(seasons)

  it('keeps regular season and playoffs apart', () => {
    const m = matchupsOf([
      [2024, 1, 'WWWL', 'regular'],
      [2024, 2, 'LLLL', 'championship'],
    ])
    const reg = headToHead(shard, m, 'regular').get('ann', 'bob')!
    expect([reg.wins, reg.losses, reg.meetings]).toEqual([3, 1, 1])
    const po = headToHead(shard, m, 'playoffs').get('ann', 'bob')!
    expect([po.wins, po.losses, po.meetings]).toEqual([0, 4, 1])
  })

  it('counts a placement game as a playoff meeting', () => {
    const m = matchupsOf([[2024, 2, 'WWLL', 'placement']])
    expect(headToHead(shard, m, 'playoffs').get('ann', 'bob')!.meetings).toBe(1)
  })

  it('never counts a consolation game', () => {
    const m = matchupsOf([[2024, 2, 'WWWW', 'consolation']])
    expect(headToHead(shard, m, 'playoffs').get('ann', 'bob')).toBeNull()
    expect(headToHead(shard, m, 'regular').get('ann', 'bob')).toBeNull()
  })

  it('mirrors the record for the opposing owner', () => {
    const m = matchupsOf([[2024, 1, 'WWWT', 'regular']])
    const matrix = headToHead(shard, m, 'regular')
    expect(matrix.get('ann', 'bob')).toMatchObject({ wins: 3, losses: 0, ties: 1 })
    expect(matrix.get('bob', 'ann')).toMatchObject({ wins: 0, losses: 3, ties: 1 })
  })

  it('returns nothing for a pair that has never met', () => {
    expect(headToHead(shard, matchupsOf([]), 'regular').get('ann', 'bob')).toBeNull()
  })
})

describe('mostLopsided', () => {
  const seasons = [season(2024, { standings: [standing('ann', 1, 4, 0, 0), standing('bob', 2, 0, 4, 0)] })]
  const shard = shardOf(seasons)

  it('ignores a one-sided result from too few meetings', () => {
    const m = headToHead(shard, matchupsOf([[2024, 1, 'WWWW', 'regular']]), 'regular')
    expect(mostLopsided(m, 5)).toBeNull()
    expect(mostLopsided(m, 1)).not.toBeNull()
  })

  it('names the dominant owner first, whichever way the pair is stored', () => {
    // bob wins every category, but ann is stored as owner A.
    const m = headToHead(shard, matchupsOf([
      [2024, 1, 'LLLL', 'regular'], [2024, 2, 'LLLL', 'regular'],
    ]), 'regular')
    const r = mostLopsided(m, 2)!
    expect(r.a).toBe('bob')
    expect(r.record.wins).toBe(8)
  })
})

describe('reconcile', () => {
  it('passes when the matrix sums to the standings', () => {
    const seasons = [season(2024, { standings: [standing('ann', 1, 3, 1, 0), standing('bob', 2, 1, 3, 0)] })]
    const m = matchupsOf([[2024, 1, 'WWWL', 'regular']])
    expect(reconcile(shardOf(seasons), m).ok).toBe(true)
  })

  it('fails loudly when a matchup is missing from the matrix', () => {
    const seasons = [season(2024, {
      regularSeasonWeeks: [1, 2],
      standings: [standing('ann', 1, 6, 2, 0), standing('bob', 2, 2, 6, 0)],
    })]
    // Only one of the two weeks is present, so the matrix is short.
    const m = matchupsOf([[2024, 1, 'WWWL', 'regular']])
    const result = reconcile(shardOf(seasons), m)
    expect(result.ok).toBe(false)
    expect(result.rows.find(r => r.ownerId === 'ann')!.matrix.wins).toBe(3)
  })
})
