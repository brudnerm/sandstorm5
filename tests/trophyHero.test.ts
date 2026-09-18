/**
 * Hero summary tests.
 *
 * These four figures are the first thing anyone sees, and three of them are
 * easy to get quietly wrong: reading the unfinished current season as if it
 * had a champion, silently breaking a tie, and measuring a drought for
 * someone who left the league years ago.
 */
import { describe, expect, it } from 'vitest'
import type { SeasonsShard, TrophySeason } from '../src/domain/trophy'
import { heroSummary } from '../app/lib/trophy'

function season(
  year: number,
  opts: { champion?: string; runnerUp?: string; last?: string; finished?: boolean },
): TrophySeason {
  return {
    season: year,
    leagueKey: `x.l.${year}`,
    numTeams: 12,
    categories: [],
    statOrder: [],
    hasAtBats: false,
    weeks: [],
    regularSeasonWeeks: [],
    playoffWeeks: [],
    playoffStartWeek: null,
    numPlayoffTeams: null,
    standings: [],
    seedSource: 'yahoo-playoff-seed',
    tiebreak: 'head-to-head',
    champion: opts.champion ? { ownerId: opts.champion, teamName: `${opts.champion} team` } : null,
    runnerUp: opts.runnerUp ? { ownerId: opts.runnerUp, teamName: `${opts.runnerUp} team` } : null,
    lastPlace: opts.last ? { ownerId: opts.last, teamName: `${opts.last} team` } : null,
    isFinished: opts.finished ?? true,
    notes: [],
  }
}

function owner(id: string, seasons: number[]) {
  return {
    id,
    displayName: id.toUpperCase(),
    firstSeason: seasons[0]!,
    lastSeason: seasons[seasons.length - 1]!,
    seasonsPlayed: seasons.length,
    teamNames: Object.fromEntries(seasons.map(y => [String(y), `${id} ${y}`])),
  }
}

/** Three seasons finished, a fourth in progress. */
function shard(): SeasonsShard {
  return {
    leagueId: 'kp',
    owners: [
      owner('ann', [2021, 2022, 2023, 2024]),
      owner('bob', [2021, 2022, 2023, 2024]),
      owner('cass', [2021, 2022, 2023, 2024]),
      owner('dex', [2021, 2022]), // left the league
    ],
    weeklyColumns: [],
    matchupColumns: [],
    seasons: [
      season(2021, { champion: 'dex', runnerUp: 'ann', last: 'bob' }),
      season(2022, { champion: 'ann', runnerUp: 'bob', last: 'cass' }),
      season(2023, { champion: 'ann', runnerUp: 'cass', last: 'bob' }),
      season(2024, { finished: false }),
    ],
  }
}

const tileFor = (label: string, s = shard()) => heroSummary(s).find(t => t.label === label)

describe('heroSummary', () => {
  it('reads the reigning champion from the last FINISHED season', () => {
    const tile = tileFor('Reigning champion')
    expect(tile?.names).toEqual(['ANN'])
    expect(tile?.value).toBe('2023')
    expect(tile?.detail).toBe('ann team')
  })

  it('reports the reigning last place from that same season', () => {
    const tile = tileFor('Reigning last place')
    expect(tile?.names).toEqual(['BOB'])
    expect(tile?.value).toBe('2023')
  })

  it('counts titles and names an outright leader', () => {
    const tile = tileFor('Most titles')
    expect(tile?.names).toEqual(['ANN'])
    expect(tile?.value).toBe('2 titles')
    expect(tile?.detail).toBe('outright')
  })

  it('reports a title tie as a tie rather than picking one', () => {
    const s = shard()
    s.seasons[2] = season(2023, { champion: 'bob', runnerUp: 'cass', last: 'ann' })
    const tile = tileFor('Most titles', s)
    // ann 2022, bob 2023, dex 2021 — all on one.
    expect(tile?.value).toBe('1 title')
    expect(tile?.names.length).toBe(3)
    expect(tile?.detail).toBe('3-way tie')
  })

  it('measures a never-won drought from the owner\'s first season', () => {
    const tile = tileFor('Longest active drought')
    // bob and cass have both played 2021-2024 without ever winning, so both
    // are on four seasons and the tile reports both.
    expect(tile?.names).toEqual(['BOB', 'CASS'])
    expect(tile?.value).toBe('4 seasons')
    expect(tile?.detail).toBe('never won a title')
  })

  it('ignores owners who are no longer in the league', () => {
    // dex won in 2021 and left, so he is not the longest active drought
    // despite being the longest-suffering former champion.
    const tile = tileFor('Longest active drought')
    expect(tile?.names).not.toContain('DEX')
  })

  it('names the season a drought started when every active owner has won', () => {
    const s = shard()
    // One title each, so nobody active is winless: bob 2021, cass 2022, ann 2023.
    s.seasons[0] = season(2021, { champion: 'bob', runnerUp: 'ann', last: 'cass' })
    s.seasons[1] = season(2022, { champion: 'cass', runnerUp: 'bob', last: 'ann' })
    s.seasons[2] = season(2023, { champion: 'ann', runnerUp: 'cass', last: 'bob' })
    const tile = tileFor('Longest active drought', s)
    expect(tile?.names).toEqual(['BOB'])
    expect(tile?.value).toBe('3 seasons')
    expect(tile?.detail).toBe('last won 2021')
  })

  it('returns nothing at all before any season has finished', () => {
    const s = shard()
    s.seasons = s.seasons.map(x => ({ ...x, isFinished: false }))
    expect(heroSummary(s)).toEqual([])
  })

  it('marks the drought and last-place tiles as shame', () => {
    const tones = heroSummary(shard()).map(t => `${t.label}:${t.tone}`)
    expect(tones).toContain('Reigning champion:praise')
    expect(tones).toContain('Most titles:praise')
    expect(tones).toContain('Longest active drought:shame')
    expect(tones).toContain('Reigning last place:shame')
  })
})
