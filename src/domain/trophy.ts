/**
 * Trophy Room shard shapes — the league's permanent record book.
 *
 * Four shards under data/kp/trophy/. Two of them carry one row per
 * team-week and per matchup across eighteen seasons, so both are stored
 * positionally: the column order is declared once in seasons.json and each
 * row is a flat array. Written as named objects instead, weekly.json is
 * about 1.5 MB; positionally it is roughly 330 KB, smaller than a shard the
 * app already loads, which is what lets every season stay in one request.
 */

/** Where a matchup sits in the season's structure. */
export type Bracket = 'regular' | 'championship' | 'placement' | 'consolation'

/**
 * Bracket as stored in a positional row. Kept as small integers because it
 * repeats on every one of ~4,800 rows.
 *
 * `placement` exists because Yahoo does not distinguish it: it flags
 * `is_consolation = 0` on the third- and fifth-place games as well as on
 * the title path, so the middle playoff week carries three "championship"
 * games — two semifinals and a fifth-place game. Those placement games
 * count toward weekly records but are never reported as playoff results.
 */
export const BRACKET_CODES: Record<Bracket, number> = {
  regular: 0,
  championship: 1,
  placement: 2,
  consolation: 3,
}
export const BRACKET_BY_CODE: Bracket[] = ['regular', 'championship', 'placement', 'consolation']

export interface TrophyCategory {
  statId: number
  role: 'batting' | 'pitching'
  abbr: string
  name: string
  /** false for ERA, WHIP and pitcher losses. */
  higherIsBetter: boolean
  isDisplayOnly: boolean
}

export interface TrophyWeek {
  week: number
  start: string
  end: string
  days: number
  /** Longer than a standard week — opening weeks and the All-Star break. */
  isExtended: boolean
  /** Shorter than a standard week. */
  isShort: boolean
  isPlayoff: boolean
}

export interface TrophyStandingsRow {
  ownerId: string
  teamName: string
  /**
   * Regular-season finishing position, 1 = best. Yahoo's `playoff_seed`
   * where it has one; see `seedSource` when it does not.
   */
  seed: number
  wins: number
  losses: number
  ties: number
  /** Yahoo-formatted winning percentage, e.g. ".571". */
  percentage: string
}

export interface TrophyTitle {
  ownerId: string
  teamName: string
}

export interface TrophySeason {
  season: number
  leagueKey: string
  numTeams: number
  categories: TrophyCategory[]
  /** Category abbreviations in the order weekly rows store their values. */
  statOrder: string[]
  /**
   * Whether at-bats are recoverable for this season. Yahoo only carries the
   * H/AB display stat from 2023 on, so the minimum-AB qualifier for AVG and
   * OBP cannot be applied to earlier seasons. Innings pitched is present in
   * every season, so the ERA and WHIP qualifiers always can be.
   */
  hasAtBats: boolean
  weeks: TrophyWeek[]
  regularSeasonWeeks: number[]
  playoffWeeks: number[]
  playoffStartWeek: number | null
  numPlayoffTeams: number | null
  /** Regular-season standings, best first. Last place is the final row. */
  standings: TrophyStandingsRow[]
  /**
   * How the regular-season order was established. Yahoo seeds every team in
   * most seasons; 2020 seeded only the eight that made a bracket.
   */
  seedSource: 'yahoo-playoff-seed' | 'yahoo-final-rank'
  /**
   * The league's standings tiebreak in force that season. Head-to-head
   * until the rule changed to regular-season record in 2024.
   */
  tiebreak: 'head-to-head' | 'regular-season-record'
  champion: TrophyTitle | null
  runnerUp: TrophyTitle | null
  lastPlace: TrophyTitle | null
  isFinished: boolean
  /**
   * ownerId -> Season review article slug, for the seasons that have one.
   * Lets a champion card link straight to that team's write-up without the
   * client probing eighteen shards to find out which exist.
   */
  retroSlugs: Record<string, string>
  /** Anything a reader of a number from this season should know first. */
  notes: string[]
}

export interface TrophyOwnerRef {
  id: string
  displayName: string
  firstSeason: number
  lastSeason: number
  seasonsPlayed: number
  /** season → that season's team name. */
  teamNames: Record<string, string>
}

/** data/kp/trophy/seasons.json */
export interface SeasonsShard {
  leagueId: string
  /** Owner index — positional rows in the other shards reference these. */
  owners: TrophyOwnerRef[]
  weeklyColumns: string[]
  matchupColumns: string[]
  seasons: TrophySeason[]
}

/**
 * data/kp/trophy/weekly.json — one row per team-week.
 *
 * Row layout, matching `weeklyColumns`:
 *   [season, week, ownerIndex, days, bracketCode, ...category values,
 *    ab, ip, completedGames]
 *
 * A category value is a number, or null where the stat is undefined rather
 * than zero — a rate with no denominator. `completedGames` is what
 * separates "played and scored nothing" from "no data": a team that started
 * nobody reports zero completed games and blank values, which is a real
 * result, not a gap.
 */
export interface WeeklyShard {
  leagueId: string
  columns: string[]
  rows: Array<Array<number | null>>
}

/**
 * data/kp/trophy/matchups.json — one row per matchup.
 *
 * Row layout, matching `matchupColumns`:
 *   [season, week, ownerIndexA, ownerIndexB, bracketCode, results, winnerIndex]
 *
 * `results` is one character per category from A's perspective, in
 * `statOrder`: W, L or T. The W-L-T score is derived from it rather than
 * stored twice.
 */
export interface MatchupShard {
  leagueId: string
  columns: string[]
  rows: Array<Array<number | string | null>>
}

/**
 * One player's movement inside a transaction:
 *   [playerNameIndex, from, to]
 *
 * `from` and `to` are an owner index when the side is a team, or a Yahoo
 * source string ("freeagents", "waivers") when it is not. null means Yahoo
 * recorded no side.
 */
export type TransactionMove = [number, number | string | null, number | string | null]

/**
 * One transaction: [season, date, typeIndex, moves].
 *
 * Positional for the same reason as the weekly rows. Written as named
 * objects, eighteen seasons of transactions come to about 2 MB, nearly all
 * of it the same eight key names repeated across 18,600 player movements.
 */
export type TransactionRow = [number, string, number, TransactionMove[]]

/** data/kp/trophy/transactions.json */
export interface TransactionsShard {
  leagueId: string
  /** Transaction types by index, e.g. ["add/drop", "add", "trade"]. */
  types: string[]
  /** Distinct player names by index. */
  playerNames: string[]
  rows: TransactionRow[]
  /**
   * Transactions Yahoo can no longer serve. Two records in 2011 reference
   * deleted player keys and return HTTP 400 however they are requested, so
   * 2011 counts are a known undercount rather than silently wrong.
   */
  unavailable: Array<{ season: number; listIndex: number; reason: string }>
}

/** Innings in Yahoo's thirds notation ("85.2") as a true decimal. */
export function parseInningsPitched(value: string): number | null {
  if (!value) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const whole = Math.trunc(n)
  const thirds = Math.round((n - whole) * 10)
  if (thirds === 0) return whole
  if (thirds === 1 || thirds === 2) return whole + thirds / 3
  return n
}

/** "56/197" (hits over at-bats) as its at-bat denominator. */
export function parseAtBats(value: string): number | null {
  if (!value || !value.includes('/')) return null
  const ab = Number(value.split('/')[1])
  return Number.isFinite(ab) ? ab : null
}
