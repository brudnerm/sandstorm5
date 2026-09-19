/**
 * Extremes, streaks and archives.
 *
 * The subtle ones here are streaks and name runs. A streak has to carry
 * across seasons, has to be broken by a drawn matchup rather than extended
 * by it, and has to be read from both sides of each matchup. Name runs have
 * to collapse consecutive repeats without merging a name that came back
 * after a gap.
 */
import { describe, expect, it } from 'vitest'
import {
  bestWithoutTitle, closestFinals, fallenChampions, longestStreaks, matchupResults,
  mostLopsidedMatchups, mostTiedMatchups, nameRuns, transactionRecords,
} from '../src/domain/archive'
import {
  BRACKET_CODES, type MatchupShard, type SeasonsShard, type TransactionsShard, type TrophySeason,
} from '../src/domain/trophy'

const OWNERS = ['ann', 'bob', 'cass']
const shardBase = (seasons: TrophySeason[]): SeasonsShard => ({
  leagueId: 'kp',
  owners: OWNERS.map(id => ({
    id, displayName: id.toUpperCase(), firstSeason: 2024, lastSeason: 2025,
    seasonsPlayed: 2, teamNames: {},
  })),
  weeklyColumns: [], matchupColumns: [], seasons,
})

const standing = (ownerId: string, seed: number, w: number, l: number, t: number, pct = '.500') =>
  ({ ownerId, teamName: `${ownerId} team`, seed, wins: w, losses: l, ties: t, percentage: pct })

function season(year: number, over: Partial<TrophySeason> = {}): TrophySeason {
  return {
    season: year, leagueKey: `x.l.${year}`, numTeams: 3, categories: [], statOrder: [],
    hasAtBats: false, weeks: [], regularSeasonWeeks: [1], playoffWeeks: [2],
    playoffStartWeek: 2, numPlayoffTeams: 2, standings: [],
    seedSource: 'yahoo-playoff-seed', tiebreak: 'head-to-head',
    champion: null, runnerUp: null, lastPlace: null, isFinished: true, retroSlugs: {}, notes: [],
    ...over,
  }
}

/** [season, week, aIndex, bIndex, results, bracket] */
function matchupsOf(
  rows: Array<[number, number, number, number, string, keyof typeof BRACKET_CODES]>,
): MatchupShard {
  return {
    leagueId: 'kp',
    columns: ['season', 'week', 'ownerA', 'ownerB', 'bracket', 'results', 'winner'],
    rows: rows.map(([s, w, a, b, results, bracket]) => [s, w, a, b, BRACKET_CODES[bracket], results, a]),
  }
}

describe('matchupResults', () => {
  it('drops consolation games and sorts oldest first', () => {
    const shard = shardBase([season(2024)])
    const m = matchupsOf([
      [2024, 5, 0, 1, 'WWLL', 'regular'],
      [2024, 1, 0, 1, 'WWWW', 'consolation'],
      [2024, 2, 0, 1, 'WLLL', 'regular'],
    ])
    const out = matchupResults(shard, m)
    expect(out).toHaveLength(2)
    expect(out.map(r => r.week)).toEqual([2, 5])
  })
})

describe('matchup extremes', () => {
  const shard = shardBase([season(2024)])
  const m = matchupsOf([
    [2024, 1, 0, 1, 'WWWW', 'regular'],   // ann sweeps
    [2024, 2, 0, 1, 'LLLL', 'regular'],   // bob sweeps
    [2024, 3, 0, 1, 'WTTL', 'regular'],   // two ties
  ])
  const results = matchupResults(shard, m)

  it('orients a lopsided result to the winner', () => {
    const top = mostLopsidedMatchups(results, 2)
    expect(top[0]!.ownerA).toBe('ann')
    expect([top[0]!.wins, top[0]!.losses]).toEqual([4, 0])
    // The week bob swept is reported with bob first.
    expect(top[1]!.ownerA).toBe('bob')
    expect([top[1]!.wins, top[1]!.losses]).toEqual([4, 0])
  })

  it('ranks by tied categories', () => {
    expect(mostTiedMatchups(results, 1)[0]!.ties).toBe(2)
  })
})

describe('closestFinals', () => {
  it('ranks finals by margin and knows who won', () => {
    const seasons = [
      season(2024, {
        champion: { ownerId: 'ann', teamName: 'ann team' },
        runnerUp: { ownerId: 'bob', teamName: 'bob team' },
      }),
      season(2025, {
        champion: { ownerId: 'bob', teamName: 'bob team' },
        runnerUp: { ownerId: 'ann', teamName: 'ann team' },
      }),
    ]
    const shard = shardBase(seasons)
    const m = matchupsOf([
      [2024, 2, 0, 1, 'WWWL', 'championship'],  // ann by two
      [2025, 2, 0, 1, 'WWLL', 'championship'],  // level, bob recorded as champion
    ])
    const finals = closestFinals(shard, matchupResults(shard, m), 5)
    expect(finals[0]!.season).toBe(2025)
    expect(finals[0]!.margin).toBe(0)
    expect(finals[0]!.championId).toBe('bob')
    expect(finals[1]!.margin).toBe(2)
  })

  it('ignores a season that has not finished', () => {
    const shard = shardBase([season(2026, { isFinished: false, champion: { ownerId: 'ann', teamName: 'x' } })])
    const m = matchupsOf([[2026, 2, 0, 1, 'WWWL', 'championship']])
    expect(closestFinals(shard, matchupResults(shard, m), 5)).toHaveLength(0)
  })
})

describe('heartbreak', () => {
  const seasons = [season(2024, {
    standings: [standing('ann', 1, 9, 3, 0, '.750'), standing('bob', 2, 6, 6, 0, '.500'), standing('cass', 3, 1, 11, 0, '.083')],
    champion: { ownerId: 'bob', teamName: 'bob team' },
    runnerUp: { ownerId: 'ann', teamName: 'ann team' },
  })]

  it('excludes the champion from the best-without-a-title list', () => {
    const out = bestWithoutTitle(shardBase(seasons), 5)
    expect(out.map(r => r.ownerId)).toEqual(['ann', 'cass'])
    expect(out[0]!.wasRunnerUp).toBe(true)
  })

  it('finds a champion who missed the next playoffs, against that year\'s bracket', () => {
    const two = [
      season(2024, {
        standings: [standing('ann', 1, 9, 3, 0)],
        champion: { ownerId: 'ann', teamName: 'ann team' },
      }),
      // Only two of three make the bracket, so third is a miss, and third of
      // three is also last.
      season(2025, {
        numPlayoffTeams: 2,
        standings: [standing('bob', 1, 10, 2, 0), standing('cass', 2, 6, 6, 0), standing('ann', 3, 2, 10, 0)],
      }),
    ]
    const out = fallenChampions(shardBase(two))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ ownerId: 'ann', titleSeason: 2024, nextSeason: 2025, seed: 3, wasLast: true })
  })

  it('does not flag a champion who did make the next playoffs', () => {
    const two = [
      season(2024, { standings: [standing('ann', 1, 9, 3, 0)], champion: { ownerId: 'ann', teamName: 'ann team' } }),
      season(2025, {
        numPlayoffTeams: 2,
        standings: [standing('bob', 1, 10, 2, 0), standing('ann', 2, 6, 6, 0), standing('cass', 3, 2, 10, 0)],
      }),
    ]
    expect(fallenChampions(shardBase(two))).toHaveLength(0)
  })
})

describe('longestStreaks', () => {
  const shard = shardBase([season(2024), season(2025)])

  it('carries a run across seasons', () => {
    const m = matchupsOf([
      [2024, 22, 0, 1, 'WWWL', 'regular'],
      [2025, 1, 0, 1, 'WWWL', 'regular'],
      [2025, 2, 0, 1, 'WWWL', 'regular'],
    ])
    const out = longestStreaks(matchupResults(shard, m), 'W', 5)
    const ann = out.find(s => s.ownerId === 'ann')!
    expect(ann.length).toBe(3)
    expect(ann.from).toEqual({ season: 2024, week: 22 })
    expect(ann.to).toEqual({ season: 2025, week: 2 })
  })

  it('lets a drawn matchup end a run rather than extend it', () => {
    const m = matchupsOf([
      [2024, 1, 0, 1, 'WWWL', 'regular'],
      [2024, 2, 0, 1, 'WWLL', 'regular'],  // level: a draw
      [2024, 3, 0, 1, 'WWWL', 'regular'],
    ])
    const ann = longestStreaks(matchupResults(shard, m), 'W', 5).find(s => s.ownerId === 'ann')!
    expect(ann.length).toBe(1)
  })

  it('reads both sides, so one team\'s run is the other\'s slump', () => {
    const m = matchupsOf([
      [2024, 1, 0, 1, 'WWWL', 'regular'],
      [2024, 2, 0, 1, 'WWWL', 'regular'],
    ])
    const results = matchupResults(shard, m)
    expect(longestStreaks(results, 'W', 5).find(s => s.ownerId === 'ann')!.length).toBe(2)
    expect(longestStreaks(results, 'L', 5).find(s => s.ownerId === 'bob')!.length).toBe(2)
  })
})

describe('nameRuns', () => {
  it('collapses consecutive seasons under one name', () => {
    const runs = nameRuns({ '2009': 'A', '2010': 'A', '2011': 'A', '2012': 'B' })
    expect(runs).toEqual([
      { name: 'A', from: 2009, to: 2011 },
      { name: 'B', from: 2012, to: 2012 },
    ])
  })

  it('keeps a name that came back after a gap as its own run', () => {
    const runs = nameRuns({ '2009': 'A', '2010': 'B', '2011': 'A' })
    expect(runs).toHaveLength(3)
    expect(runs.map(r => r.name)).toEqual(['A', 'B', 'A'])
  })

  it('does not merge across a missing season', () => {
    // The owner sat out 2010, so the two runs of A stay separate.
    const runs = nameRuns({ '2009': 'A', '2011': 'A' })
    expect(runs).toEqual([
      { name: 'A', from: 2009, to: 2009 },
      { name: 'A', from: 2011, to: 2011 },
    ])
  })
})

describe('transactionRecords', () => {
  const shard = shardBase([season(2024)])
  const transactions: TransactionsShard = {
    leagueId: 'kp',
    types: ['add/drop', 'trade', 'commish'],
    playerNames: ['Player One', 'Player Two'],
    rows: [
      // ann adds a player and drops another: one move for ann.
      [2024, '2024-04-01', 0, [[0, 'freeagents', 0], [1, 0, 'waivers']]],
      // a trade between ann and bob.
      [2024, '2024-05-01', 1, [[0, 0, 1], [1, 1, 0]]],
      // a commissioner action with nobody attached.
      [2024, '2024-06-01', 2, []],
      // a trade naming no players at all.
      [2024, '2024-07-01', 1, []],
    ],
    unavailable: [{ season: 2011, listIndex: 93, reason: 'deleted player' }],
  }
  const out = transactionRecords(shard, transactions, 5)

  it('credits both sides of a trade', () => {
    expect(out.mostTrades.find(r => r.ownerId === 'ann')!.count).toBe(1)
    expect(out.mostTrades.find(r => r.ownerId === 'bob')!.count).toBe(1)
  })

  it('counts an add and its matching drop as one move', () => {
    expect(out.busiestSeasons.find(r => r.ownerId === 'ann')!.count).toBe(2)
  })

  it('reports trades that name no players separately rather than dropping them', () => {
    expect(out.totals.tradesOnFile).toBe(2)
    expect(out.totals.tradesWithoutPlayers).toBe(1)
    expect(out.totals.unattributed).toBe(2)
  })

  it('carries the records Yahoo will not serve', () => {
    expect(out.totals.unavailable).toBe(1)
  })

  it('counts how many different owners have acquired a player', () => {
    const one = out.mostPassedAround.find(r => r.name === 'Player One')!
    expect(one.owners).toBe(2)
  })
})
