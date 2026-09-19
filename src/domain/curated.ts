/**
 * Hand-entered content: the Veto Museum, keeper longevity, and one-off
 * plaques.
 *
 * Everything else in the Trophy Room is computed from stored data and can be
 * traced to a row. These cannot: they record things Yahoo never kept, like a
 * trade that was voted down or a player somebody held for six years. So they
 * are treated differently in three ways.
 *
 *   - **The source lives in the repo**, not on the data branch, so a change
 *     is reviewed like code and cannot be lost when the data branch is
 *     rebuilt. The pipeline copies it into the published shard.
 *   - **Every entry declares how well attested it is.** `confirmed` means
 *     there is a record; `reported` means somebody remembers it. The page
 *     says which.
 *   - **A claim about a statistic must carry evidence that resolves.** If an
 *     entry cites a team-week, the pipeline looks it up and fails the build
 *     when the number does not match. A curated plaque may be hand-written,
 *     but it may not be wrong.
 *
 * Nothing renders on the live site until `status` is `approved`, the same
 * rule the generated blurbs follow.
 */
import type { SeasonsShard, WeeklyShard } from './trophy.js'

export type CuratedStatus = 'draft' | 'approved'
/** How well attested an entry is. */
export type CuratedSource = 'confirmed' | 'reported'

export interface CuratedBase {
  /** Stable slug, used as the key and in links. */
  id: string
  status: CuratedStatus
  source: CuratedSource
  /** Where it came from: a thread, a screenshot, somebody's memory. */
  sourceNote?: string
}

/**
 * A claim about a specific team-week. The value is required so the pipeline
 * can check it; an unverifiable citation is worse than none.
 */
export interface StatEvidence {
  kind: 'team-week'
  season: number
  week: number
  ownerId: string
  /** Category abbreviation as it appears in the weekly columns. */
  category: string
  value: number
}

export interface VetoEntry extends CuratedBase {
  season: number
  /** The owners who agreed the trade, before the league intervened. */
  proposedBy: string[]
  players: Array<{ name: string; from: string; to: string }>
  /** Null when the vote was never recorded or never held. */
  vote: { against: number; inFavour: number; abstained: number } | null
  outcome: 'vetoed' | 'upheld' | 'withdrawn'
  /** Plain description of what happened. No quotes from the league email. */
  description: string
}

export interface KeeperEntry extends CuratedBase {
  ownerId: string
  playerName: string
  fromSeason: number
  toSeason: number
  description?: string
}

export interface PlaqueEntry extends CuratedBase {
  title: string
  season: number
  /** Null for a season-long honour. */
  week: number | null
  ownerId: string
  description: string
  evidence?: StatEvidence | null
}

export interface CuratedShard {
  leagueId: string
  vetoes: VetoEntry[]
  keepers: KeeperEntry[]
  plaques: PlaqueEntry[]
}

/** Seasons a keeper was held, inclusive. */
export const yearsKept = (entry: KeeperEntry): number =>
  entry.toSeason - entry.fromSeason + 1

export interface CuratedProblem {
  entry: string
  problem: string
  /** A mismatch is fatal; a note is worth reporting but does not fail. */
  fatal: boolean
}

/**
 * Check every curated entry against the computed record.
 *
 * Cited statistics must match exactly. Owner ids must exist. A keeper claim
 * that overlaps the seasons where keepers *are* derivable is compared with
 * them, and a disagreement is reported rather than thrown, because the
 * curated entry may be describing something the draft data cannot see.
 */
export function validateCurated(
  curated: CuratedShard,
  shard: SeasonsShard,
  weekly: WeeklyShard | null,
  derivedKeepers?: Array<{ season: number; ownerId: string; playerName: string }>,
): CuratedProblem[] {
  const problems: CuratedProblem[] = []
  const ownerIds = new Set(shard.owners.map(o => o.id))
  const seasons = new Set(shard.seasons.map(s => s.season))

  const checkOwner = (id: string, entry: string) => {
    if (!ownerIds.has(id)) {
      problems.push({ entry, problem: `unknown owner "${id}"`, fatal: true })
    }
  }
  const checkSeason = (season: number, entry: string) => {
    if (!seasons.has(season)) {
      problems.push({ entry, problem: `season ${season} is not in the record`, fatal: true })
    }
  }

  for (const veto of curated.vetoes) {
    checkSeason(veto.season, `veto:${veto.id}`)
    for (const id of veto.proposedBy) checkOwner(id, `veto:${veto.id}`)
    for (const player of veto.players) {
      checkOwner(player.from, `veto:${veto.id}`)
      checkOwner(player.to, `veto:${veto.id}`)
    }
    if (veto.vote && veto.vote.against + veto.vote.inFavour + veto.vote.abstained === 0) {
      problems.push({ entry: `veto:${veto.id}`, problem: 'a vote is recorded but every count is zero', fatal: false })
    }
  }

  for (const keeper of curated.keepers) {
    checkOwner(keeper.ownerId, `keeper:${keeper.id}`)
    checkSeason(keeper.fromSeason, `keeper:${keeper.id}`)
    checkSeason(keeper.toSeason, `keeper:${keeper.id}`)
    if (keeper.toSeason < keeper.fromSeason) {
      problems.push({ entry: `keeper:${keeper.id}`, problem: 'ends before it starts', fatal: true })
    }
    if (derivedKeepers) {
      // Only the seasons the draft data can speak to.
      const covered = derivedKeepers.filter(k => k.ownerId === keeper.ownerId)
      const knownSeasons = new Set(derivedKeepers.map(k => k.season))
      for (let year = keeper.fromSeason; year <= keeper.toSeason; year++) {
        if (!knownSeasons.has(year)) continue
        const held = covered.some(k => k.season === year && k.playerName === keeper.playerName)
        if (!held) {
          problems.push({
            entry: `keeper:${keeper.id}`,
            problem: `the draft data for ${year} does not list ${keeper.playerName} as a keeper`,
            fatal: false,
          })
        }
      }
    }
  }

  for (const plaque of curated.plaques) {
    checkOwner(plaque.ownerId, `plaque:${plaque.id}`)
    checkSeason(plaque.season, `plaque:${plaque.id}`)
    const evidence = plaque.evidence
    if (!evidence) continue
    checkOwner(evidence.ownerId, `plaque:${plaque.id}`)
    if (!weekly) {
      problems.push({ entry: `plaque:${plaque.id}`, problem: 'cites a team-week but the weekly shard is unavailable', fatal: false })
      continue
    }
    const col = (n: string) => weekly.columns.indexOf(n)
    const ownerIndex = shard.owners.findIndex(o => o.id === evidence.ownerId)
    const categoryColumn = col(evidence.category)
    if (categoryColumn < 0) {
      problems.push({ entry: `plaque:${plaque.id}`, problem: `unknown category "${evidence.category}"`, fatal: true })
      continue
    }
    const row = weekly.rows.find(r =>
      r[col('season')] === evidence.season &&
      r[col('week')] === evidence.week &&
      r[col('owner')] === ownerIndex)
    if (!row) {
      problems.push({
        entry: `plaque:${plaque.id}`,
        problem: `no team-week for ${evidence.ownerId} in ${evidence.season} week ${evidence.week}`,
        fatal: true,
      })
      continue
    }
    const actual = row[categoryColumn]
    if (actual !== evidence.value) {
      problems.push({
        entry: `plaque:${plaque.id}`,
        problem: `claims ${evidence.category} ${evidence.value} but the record says ${actual}`,
        fatal: true,
      })
    }
  }

  return problems
}

/** Only approved entries, unless drafts are explicitly allowed. */
export function visibleCurated(curated: CuratedShard, allowDrafts: boolean): CuratedShard {
  const keep = <T extends CuratedBase>(items: T[]) =>
    items.filter(i => i.status === 'approved' || allowDrafts)
  return {
    leagueId: curated.leagueId,
    vetoes: keep(curated.vetoes),
    keepers: keep(curated.keepers),
    plaques: keep(curated.plaques),
  }
}
