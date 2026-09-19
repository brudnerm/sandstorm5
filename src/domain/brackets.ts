/**
 * Working out which playoff games are actually on the path to the title.
 *
 * Yahoo only tells us `is_consolation`, and that flag is false for the
 * third- and fifth-place games as well as for the title path. In a normal
 * KP season the middle playoff week therefore carries three "non-consolation"
 * games — two semifinals and a fifth-place game — and the final week carries
 * two, the final and the third-place game. Taking Yahoo's flag at face value
 * would report a third-place win as a championship result.
 *
 * So the bracket is reconstructed backwards from the final:
 *
 *   1. The final is the last playoff week's non-consolation game whose two
 *      participants both won a non-consolation game the week before. The
 *      third-place game fails that test, because both its participants lost.
 *   2. Everything else in that week is a placement game.
 *   3. Walking earlier: a non-consolation game is on the title path when its
 *      winner is already known to be on the path. Its participants then join
 *      the path, so the round before it resolves the same way.
 *
 * This agrees with Yahoo's own final standings — rank 1 and rank 2 — in all
 * seventeen finished KP seasons. The backfill asserts that agreement rather
 * than trusting either source alone.
 */
import type { Bracket } from './trophy.js'

export interface BracketGame {
  week: number
  teamKeys: [string, string]
  isPlayoff: boolean
  isConsolation: boolean
  winnerTeamKey: string | null
}

export interface BracketTagging<T extends BracketGame> {
  /** Same order as the input, one bracket tag per game. */
  brackets: Bracket[]
  final: T | null
  championTeamKey: string | null
  runnerUpTeamKey: string | null
  /** Anything ambiguous, for the validator to fail on. */
  problems: string[]
}

/**
 * Tag every game and identify the final. `playoffWeeks` is the set of weeks
 * Yahoo flags as playoffs, ascending.
 */
export function tagBrackets<T extends BracketGame>(
  games: T[],
  playoffWeeks: number[],
): BracketTagging<T> {
  const problems: string[] = []
  const brackets: Bracket[] = games.map(g =>
    !g.isPlayoff ? 'regular' : g.isConsolation ? 'consolation' : 'placement',
  )

  const weeks = [...playoffWeeks].sort((a, b) => a - b)
  if (weeks.length === 0) {
    return { brackets, final: null, championTeamKey: null, runnerUpTeamKey: null, problems }
  }

  const titlePathIndexes = (week: number): number[] =>
    games.flatMap((g, i) => (g.week === week && g.isPlayoff && !g.isConsolation ? [i] : []))

  const lastWeek = weeks[weeks.length - 1]!
  const finalCandidates = titlePathIndexes(lastWeek)

  let finalIndex: number | null = null
  if (finalCandidates.length === 1) {
    finalIndex = finalCandidates[0]!
  } else if (weeks.length >= 2) {
    const prevWeek = weeks[weeks.length - 2]!
    const prevWinners = new Set(
      titlePathIndexes(prevWeek)
        .map(i => games[i]!.winnerTeamKey)
        .filter((k): k is string => !!k),
    )
    const matches = finalCandidates.filter(i =>
      games[i]!.teamKeys.every(tk => prevWinners.has(tk)),
    )
    if (matches.length === 1) {
      finalIndex = matches[0]!
    } else {
      problems.push(
        `week ${lastWeek}: ${matches.length} of ${finalCandidates.length} non-consolation ` +
        `games have two winners from week ${prevWeek} — the final is ambiguous`,
      )
    }
  } else {
    problems.push(
      `week ${lastWeek} has ${finalCandidates.length} non-consolation games and no earlier ` +
      `playoff week to resolve them against — the final is ambiguous`,
    )
  }

  if (finalIndex === null) {
    return { brackets, final: null, championTeamKey: null, runnerUpTeamKey: null, problems }
  }

  const final = games[finalIndex]!
  brackets[finalIndex] = 'championship'

  // Walk backwards: a game is on the title path when its winner already is.
  const onPath = new Set<string>(final.teamKeys)
  for (let w = weeks.length - 2; w >= 0; w--) {
    for (const i of titlePathIndexes(weeks[w]!)) {
      const game = games[i]!
      if (game.winnerTeamKey && onPath.has(game.winnerTeamKey)) {
        brackets[i] = 'championship'
        for (const tk of game.teamKeys) onPath.add(tk)
      }
    }
  }

  const championTeamKey = final.winnerTeamKey
  const runnerUpTeamKey = championTeamKey
    ? final.teamKeys.find(tk => tk !== championTeamKey) ?? null
    : null
  if (!championTeamKey) {
    problems.push(`week ${lastWeek}: the final has no winner recorded`)
  }

  return { brackets, final, championTeamKey, runnerUpTeamKey, problems }
}
