/**
 * Weekly roster snapshots and the injury history derived from them.
 *
 * Rosters are fetched once per week and kept forever; earlier weeks never
 * change. Injury stints are derived in the pipeline by scanning consecutive
 * weekly snapshots per player: see `deriveInjuryStints`.
 *
 * ## Only the lineup slot is week-scoped
 *
 * In `team/{key}/roster;week=N/players`, Yahoo scopes `selected_position`
 * (and `player_stats`) to the requested week — each carries its own coverage
 * object. `status` does NOT: it sits bare in the player info array next to
 * `uniform_number` and `editorial_team_abbr`, and is the player's status at
 * *fetch* time, whatever week you asked for.
 *
 * So stints are derived from the IL **lineup slot**, never from `status`. A
 * backfill run writes every past week in one pass, and reading `status` there
 * stamps today's injuries onto the whole season — which is exactly what the
 * first version of this shard did: 89 stints, all 89 "still ongoing", 53 of
 * them starting in the season's opening week, and not one player changing
 * status across 6,400 player-week observations.
 *
 * The slot is also the better fantasy metric regardless of provenance: it
 * measures roster spots actually consumed by injury. It under-counts by
 * design — a manager who leaves an injured player in a bench slot is not
 * paying the IL cost, so we do not charge them for one.
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

/** A player's full-season production, joined in for context on the row. */
export interface InjurySeasonLine {
  role: Role
  batting: DraftBatting | null
  pitching: DraftPitching | null
}

/** One team's share of a stint: the weeks that team carried the IL slot. */
export interface StintTeamShare {
  teamKey: string
  weeks: number
}

export interface InjuryStint {
  playerKey: string
  name: string
  /** Team holding the IL slot when the stint began; see `teams` for the split. */
  teamKey: string
  firstWeek: number
  /** Last week observed in an IL slot; null only when that is the latest snapshot. */
  lastWeek: number | null
  /**
   * Weeks the player actually occupied an IL slot. The run is consecutive by
   * construction, so this never counts a week he was activated or unrostered.
   */
  weeksLost: number
  /** `weeksLost` split across teams (a mid-stint trade), in first-seen order. */
  teams: StintTeamShare[]
  /**
   * Yahoo's IL substatus ('IL10', 'IL60', ...), and only for a stint still
   * open at the latest snapshot — that is the one week whose `status` was
   * read at the time it applied. null for any stint that has ended.
   */
  status: string | null
  /** The stint ended because the player left every roster while still IL-slotted. */
  dropped: boolean
  /** The IL slot changed hands mid-stint, with no unrostered gap. */
  traded: boolean
  seasonLine: InjurySeasonLine | null
}

/** data/{leagueId}/injuries/{season}.json */
export interface InjuriesShard {
  leagueId: string
  season: string
  /** The latest week the roster history covers. */
  asOfWeek: number
  /**
   * Copied from the league's own settings so the view can flag playoff-week
   * stints without a second fetch, and without assuming a six-team bracket
   * starting in week 22 — both have varied across our seasons.
   */
  playoffStartWeek: number | null
  numPlayoffTeams: number | null
  stints: InjuryStint[]
}

/** Yahoo's IL substatuses all start with 'IL' (IL, IL7, IL10, IL15, IL60, ...). */
export function isInjuredStatus(status: string | null): boolean {
  return !!status && status.toUpperCase().startsWith('IL')
}

/**
 * Was this week's lineup slot an IL slot? Yahoo uses 'IL' and, in leagues
 * with a second one, 'IL+'. 'NA' is a minor-league slot, not an injury.
 */
export function isInjurySlot(selectedPosition: string | null): boolean {
  if (!selectedPosition) return false
  return selectedPosition.toUpperCase().startsWith('IL')
}

interface Observation {
  week: number
  teamKey: string
  ilSlot: boolean
  status: string | null
  name: string
}

/**
 * Walk each player's weekly observations and cut out maximal runs of
 * *consecutive* weeks spent in an IL slot.
 *
 * A run ends when the next week is missing (nobody rostered him — a drop) or
 * present but not IL-slotted (he was activated). Both are real endings: once
 * a player is off your roster or back in your lineup, you have stopped paying
 * for the injury. A pickup by someone else who re-IL-slots him therefore
 * starts a *new* stint, charged to that manager.
 *
 * A team change with no gap is a trade, and keeps one stint together — the
 * roster spot really was consumed continuously — with `teams` splitting the
 * weeks between the managers.
 */
export function deriveInjuryStints(weeks: WeekSnapshot[]): Array<Omit<InjuryStint, 'seasonLine'>> {
  const sorted = [...weeks].sort((a, b) => a.week - b.week)
  if (sorted.length === 0) return []
  const maxWeek = sorted[sorted.length - 1]!.week

  const byPlayer = new Map<string, Observation[]>()
  for (const { week, teams } of sorted) {
    for (const team of teams) {
      for (const player of team.players) {
        const list = byPlayer.get(player.playerKey) ?? []
        list.push({
          week,
          teamKey: team.teamKey,
          ilSlot: isInjurySlot(player.selectedPosition),
          status: player.status,
          name: player.name,
        })
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
      if (!obs[i]!.ilSlot) {
        i++
        continue
      }
      const start = i
      let j = i
      while (j + 1 < obs.length && obs[j + 1]!.ilSlot && obs[j + 1]!.week === obs[j]!.week + 1) j++

      const firstWeek = obs[start]!.week
      const lastObs = obs[j]!
      const ongoing = lastObs.week === maxWeek

      // Weeks per team, first-seen order — a trade splits one stint in two.
      const byTeam = new Map<string, number>()
      for (let k = start; k <= j; k++) {
        byTeam.set(obs[k]!.teamKey, (byTeam.get(obs[k]!.teamKey) ?? 0) + 1)
      }

      stints.push({
        playerKey,
        name: lastObs.name,
        teamKey: obs[start]!.teamKey,
        firstWeek,
        lastWeek: ongoing ? null : lastObs.week,
        weeksLost: j - start + 1,
        teams: [...byTeam].map(([teamKey, weeks]) => ({ teamKey, weeks })),
        status: ongoing ? lastObs.status : null,
        // Ended with the player gone from every roster, rather than activated.
        dropped: !ongoing && !rosteredWeeks.has(lastObs.week + 1),
        traded: byTeam.size > 1,
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
