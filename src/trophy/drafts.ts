/**
 * Draft facts the record book needs: each season's keepers, and who actually
 * made the first overall pick.
 *
 * Keeper identification is the delicate part, and it has a boundary.
 *
 * Yahoo used to annotate each draft_result with `type: 'keeper'` and no
 * longer does — the same withdrawal that removed manager GUIDs. What remains
 * is the league's house rule: five keepers per team, slotted as that team's
 * last five picks. That rule reproduces 2026's sixty keepers exactly, checked
 * against the draft shard generated while Yahoo's annotation still existed.
 *
 * But it only describes reality from 2015 on, and the data says so rather
 * than the rule being assumed. Two independent signals agree on the year:
 *
 *   - Retention. From 2016 onward, 42% to 75% of a season's last-five picks
 *     were the same owner's last-five picks the year before, which is what
 *     keeping a player looks like. Before 2015 it is 0% to 2%, which is what
 *     ordinary late-round picks look like.
 *   - Draft order. The first overall pick belongs to the previous season's
 *     last-place team every year from 2015, and never once before it.
 *
 * So a season reports keepers only when its last-five picks were carried in
 * from the previous season or carried out into the next. Seasons that fail
 * that test report no keepers at all, with the evidence recorded, rather than
 * presenting ordinary late picks as kept players.
 */
import { keeperOverallPicks, parseDraftResults, type ParsedDraftPick } from '../yahoo/normalize/draft.js'
import { cachedGet } from './cache.js'

/** Yahoo caps the players collection at 25 keys per request. */
const PLAYER_PAGE = 25
/**
 * Share of a season's candidate keepers that must be carried in or out for
 * the set to be treated as real. The observed gap is 2% against 42%, so the
 * threshold sits well clear of both.
 */
const RETENTION_THRESHOLD = 0.2

type AnyObj = Record<string, any>
const asObj = (v: unknown): AnyObj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyObj) : {}
function* indexed(o: AnyObj): Generator<any> {
  const count = Number(o['count'] ?? 0)
  for (let i = 0; i < count; i++) yield o[String(i)]
}
const findKey = (arr: any[], key: string): any =>
  arr.find(x => x && typeof x === 'object' && key in x)?.[key]

export interface TrophyKeeper {
  ownerId: string
  playerName: string
  /** Yahoo round the keeper was slotted into. */
  round: number
}

export interface TrophyDraftSeason {
  season: number
  /**
   * How the keepers were identified. 'house-rule' means derived from the
   * league's five-per-team convention because Yahoo no longer annotates;
   * 'none' means the evidence does not support reporting any.
   */
  keeperSource: 'yahoo-annotation' | 'house-rule' | 'none'
  keepers: TrophyKeeper[]
  /** What the retention test found, so the boundary is auditable. */
  keeperEvidence: {
    candidates: number
    carriedInFromPrevious: number | null
    carriedOutToNext: number | null
  }
  /** Who actually made pick 1.1, and on whom they spent it. */
  firstPick: { ownerId: string; playerName: string } | null
  /**
   * Whether the first overall pick belonged to the previous season's
   * last-place team. Null when there is no previous season to compare.
   */
  firstPickWentToLastPlace: boolean | null
  notes: string[]
}

export interface DraftsShard {
  leagueId: string
  /** First season whose keepers the evidence supports reporting. */
  firstKeeperSeason: number | null
  /** First season whose draft order followed reverse regular-season standings. */
  firstReverseOrderSeason: number | null
  seasons: TrophyDraftSeason[]
}

/** Look up display names for a set of player keys, batched. */
async function playerNames(
  leagueKey: string,
  playerKeys: string[],
  force: boolean,
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const unique = [...new Set(playerKeys)]
  for (let i = 0; i < unique.length; i += PLAYER_PAGE) {
    const batch = unique.slice(i, i + PLAYER_PAGE)
    const raw = (await cachedGet(
      `league/${leagueKey}/players;player_keys=${batch.join(',')}`,
      { force },
    )).data
    const players = asObj(asObj((raw.fantasy_content as AnyObj)['league'][1])['players'])
    for (const entry of indexed(players)) {
      const arr = asObj(entry)['player'][0] as any[]
      const key = String(findKey(arr, 'player_key') ?? '')
      const full = String(asObj(findKey(arr, 'name'))['full'] ?? '')
      if (key && full) names.set(key, full)
    }
  }
  return names
}

export async function buildDrafts(
  leagueId: string,
  entries: Array<[string, string]>,
  ownerByTeamKeyBySeason: Map<string, Map<string, string>>,
  lastPlaceBySeason: Map<number, string>,
  forceFor: (season: string) => boolean,
): Promise<DraftsShard> {
  // ---- pass one: candidate keepers and the first pick, per season
  interface Candidate {
    season: number
    annotated: boolean
    keepers: TrophyKeeper[]
    firstPick: { ownerId: string; playerName: string } | null
    notes: string[]
    usable: boolean
  }
  const candidates: Candidate[] = []

  for (const [season, leagueKey] of entries) {
    const force = forceFor(season)
    const notes: string[] = []
    const ownerByTeamKey = ownerByTeamKeyBySeason.get(season)
    if (!ownerByTeamKey) throw new Error(`${season}: no owner map for the draft build`)

    const raw = await cachedGet(`league/${leagueKey}/draftresults`, { force, allowRefusal: true })
    if (raw.refused) {
      candidates.push({
        season: Number(season), annotated: false, keepers: [], firstPick: null, usable: false,
        notes: ['Yahoo will not serve this season\'s draft results, so keepers and the first pick are unavailable.'],
      })
      continue
    }

    const picks: ParsedDraftPick[] = parseDraftResults(raw.data as never)
    const annotated = picks.some(p => p.type !== null)
    const keeperOveralls = keeperOverallPicks(picks)
    const keeperPicks = picks.filter(p => keeperOveralls.has(p.overall))
    const firstPickRow = picks.find(p => p.overall === 1) ?? null

    const perTeam = new Map<string, number>()
    for (const p of keeperPicks) perTeam.set(p.teamKey, (perTeam.get(p.teamKey) ?? 0) + 1)
    const offTarget = [...perTeam.entries()].filter(([, n]) => n !== 5)
    const usable = annotated || offTarget.length === 0
    if (!usable) {
      notes.push(
        `${offTarget.length} team(s) do not have exactly five keepers under the house rule, ` +
        `so this season's keepers are not reported.`,
      )
    }

    const names = await playerNames(leagueKey, [
      ...(usable ? keeperPicks.map(p => p.playerKey) : []),
      ...(firstPickRow ? [firstPickRow.playerKey] : []),
    ], force)

    candidates.push({
      season: Number(season),
      annotated,
      usable,
      keepers: usable
        ? keeperPicks.map(p => ({
            ownerId: ownerByTeamKey.get(p.teamKey) ?? p.teamKey,
            playerName: names.get(p.playerKey) ?? 'Unknown player',
            round: p.round,
          }))
        : [],
      firstPick: firstPickRow
        ? {
            ownerId: ownerByTeamKey.get(firstPickRow.teamKey) ?? firstPickRow.teamKey,
            playerName: names.get(firstPickRow.playerKey) ?? 'Unknown player',
          }
        : null,
      notes,
    })
  }

  // ---- pass two: does each season's candidate set behave like keepers?
  const byYear = new Map(candidates.map(c => [c.season, c]))
  const setOf = (c: Candidate | undefined) =>
    new Set((c?.keepers ?? []).map(k => `${k.ownerId}|${k.playerName}`))

  const overlap = (a: Candidate | undefined, b: Candidate | undefined): number | null => {
    if (!a || !b || a.keepers.length === 0 || b.keepers.length === 0) return null
    const prior = setOf(a)
    return b.keepers.filter(k => prior.has(`${k.ownerId}|${k.playerName}`)).length
  }

  const seasons: TrophyDraftSeason[] = []
  for (const c of candidates) {
    const carriedIn = overlap(byYear.get(c.season - 1), c)
    const carriedOut = overlap(c, byYear.get(c.season + 1))
    const share = (n: number | null, of: number) => (n === null || of === 0 ? null : n / of)
    const inShare = share(carriedIn, c.keepers.length)
    const outShare = share(carriedOut, byYear.get(c.season + 1)?.keepers.length ?? 0)

    const looksKept =
      (inShare !== null && inShare >= RETENTION_THRESHOLD) ||
      (outShare !== null && outShare >= RETENTION_THRESHOLD)
    const report = c.annotated || (c.usable && looksKept)

    const notes = [...c.notes]
    if (report && !c.annotated) {
      notes.push(
        'Keepers are derived from the league\'s house rule — each team\'s final five picks — ' +
        'because Yahoo no longer annotates them.',
      )
    }
    if (!report && c.usable) {
      notes.push(
        'No keepers are reported for this season. Its last five picks per team were not carried ' +
        'in from the previous season or out into the next, so they read as ordinary late-round ' +
        'picks rather than kept players.',
      )
    }

    const previousLast = lastPlaceBySeason.get(c.season - 1) ?? null
    seasons.push({
      season: c.season,
      keeperSource: report ? (c.annotated ? 'yahoo-annotation' : 'house-rule') : 'none',
      keepers: report ? c.keepers : [],
      keeperEvidence: {
        candidates: c.keepers.length,
        carriedInFromPrevious: carriedIn,
        carriedOutToNext: carriedOut,
      },
      firstPick: c.firstPick,
      firstPickWentToLastPlace:
        previousLast === null || !c.firstPick ? null : c.firstPick.ownerId === previousLast,
      notes,
    })
  }

  const keeperYears = seasons.filter(s => s.keepers.length > 0).map(s => s.season)
  // The first season from which reverse order holds without exception.
  const reverse = seasons.filter(s => s.firstPickWentToLastPlace !== null)
  let firstReverse: number | null = null
  for (let i = 0; i < reverse.length; i++) {
    if (reverse.slice(i).every(s => s.firstPickWentToLastPlace === true)) {
      firstReverse = reverse[i]!.season
      break
    }
  }

  for (const s of seasons) {
    console.log(
      `${s.season}  keepers=${s.keepers.length} (${s.keeperSource}) ` +
      `carriedIn=${s.keeperEvidence.carriedInFromPrevious ?? '-'} ` +
      `firstPick=${s.firstPick?.ownerId ?? '—'}` +
      `${s.firstPickWentToLastPlace === false ? ' (not last place)' : ''}`,
    )
  }

  return {
    leagueId,
    firstKeeperSeason: keeperYears.length > 0 ? Math.min(...keeperYears) : null,
    firstReverseOrderSeason: firstReverse,
    seasons,
  }
}
