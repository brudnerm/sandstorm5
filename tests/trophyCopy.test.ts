/**
 * Blurb templates.
 *
 * The rules these lock in are the ones that were wrong first time round:
 * no gender is assumed for anyone, a final that finished level is not
 * described as won, the article agrees with how the record is said aloud,
 * and approving a blurb takes it out of the template's hands for good.
 */
import { describe, expect, it } from 'vitest'
import type { MatchupShard, SeasonsShard, TrophySeason } from '../src/domain/trophy'
import { BRACKET_CODES } from '../src/domain/trophy'
import { buildCopy, type CopyShard } from '../src/trophy/copy'
import type { DraftsShard } from '../src/trophy/drafts'

const STATS = ['R', 'HR', 'RBI', 'SB', 'AVG', 'OBP', 'W', 'L', 'SV', 'K', 'ERA', 'WHIP']
const row = (ownerId: string, seed: number, w: number, l: number, t: number, pct: string) =>
  ({ ownerId, teamName: `${ownerId} team`, seed, wins: w, losses: l, ties: t, percentage: pct })

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

function ctxFor(seasons: TrophySeason[], results: string, drafts?: Partial<DraftsShard>) {
  const seasonsShard: SeasonsShard = {
    leagueId: 'kp',
    owners: ['ann', 'bob'].map(id => ({
      id, displayName: id === 'ann' ? 'Ann' : 'Bob',
      firstSeason: 2024, lastSeason: 2025, seasonsPlayed: 2, teamNames: {},
    })),
    weeklyColumns: [], matchupColumns: [], seasons,
  }
  const matchupShard: MatchupShard = {
    leagueId: 'kp',
    columns: ['season', 'week', 'ownerA', 'ownerB', 'bracket', 'results', 'winner'],
    rows: seasons.map(s => [s.season, 24, 0, 1, BRACKET_CODES.championship, results, 0]),
  }
  const draftsShard: DraftsShard = {
    leagueId: 'kp', firstKeeperSeason: null, firstReverseOrderSeason: null, seasons: [], ...drafts,
  }
  return { seasonsShard, matchupShard, draftsShard }
}

describe('champion blurbs', () => {
  const won = season(2025, {
    champion: { ownerId: 'ann', teamName: 'ann team' },
    runnerUp: { ownerId: 'bob', teamName: 'bob team' },
    standings: [row('ann', 3, 132, 96, 24, '.571'), row('bob', 1, 146, 86, 20, '.619')],
  })

  it('states the seed, the record and the final', () => {
    const text = buildCopy(ctxFor([won], 'WWWWWWWLLLLL'), null).entries['champion-2025']!.text
    expect(text).toContain('Ann won the 2025 title from the third seed, 132-96-24 in the regular season.')
    expect(text).toContain('The final went 7-5-0 against Bob')
    expect(text).toContain('15 September')
  })

  it('never assumes a gender for anyone', () => {
    const text = buildCopy(ctxFor([won], 'WWWWWWWLLLLL'), null).entries['champion-2025']!.text
    expect(text).not.toMatch(/\b(his|her|he|she)\b/i)
  })

  it('calls a level final level instead of dressing it up as a win', () => {
    const text = buildCopy(ctxFor([won], 'WWWWWWLLLLLL'), null).entries['champion-2025']!.text
    expect(text).toContain('finished level at 6-6-0')
    expect(text).toContain('recorded as Ann\'s')
    expect(text).not.toContain('The final went')
  })

  it('drops the Yahoo two-way parenthetical from a keeper name', () => {
    const drafts: Partial<DraftsShard> = {
      firstKeeperSeason: 2025,
      seasons: [{
        season: 2025, keeperSource: 'house-rule',
        keepers: [{ ownerId: 'ann', playerName: 'Shohei Ohtani (Batter)', round: 20 }],
        keeperEvidence: { candidates: 1, carriedInFromPrevious: null, carriedOutToNext: null },
        firstPick: null, firstPickWentToLastPlace: null, notes: [],
      }],
    }
    const text = buildCopy(ctxFor([won], 'WWWWWWWLLLLL', drafts), null).entries['champion-2025']!.text
    expect(text).toContain('kept Shohei Ohtani.')
    expect(text).not.toContain('(Batter)')
  })
})

describe('shame blurbs', () => {
  // A real twelve-team table, so "eleventh place" is genuinely eleventh.
  const make = (winsLast: number, lastPct: string, abovePct: string, aboveWins: number) =>
    season(2025, {
      lastPlace: { ownerId: 'bob', teamName: 'bob team' },
      standings: [
        ...Array.from({ length: 10 }, (_, i) => row(`filler${i}`, i + 1, 150 - i, 90 + i, 0, '.600')),
        row('ann', 11, aboveWins, 140, 16, abovePct),
        row('bob', 12, winsLast, 142, 25, lastPct),
      ],
    })

  it('agrees the article with the way the record is said', () => {
    const eighty = buildCopy(ctxFor([make(85, '.387', '.400', 93)], 'W'.repeat(12)), null)
    expect(eighty.entries['shame-2025']!.text).toContain('with an 85-142-25 category record')
    const ninety = buildCopy(ctxFor([make(92, '.387', '.400', 99)], 'W'.repeat(12)), null)
    expect(ninety.entries['shame-2025']!.text).toContain('with a 92-142-25 category record')
  })

  it('does not print a negative gap', () => {
    // bob out-wins eleventh place and still finishes below it.
    const text = buildCopy(ctxFor([make(88, '.396', '.400', 87)], 'W'.repeat(12)), null)
      .entries['shame-2025']!.text
    expect(text).toContain('one more category win than eleventh place')
    expect(text).not.toContain('-1 category')
  })

  it('says so when two teams share a record entirely', () => {
    const text = buildCopy(ctxFor([make(28, '.375', '.375', 27)], 'W'.repeat(12)), null)
      .entries['shame-2025']!.text
    expect(text).toContain('level with eleventh place on record')
  })

  it('claims the first pick only where the draft ran in reverse order', () => {
    const withReward: Partial<DraftsShard> = {
      seasons: [{
        season: 2026, keeperSource: 'none', keepers: [],
        keeperEvidence: { candidates: 0, carriedInFromPrevious: null, carriedOutToNext: null },
        firstPick: { ownerId: 'bob', playerName: 'Someone Good' },
        firstPickWentToLastPlace: true, notes: [],
      }],
    }
    const yes = buildCopy(ctxFor([make(85, '.387', '.400', 93)], 'W'.repeat(12), withReward), null)
    expect(yes.entries['shame-2025']!.text).toContain('first pick of the 2026 draft')

    const traded: Partial<DraftsShard> = {
      seasons: [{ ...withReward.seasons![0]!, firstPickWentToLastPlace: false }],
    }
    const no = buildCopy(ctxFor([make(85, '.387', '.400', 93)], 'W'.repeat(12), traded), null)
    expect(no.entries['shame-2025']!.text).not.toContain('first pick')
  })
})

describe('approval', () => {
  const s = season(2025, {
    champion: { ownerId: 'ann', teamName: 'ann team' },
    runnerUp: { ownerId: 'bob', teamName: 'bob team' },
    standings: [row('ann', 1, 132, 96, 24, '.571'), row('bob', 2, 120, 110, 22, '.521')],
  })

  it('writes new blurbs as drafts', () => {
    const built = buildCopy(ctxFor([s], 'WWWWWWWLLLLL'), null)
    expect(built.entries['champion-2025']!.status).toBe('draft')
  })

  it('never rewrites an approved blurb', () => {
    const existing: CopyShard = {
      leagueId: 'kp',
      entries: { 'champion-2025': { status: 'approved', text: 'Words a human chose.' } },
    }
    const built = buildCopy(ctxFor([s], 'WWWWWWWLLLLL'), existing)
    expect(built.entries['champion-2025']).toEqual(existing.entries['champion-2025'])
  })

  it('keeps an approved blurb whose season no longer generates one', () => {
    const existing: CopyShard = {
      leagueId: 'kp',
      entries: { 'champion-1999': { status: 'approved', text: 'Ancient history.' } },
    }
    const built = buildCopy(ctxFor([s], 'WWWWWWWLLLLL'), existing)
    expect(built.entries['champion-1999']!.text).toBe('Ancient history.')
  })
})
