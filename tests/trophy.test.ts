/**
 * Trophy Room logic tests.
 *
 * Two things here can quietly produce a wrong record book, so both are
 * pinned down:
 *
 *   1. Bracket tagging. Yahoo's `is_consolation` flag is false for the
 *      third- and fifth-place games as well as the title path, so trusting
 *      it would publish a third-place win as a championship. The fixture is
 *      shaped exactly like a real KP playoff: 4 games, then 6, then 4.
 *   2. Owner resolution. Yahoo now hides manager GUIDs and, for three
 *      departed managers, nicknames too. Resolution must fall back to an
 *      explicit (season, team name) claim and must throw rather than guess.
 */
import { describe, expect, it } from 'vitest'
import { tagBrackets, type BracketGame } from '../src/domain/brackets.js'
import { isHiddenNickname, resolveOwner } from '../src/domain/owners.js'
import { parseAtBats, parseInningsPitched } from '../src/domain/trophy.js'

/**
 * A full KP-shaped playoff. Seeds 1 and 2 have byes; 3-6 play in.
 *   wk22  QF: t3>t6, t5>t4        + 2 consolation
 *   wk23  SF: t1>t5, t3>t2, 5th: t6>t4  + 3 consolation
 *   wk24  F:  t3>t1, 3rd: t2>t5   + 2 consolation
 */
function kpPlayoff(): BracketGame[] {
  const game = (
    week: number, a: string, b: string, winner: string | null, isConsolation = false,
  ): BracketGame => ({ week, teamKeys: [a, b], isPlayoff: true, isConsolation, winnerTeamKey: winner })

  return [
    // regular season
    { week: 21, teamKeys: ['t1', 't2'], isPlayoff: false, isConsolation: false, winnerTeamKey: 't1' },
    // week 22
    game(22, 't3', 't6', 't3'),
    game(22, 't4', 't5', 't5'),
    game(22, 't7', 't10', 't7', true),
    game(22, 't8', 't9', 't9', true),
    // week 23
    game(23, 't1', 't5', 't1'),
    game(23, 't2', 't3', 't3'),
    game(23, 't6', 't4', 't6'), // fifth-place game: both lost in week 22
    game(23, 't7', 't9', 't7', true),
    game(23, 't10', 't8', 't8', true),
    game(23, 't11', 't12', 't11', true),
    // week 24
    game(24, 't1', 't3', 't3'), // the final
    game(24, 't5', 't2', 't2'), // third-place game: both lost in week 23
    game(24, 't7', 't8', 't7', true),
    game(24, 't11', 't9', 't9', true),
  ]
}

describe('tagBrackets', () => {
  const games = kpPlayoff()
  const { brackets, championTeamKey, runnerUpTeamKey, problems } = tagBrackets(games, [22, 23, 24])
  const tagOf = (week: number, a: string) =>
    brackets[games.findIndex(g => g.week === week && g.teamKeys[0] === a)]

  it('finds the final and the champion', () => {
    expect(problems).toEqual([])
    expect(championTeamKey).toBe('t3')
    expect(runnerUpTeamKey).toBe('t1')
    expect(tagOf(24, 't1')).toBe('championship')
  })

  it('does not mistake the third-place game for a championship game', () => {
    // Both its participants lost the week before, which is what rules it out.
    expect(tagOf(24, 't5')).toBe('placement')
  })

  it('does not mistake the fifth-place game for a semifinal', () => {
    expect(tagOf(23, 't6')).toBe('placement')
    expect(tagOf(23, 't1')).toBe('championship')
    expect(tagOf(23, 't2')).toBe('championship')
  })

  it('walks back to the quarterfinals through the semifinal winners', () => {
    expect(tagOf(22, 't3')).toBe('championship')
    expect(tagOf(22, 't4')).toBe('championship')
  })

  it('never promotes a consolation game', () => {
    const consolation = games
      .map((g, i) => ({ g, tag: brackets[i] }))
      .filter(({ g }) => g.isConsolation)
    expect(consolation).not.toHaveLength(0)
    expect(consolation.every(({ tag }) => tag === 'consolation')).toBe(true)
  })

  it('leaves regular-season games alone', () => {
    expect(brackets[0]).toBe('regular')
  })

  it('reports ambiguity instead of guessing a final', () => {
    // Both final-week games contested by two previous-round winners.
    const ambiguous: BracketGame[] = [
      { week: 23, teamKeys: ['a', 'b'], isPlayoff: true, isConsolation: false, winnerTeamKey: 'a' },
      { week: 23, teamKeys: ['c', 'd'], isPlayoff: true, isConsolation: false, winnerTeamKey: 'c' },
      { week: 24, teamKeys: ['a', 'c'], isPlayoff: true, isConsolation: false, winnerTeamKey: 'a' },
      { week: 24, teamKeys: ['c', 'a'], isPlayoff: true, isConsolation: false, winnerTeamKey: 'c' },
    ]
    const result = tagBrackets(ambiguous, [23, 24])
    expect(result.problems.join(' ')).toMatch(/ambiguous/)
    expect(result.championTeamKey).toBeNull()
  })

  it('handles a single-game final week without needing an earlier round', () => {
    const oneGame: BracketGame[] = [
      { week: 9, teamKeys: ['x', 'y'], isPlayoff: true, isConsolation: false, winnerTeamKey: 'y' },
    ]
    const result = tagBrackets(oneGame, [9])
    expect(result.problems).toEqual([])
    expect(result.championTeamKey).toBe('y')
  })
})

describe('owner resolution', () => {
  it('treats Yahoo\'s withheld nickname as hidden', () => {
    expect(isHiddenNickname('--hidden--')).toBe(true)
    expect(isHiddenNickname(null)).toBe(true)
    expect(isHiddenNickname('')).toBe(true)
    expect(isHiddenNickname('Swan')).toBe(false)
  })

  it('resolves a current manager by nickname, whatever the team is called', () => {
    expect(resolveOwner('2026', 'Kenley Loggins', 'Swan').displayName).toBe('Hingston')
    expect(resolveOwner('2009', 'Jim Mora', 'Swan').displayName).toBe('Hingston')
  })

  it('resolves a departed manager by the team name Yahoo still reports', () => {
    expect(resolveOwner('2011', 'Dans Team', '--hidden--').displayName).toBe('Other Dan')
    expect(resolveOwner('2010', 'BenFranklinRodriguez', null).displayName).toBe('Rob')
    expect(resolveOwner('2009', 'Lonley Picards', '--hidden--').displayName).toBe('Billy')
  })

  it('keeps Other Dan distinct from Dan, who played the same seasons', () => {
    const otherDan = resolveOwner('2013', 'Dans Team', '--hidden--')
    const dan = resolveOwner('2013', 'Dirty Sånchez', 'Rich Garcis')
    expect(otherDan.id).not.toBe(dan.id)
    expect(dan.displayName).toBe('Dan')
  })

  it('throws rather than attributing an unknown nickname', () => {
    expect(() => resolveOwner('2026', 'Some Team', 'Brand New Manager')).toThrow(/yahooNicknames/)
  })

  it('throws rather than guessing a hidden manager it has no claim for', () => {
    expect(() => resolveOwner('2009', 'Unclaimed Team', '--hidden--')).toThrow(/claimedTeamSeasons/)
  })
})

describe('stat parsing', () => {
  it('reads innings in thirds notation as a decimal', () => {
    expect(parseInningsPitched('85')).toBe(85)
    expect(parseInningsPitched('85.1')).toBeCloseTo(85 + 1 / 3, 6)
    expect(parseInningsPitched('85.2')).toBeCloseTo(85 + 2 / 3, 6)
    expect(parseInningsPitched('')).toBeNull()
  })

  it('reads the at-bat denominator out of a hits-over-at-bats value', () => {
    expect(parseAtBats('56/197')).toBe(197)
    expect(parseAtBats('')).toBeNull()
    // Seasons before 2023 carry no H/AB stat at all.
    expect(parseAtBats('.284')).toBeNull()
  })
})
