/**
 * Trophy Room client helpers: loading the shards and deriving the handful of
 * figures the landing page leads with.
 *
 * Everything here is computed from the shards. No figure in the Trophy Room
 * is ever written into copy by hand, so every headline number on the page
 * traces back to a row a validator checked.
 */
import type { SeasonsShard, TrophySeason } from '../../src/domain/trophy'
import { useJson } from './useJson'

export type Tone = 'praise' | 'shame'

export function useTrophySeasons(leagueId: string) {
  return useJson<SeasonsShard>(`data/${leagueId}/trophy/seasons.json`)
}

export interface OwnerLookup {
  name: (ownerId: string) => string
  teamName: (ownerId: string, season: number) => string | null
}

export function ownerLookup(shard: SeasonsShard): OwnerLookup {
  const byId = new Map(shard.owners.map(o => [o.id, o]))
  return {
    name: id => byId.get(id)?.displayName ?? id,
    teamName: (id, season) => byId.get(id)?.teamNames[String(season)] ?? null,
  }
}

/** Seasons Yahoo has marked finished, newest first. */
export function finishedSeasons(shard: SeasonsShard): TrophySeason[] {
  return shard.seasons.filter(s => s.isFinished).sort((a, b) => b.season - a.season)
}

export interface HeroTile {
  label: string
  /** Owner display names. More than one means a genuine tie. */
  names: string[]
  /** The number that earns the tile, already formatted. */
  value: string
  /** Season, team name, or whatever else makes the number checkable. */
  detail: string
  tone: Tone
}

/**
 * The four figures the landing page leads with. Ties are returned as ties
 * rather than broken arbitrarily — three owners share the title lead and two
 * share the longest drought, and quietly picking one would be a lie.
 */
export function heroSummary(shard: SeasonsShard): HeroTile[] {
  const lookup = ownerLookup(shard)
  const finished = finishedSeasons(shard)
  const tiles: HeroTile[] = []
  if (finished.length === 0) return tiles

  const latest = finished[0]!
  const currentSeason = Math.max(...shard.seasons.map(s => s.season))

  if (latest.champion) {
    tiles.push({
      label: 'Reigning champion',
      names: [lookup.name(latest.champion.ownerId)],
      value: String(latest.season),
      detail: latest.champion.teamName,
      tone: 'praise',
    })
  }

  // Most titles
  const titles = new Map<string, number>()
  for (const season of finished) {
    if (!season.champion) continue
    titles.set(season.champion.ownerId, (titles.get(season.champion.ownerId) ?? 0) + 1)
  }
  const mostTitles = Math.max(0, ...titles.values())
  if (mostTitles > 0) {
    const leaders = [...titles.entries()].filter(([, n]) => n === mostTitles).map(([id]) => id)
    tiles.push({
      label: 'Most titles',
      names: leaders.map(lookup.name),
      value: `${mostTitles} ${mostTitles === 1 ? 'title' : 'titles'}`,
      detail: leaders.length > 1 ? `${leaders.length}-way tie` : 'outright',
      tone: 'praise',
    })
  }

  // Longest active drought. An owner who has never won is measured from their
  // first season, so "never" reads as a length rather than as an absence.
  const active = shard.owners.filter(o => o.teamNames[String(currentSeason)])
  let longest = -1
  let droughtLeaders: Array<{ id: string; everWon: boolean }> = []
  for (const owner of active) {
    const wins = finished.filter(s => s.champion?.ownerId === owner.id).map(s => s.season)
    const lastWin = wins.length > 0 ? Math.max(...wins) : null
    const played = Object.keys(owner.teamNames).map(Number).sort((a, b) => a - b)
    const drought = lastWin === null ? currentSeason - played[0]! + 1 : currentSeason - lastWin
    if (drought > longest) {
      longest = drought
      droughtLeaders = [{ id: owner.id, everWon: lastWin !== null }]
    } else if (drought === longest) {
      droughtLeaders.push({ id: owner.id, everWon: lastWin !== null })
    }
  }
  if (droughtLeaders.length > 0) {
    // Equal droughts among title-holders imply the same last-won season, so
    // the detail can name it. A mix of never-won and won cannot, so it says
    // nothing rather than something misleading.
    const neverWon = droughtLeaders.every(l => !l.everWon)
    const allWon = droughtLeaders.every(l => l.everWon)
    tiles.push({
      label: 'Longest active drought',
      names: droughtLeaders.map(l => lookup.name(l.id)),
      value: `${longest} ${longest === 1 ? 'season' : 'seasons'}`,
      detail: neverWon ? 'never won a title' : allWon ? `last won ${currentSeason - longest}` : 'since their last title',
      tone: 'shame',
    })
  }

  if (latest.lastPlace) {
    tiles.push({
      label: 'Reigning last place',
      names: [lookup.name(latest.lastPlace.ownerId)],
      value: String(latest.season),
      detail: latest.lastPlace.teamName,
      tone: 'shame',
    })
  }

  return tiles
}

export interface Wing {
  slug: string
  title: string
  blurb: string
  tone: Tone
}

/**
 * The wings, in the order the landing page lists them. Each is its own hash
 * route so a single section can be linked straight from a league email.
 */
export const WINGS: Wing[] = [
  {
    slug: 'champions',
    title: 'Hall of Champions',
    blurb: 'Every title since 2009, with the final that decided it.',
    tone: 'praise',
  },
  {
    slug: 'records',
    title: 'Weekly Records',
    blurb: 'The best and worst single weeks in every category.',
    tone: 'praise',
  },
  {
    slug: 'owners',
    title: 'Owners',
    blurb: 'All-time standings, and a page for every manager.',
    tone: 'praise',
  },
  {
    slug: 'rivalries',
    title: 'Rivalries',
    blurb: 'Head to head, all time, owner against owner.',
    tone: 'praise',
  },
  {
    slug: 'shame',
    title: 'Hall of Shame',
    blurb: 'Last place, repeat offenders, and the worst records on file.',
    tone: 'shame',
  },
  {
    slug: 'archive',
    title: 'Archive',
    blurb: 'Team names, transactions, streaks and the rest of the record.',
    tone: 'praise',
  },
]

export function wingBySlug(slug: string | null): Wing | null {
  return WINGS.find(w => w.slug === slug) ?? null
}

/** Range label for a stat that did not exist in every season, e.g. "2023-2026". */
export function seasonSpan(seasons: TrophySeason[]): string {
  if (seasons.length === 0) return ''
  const years = seasons.map(s => s.season).sort((a, b) => a - b)
  return `${years[0]}–${years[years.length - 1]}`
}
