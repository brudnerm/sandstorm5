/**
 * Champions and Hall of Shame logic.
 *
 * The things here that can go quietly wrong are all about perspective and
 * edge cases: reading a final from the losing side, ranking seasons of
 * different lengths against each other, describing a gap that runs the wrong
 * way, and letting unapproved copy onto the live page.
 */
import { describe, expect, it } from 'vitest'
import type { MatchupShard, SeasonsShard, TrophySeason } from '../src/domain/trophy'
import { BRACKET_CODES } from '../src/domain/trophy'
import type { CopyShard } from '../src/trophy/copy'
import {
  finalDetail, gapToPenultimate, usableCopy, worstSeasonRecords,
} from '../app/lib/trophy'

const STATS = ['R', 'HR', 'RBI', 'SB', 'AVG', 'OBP', 'W', 'L', 'SV', 'K', 'ERA', 'WHIP']

function standing(ownerId: string, seed: number, w: number, l: number, t: number, pct: string) {
  return { ownerId, teamName: `${ownerId} team`, seed, wins: w, losses: l, ties: t, percentage: pct }
}

function season(year: number, over: Partial<TrophySeason> = {}): TrophySeason {
  return {
    season: year, leagueKey: `x.l.${year}`, numTeams: 12, categories: [], statOrder: STATS,
    hasAtBats: false,
    weeks: [{ week: 24, start: `${year}-09-15`, end: `${year}-09-21`, days: 7, isExtended: false, isShort: false, isPlayoff: true }],
    regularSeasonWeeks: [], playoffWeeks: [24], playoffStartWeek: 22, numPlayoffTeams: 6,
    standings: [], seedSource: 'yahoo-playoff-seed', tiebreak: 'head-to-head',
    champion: null, runnerUp: null, lastPlace: null, isFinished: true, retroSlugs: {}, notes: [],
    ...over,
  }
}

function shard(seasons: TrophySeason[], ownerIds: string[]): SeasonsShard {
  return {
    leagueId: 'kp',
    owners: ownerIds.map(id => ({
      id, displayName: id.toUpperCase(), firstSeason: 2020, lastSeason: 2025,
      seasonsPlayed: 1, teamNames: {},
    })),
    weeklyColumns: [], matchupColumns: [], seasons,
  }
}

describe('finalDetail', () => {
  const s = season(2025, {
    champion: { ownerId: 'bob', teamName: 'bob team' },
    runnerUp: { ownerId: 'ann', teamName: 'ann team' },
    standings: [standing('ann', 1, 150, 90, 0, '.625'), standing('bob', 2, 140, 100, 0, '.583')],
  })
  const base = shard([s], ['ann', 'bob'])
  const matchups: MatchupShard = {
    leagueId: 'kp',
    columns: ['season', 'week', 'ownerA', 'ownerB', 'bracket', 'results', 'winner'],
    // ann is stored first, but bob is the champion, so the stored string is
    // from the LOSER's point of view and has to be flipped.
    rows: [[2025, 24, 0, 1, BRACKET_CODES.championship, 'WWWWLLLLTTLL', 1]],
  }

  it('reads the final from the champion\'s point of view, not the stored one', () => {
    const detail = finalDetail(base, matchups, s)!
    expect(detail.opponentId).toBe('ann')
    // Stored 4W 6L 2T for ann becomes 6W 4L 2T for bob.
    expect([detail.w, detail.l, detail.t]).toEqual([6, 4, 2])
    expect(detail.categories[0]).toEqual({ abbr: 'R', outcome: 'L' })
    expect(detail.categories[4]).toEqual({ abbr: 'AVG', outcome: 'W' })
    expect(detail.categories[8]).toEqual({ abbr: 'SV', outcome: 'T' })
  })

  it('labels every category and carries the week', () => {
    const detail = finalDetail(base, matchups, s)!
    expect(detail.categories.map(c => c.abbr)).toEqual(STATS)
    expect(detail.week?.week).toBe(24)
  })

  it('returns nothing when the championship game is not in the shard', () => {
    const empty: MatchupShard = { ...matchups, rows: [] }
    expect(finalDetail(base, empty, s)).toBeNull()
  })
})

describe('worstSeasonRecords', () => {
  it('ranks on percentage, so a short season is comparable to a full one', () => {
    const full = season(2019, {
      standings: [standing('ann', 1, 150, 90, 0, '.625'), standing('bob', 12, 90, 150, 0, '.375')],
      lastPlace: { ownerId: 'bob', teamName: 'bob team' },
    })
    // A 7-week season: far fewer wins, but a better rate than bob's full year.
    const short = season(2020, {
      standings: [standing('ann', 1, 50, 34, 0, '.595'), standing('cass', 12, 34, 50, 0, '.405')],
      lastPlace: { ownerId: 'cass', teamName: 'cass team' },
    })
    const worst = worstSeasonRecords(shard([full, short], ['ann', 'bob', 'cass']), 2)
    expect(worst[0]!.ownerId).toBe('bob')
    expect(worst[0]!.percentage).toBe('.375')
    // cass has 34 wins against bob's 90 and is still the better season.
    expect(worst[1]!.ownerId).toBe('cass')
  })
})

describe('gapToPenultimate', () => {
  it('measures the gap in category wins when there is one', () => {
    const s = season(2025, {
      standings: [standing('ann', 11, 100, 140, 0, '.417'), standing('bob', 12, 92, 148, 0, '.383')],
    })
    expect(gapToPenultimate(s)).toEqual({ wins: 8, levelOnRecord: false, place: 1 })
  })

  it('reports a negative gap rather than printing one', () => {
    // bob out-wins the team above and still finishes below it on ties.
    const s = season(2022, {
      standings: [standing('ann', 11, 87, 137, 16, '.396'), standing('bob', 12, 88, 136, 16, '.400')],
    })
    const gap = gapToPenultimate(s)!
    expect(gap.wins).toBe(-1)
    expect(gap.levelOnRecord).toBe(false)
  })

  it('flags two teams that share a record entirely', () => {
    const s = season(2020, {
      standings: [standing('ann', 11, 27, 48, 9, '.375'), standing('bob', 12, 28, 49, 7, '.375')],
    })
    expect(gapToPenultimate(s)!.levelOnRecord).toBe(true)
  })
})

describe('usableCopy', () => {
  const copy: CopyShard = {
    leagueId: 'kp',
    entries: {
      'champion-2025': { status: 'approved', text: 'Signed off.' },
      'champion-2024': { status: 'draft', text: 'Not read yet.' },
    },
  }

  it('always shows an approved blurb', () => {
    expect(usableCopy(copy, 'champion-2025', false)).toEqual({ text: 'Signed off.', isDraft: false })
    expect(usableCopy(copy, 'champion-2025', true)!.isDraft).toBe(false)
  })

  it('hides a draft unless drafts are explicitly allowed', () => {
    expect(usableCopy(copy, 'champion-2024', false)).toBeNull()
    expect(usableCopy(copy, 'champion-2024', true)).toEqual({ text: 'Not read yet.', isDraft: true })
  })

  it('returns nothing for a key with no entry, and survives a missing shard', () => {
    expect(usableCopy(copy, 'champion-1999', true)).toBeNull()
    expect(usableCopy(null, 'champion-2025', true)).toBeNull()
  })
})
