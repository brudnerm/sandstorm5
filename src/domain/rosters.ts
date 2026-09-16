/**
 * Weekly roster snapshots and the injury history derived from them.
 *
 * Rosters are fetched once per week and kept forever — Yahoo's per-week
 * roster endpoint is authoritative for who was on a team and what their
 * status was that week, and earlier weeks never change. Injury stints are
 * derived client-side-free, in the pipeline, by scanning consecutive weekly
 * snapshots per player: see `deriveInjuryStints`.
 */
import { parseInnings, type DraftBatting, type DraftPitching } from './draft.js'
import { statKey, type Role, type StatCategory, type StatKey } from './stats.js'

export interface WeeklyRosterPlayer {
  playerKey: string
  name: string
  /** Yahoo eligible_positions, e.g. ['3B', 'SS']. */
  positions: string[]
  /** That week's lineup slot: 'C', 'Util', 'SP', 'BN', 'IL', ... */
  selectedPosition: string | null
  /** Injury/roster status that week: 'IL10', 'IL15', 'IL60', 'DTD', 'NA', ... or null when active. */
  status: string | null
}

export interface WeeklyTeamRoster {
  teamKey: string
  players: WeeklyRosterPlayer[]
}

/** data/{leagueId}/rosters/{season}/{week}.json */
export interface WeeklyRostersShard {
  leagueId: string
  season: string
  week: number
  teams: WeeklyTeamRoster[]
}

/** One week's rosters, as fed to `deriveInjuryStints`. */
export interface WeekSnapshot {
  week: number
  teams: WeeklyTeamRoster[]
}

/** A player's full-season production, joined in for "what was lost". */
export interface InjurySeasonLine {
  role: Role
  batting: DraftBatting | null
  pitching: DraftPitching | null
}

export interface InjuryStint {
  playerKey: string
  name: string
  /** Team that rostered the player when the stint began. */
  teamKey: string
  firstWeek: number
  /** Last week observed with an IL status; null if still ongoing as of the latest snapshot. */
  lastWeek: number | null
  /** Status at onset, e.g. 'IL10' — the substatus can change mid-stint but this is what triggered it. */
  status: string
  /** The player went unrostered (by anyone) at some point during the stint. */
  dropped: boolean
  /** The player's team changed, with no unrostered gap, at some point during the stint. */
  traded: boolean
  /** Consecutive weeks rostered (any team) immediately before the stint began. */
  weeksRosteredBefore: number
  /** Consecutive weeks rostered (any team) immediately after the stint ended; 0 while still ongoing. */
  weeksRosteredAfter: number
  seasonLine: InjurySeasonLine | null
}

/** data/{leagueId}/injuries/{season}.json */
export interface InjuriesShard {
  leagueId: string
  season: string
  /** The latest week the roster history covers. */
  asOfWeek: number
  stints: InjuryStint[]
}

/** Yahoo's IL substatuses all start with 'IL' (IL, IL7, IL10, IL15, IL60, ...). */
export function isInjuredStatus(status: string | null): boolean {
  return !!status && status.toUpperCase().startsWith('IL')
}

interface Observation {
  week: number
  teamKey: string
  status: string | null
  name: string
}

/**
 * Walk each player's weekly observations (only weeks they were rostered
 * somewhere — gaps mean unrostered, not "healthy") and cut out maximal runs
 * of IL status as stints. A gap inside a run means the team dropped him
 * while hurt; a same-week team change with no gap means a trade.
 */
export function deriveInjuryStints(weeks: WeekSnapshot[]): Array<Omit<InjuryStint, 'seasonLine'>> {
  const sorted = [...weeks].sort((a, b) => a.week - b.week)
  if (sorted.length === 0) return []
  const minWeek = sorted[0]!.week
  const maxWeek = sorted[sorted.length - 1]!.week

  const byPlayer = new Map<string, Observation[]>()
  for (const { week, teams } of sorted) {
    for (const team of teams) {
      for (const player of team.players) {
        const list = byPlayer.get(player.playerKey) ?? []
        list.push({ week, teamKey: team.teamKey, status: player.status, name: player.name })
        byPlayer.set(player.playerKey, list)
      }
    }
  }

  const stints: Array<Omit<InjuryStint, 'seasonLine'>> = []

  for (const [playerKey, unsorted] of byPlayer) {
    const obs = [...unsorted].sort((a, b) => a.week - b.week)
    const rosteredWeeks = new Set(obs.map(o => o.week))

    let i = 0
    while (i < obs.length) {
      if (!isInjuredStatus(obs[i]!.status)) {
        i++
        continue
      }
      const start = i
      let j = i
      while (j + 1 < obs.length && isInjuredStatus(obs[j + 1]!.status)) j++

      let dropped = false
      let traded = false
      for (let k = start; k < j; k++) {
        const gap = obs[k + 1]!.week - obs[k]!.week
        if (gap > 1) dropped = true
        else if (obs[k + 1]!.teamKey !== obs[k]!.teamKey) traded = true
      }

      const firstWeek = obs[start]!.week
      const stillOngoing = j === obs.length - 1
      const lastWeek = stillOngoing ? null : obs[j]!.week

      let weeksRosteredBefore = 0
      for (let w = firstWeek - 1; w >= minWeek && rosteredWeeks.has(w); w--) weeksRosteredBefore++

      let weeksRosteredAfter = 0
      if (lastWeek !== null) {
        for (let w = lastWeek + 1; w <= maxWeek && rosteredWeeks.has(w); w++) weeksRosteredAfter++
      }

      stints.push({
        playerKey,
        name: obs[start]!.name,
        teamKey: obs[start]!.teamKey,
        firstWeek,
        lastWeek,
        status: obs[start]!.status!,
        dropped,
        traded,
        weeksRosteredBefore,
        weeksRosteredAfter,
      })

      i = j + 1
    }
  }

  stints.sort((a, b) => a.firstWeek - b.firstWeek || a.playerKey.localeCompare(b.playerKey))
  return stints
}

const BATTING_ABBR: Partial<Record<string, keyof DraftBatting>> = {
  R: 'r', HR: 'hr', RBI: 'rbi', SB: 'sb', AVG: 'avg', OBP: 'obp',
}
const PITCHING_ABBR: Partial<Record<string, keyof DraftPitching>> = {
  W: 'w', L: 'l', SV: 'sv', K: 'k', ERA: 'era', WHIP: 'whip',
}

function num(v: string | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Fallback season line for a player never drafted (an in-season waiver
 * pickup): build a DraftBatting/DraftPitching-shaped line from the league's
 * own 'season' stat window, keyed generically by category abbreviation so it
 * works across leagues without hand-coded stat ids. H/AB carries at-bats as
 * "hits/atbats"; everything else is a direct value.
 */
export function statLineToSeasonLine(
  role: Role,
  stats: Partial<Record<StatKey, string>>,
  categories: StatCategory[],
): InjurySeasonLine {
  if (role === 'pitching') {
    const pitching: DraftPitching = { ip: 0, w: 0, l: 0, sv: 0, k: 0, era: 0, whip: 0 }
    for (const cat of categories) {
      if (cat.role !== 'pitching') continue
      const value = stats[statKey(cat.role, cat.statId)]
      if (value === undefined) continue
      if (cat.abbr === 'IP') pitching.ip = parseInnings(value)
      else {
        const field = PITCHING_ABBR[cat.abbr]
        if (field) pitching[field] = num(value)
      }
    }
    return { role, batting: null, pitching }
  }
  const batting: DraftBatting = { ab: 0, r: 0, hr: 0, rbi: 0, sb: 0, avg: 0, obp: 0 }
  for (const cat of categories) {
    if (cat.role !== 'batting') continue
    const value = stats[statKey(cat.role, cat.statId)]
    if (value === undefined) continue
    if (cat.abbr === 'H/AB') batting.ab = num(value.split('/')[1])
    else if (cat.abbr === 'AB') batting.ab = num(value)
    else {
      const field = BATTING_ABBR[cat.abbr]
      if (field) batting[field] = num(value)
    }
  }
  return { role, batting, pitching: null }
}
