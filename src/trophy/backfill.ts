/**
 * Trophy Room historical backfill: every KP season, 2009 to now, into four
 * shards under data/kp/trophy/.
 *
 * Idempotent by construction. Every Yahoo read goes through cachedGet, which
 * stores the raw response under data/.cache/yahoo/, so a rerun re-derives the
 * shards from disk without touching the API. `--force` re-fetches.
 *
 * Cheap, too: Yahoo accepts a comma-separated week list, so a whole season's
 * matchups and per-category team totals arrive in one request. A full
 * backfill is four calls per season plus paged transactions.
 *
 * Flags:
 *   --refresh <season>   re-fetch just that season ("current" for the latest),
 *                        then rebuild every shard. This is the end-of-season job.
 *   --force              re-fetch every season. Rarely needed.
 *   --season <season>    process ONLY that season. Implies --dry-run, because
 *                        shards built from one season would clobber the other
 *                        seventeen. Debugging aid, not an update path.
 *   --dry-run            validate and report, write nothing.
 *   --skip-transactions  leave transactions.json alone.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tagBrackets, type BracketGame } from '../domain/brackets.js'
import { leagueById } from '../domain/leagues.js'
import { OWNERS, resolveOwner, type Owner } from '../domain/owners.js'
import {
  BRACKET_CODES,
  parseAtBats,
  parseInningsPitched,
  type Bracket,
  type MatchupShard,
  type SeasonsShard,
  type TransactionMove,
  type TransactionRow,
  type TransactionsShard,
  type TrophyCategory,
  type TrophySeason,
  type TrophyStandingsRow,
  type TrophyWeek,
  type WeeklyShard,
} from '../domain/trophy.js'
import { statKey, type LeagueSeasonSettings, type StatCategory } from '../domain/stats.js'
import { normalizeScoreboard } from '../yahoo/normalize/scoreboard.js'
import { normalizeSettings } from '../yahoo/normalize/settings.js'
import { normalizeStandings } from '../yahoo/normalize/standings.js'
import { cachedGet } from './cache.js'
import { validate } from './validate.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DATA_DIR = path.join(ROOT, 'data')
const LEAGUE_ID = 'kp'

const args = process.argv.slice(2)
const forceAll = args.includes('--force')
const skipTransactions = args.includes('--skip-transactions')
const seasonFilter = args.includes('--season') ? args[args.indexOf('--season') + 1] ?? null : null
const refreshArg = args.includes('--refresh') ? args[args.indexOf('--refresh') + 1] ?? null : null
// A partial build must never be published: the shards are whole-history
// documents, so writing one built from a single season would delete the rest.
const dryRun = args.includes('--dry-run') || seasonFilter !== null

type AnyObj = Record<string, any>
const asObj = (v: unknown): AnyObj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyObj) : {}
function* indexed(o: AnyObj): Generator<any> {
  const count = Number(o['count'] ?? 0)
  for (let i = 0; i < count; i++) yield o[String(i)]
}
const findKey = (arr: any[], key: string): any =>
  arr.find(x => x && typeof x === 'object' && key in x)?.[key]

/** Yahoo returns `managers` as a real array here and a pseudo-array there. */
function managerNickname(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : asObj(value)['0']
  const mgr = asObj(asObj(first)['manager'])
  return mgr['nickname'] ? String(mgr['nickname']) : null
}

/**
 * Rate categories, which are undefined rather than zero when their
 * denominator is empty. Yahoo does not mark these, so they are declared
 * here and the validator fails on any category that is not classified.
 */
const RATE_STATS = new Set(['batting:3', 'batting:4', 'pitching:26', 'pitching:27'])
const isRate = (c: StatCategory) => RATE_STATS.has(statKey(c.role, c.statId))

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value))
}

function daysBetween(start: string, end: string): number {
  const s = Date.parse(`${start}T00:00:00Z`)
  const e = Date.parse(`${end}T00:00:00Z`)
  return Math.round((e - s) / 86_400_000) + 1
}

/** Parse a Yahoo stat value, honouring "nothing accrued" vs "undefined". */
function statValue(raw: string, category: StatCategory): number | null {
  if (raw === '' || raw === '-') return isRate(category) ? null : 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

const league = leagueById(LEAGUE_ID)

// ---------------------------------------------------------------- owners
// Index order is owners.json order, so a row's owner index is stable across
// runs and a new owner appends rather than renumbering history.
const ownerIndex = new Map<string, number>(OWNERS.map((o, i) => [o.id, i]))
const teamNamesByOwner = new Map<string, Record<string, string>>()
const seasonsByOwner = new Map<string, number[]>()

// ---------------------------------------------------------------- shards
const seasons: TrophySeason[] = []
const weeklyRows: Array<Array<number | null>> = []
const matchupRows: Array<Array<number | string | null>> = []
const transactionRows: TransactionRow[] = []
const unavailableTransactions: TransactionsShard['unavailable'] = []
/** Interned so 18,600 player movements do not repeat 2,200 names. */
const playerNames: string[] = []
const playerNameIndex = new Map<string, number>()
const internPlayer = (name: string): number => {
  const hit = playerNameIndex.get(name)
  if (hit !== undefined) return hit
  const i = playerNames.push(name) - 1
  playerNameIndex.set(name, i)
  return i
}
const txTypes: string[] = []
const internType = (type: string): number => {
  const i = txTypes.indexOf(type)
  return i >= 0 ? i : txTypes.push(type) - 1
}

/** Global category order, so one column list covers every season. */
const globalCategories: TrophyCategory[] = []
const globalCatKeys: string[] = []
function registerCategories(cats: StatCategory[]): void {
  for (const c of cats) {
    if (c.isDisplayOnly) continue
    const key = statKey(c.role, c.statId)
    if (globalCatKeys.includes(key)) continue
    globalCatKeys.push(key)
    globalCategories.push({
      statId: c.statId, role: c.role, abbr: c.abbr, name: c.name,
      higherIsBetter: c.higherIsBetter, isDisplayOnly: c.isDisplayOnly,
    })
  }
}

const allSeasons = Object.keys(league.seasons).sort()
const latestSeason = allSeasons[allSeasons.length - 1]!
const refreshSeason = refreshArg === 'current' ? latestSeason : refreshArg
if (refreshArg && !league.seasons[refreshSeason!]) {
  throw new Error(`--refresh ${refreshArg}: no such season in the league registry`)
}

const entries = Object.entries(league.seasons).filter(
  ([season]) => !seasonFilter || season === seasonFilter,
)
if (seasonFilter && !league.seasons[seasonFilter]) {
  throw new Error(`--season ${seasonFilter}: no such season in the league registry`)
}

/** Re-fetch only what the caller asked to refresh; everything else is cached. */
const forceFor = (season: string): boolean => forceAll || season === refreshSeason

for (const [season, leagueKey] of entries) {
  const notes: string[] = []
  const force = forceFor(season)

  const settings: LeagueSeasonSettings = normalizeSettings(
    (await cachedGet(`league/${leagueKey}/settings`, { force })).data,
    LEAGUE_ID,
  )
  const scored = settings.categories.filter(c => !c.isDisplayOnly)
  registerCategories(settings.categories)

  const metaRaw = (await cachedGet(`league/${leagueKey}`, { force })).data
  const meta = asObj((metaRaw.fantasy_content as AnyObj)['league'][0])
  const startWeek = Number(meta['start_week'] ?? 1)
  const endWeek = Number(meta['end_week'] ?? startWeek)
  const isFinished = String(meta['is_finished'] ?? '0') === '1'

  // ---- teams: the (teamKey → owner, team name) map for the whole season
  const teamsRaw = (await cachedGet(`league/${leagueKey}/teams`, { force })).data
  const ownerByTeamKey = new Map<string, Owner>()
  const teamNameByKey = new Map<string, string>()
  for (const entry of indexed(asObj(asObj((teamsRaw.fantasy_content as AnyObj)['league'][1])['teams']))) {
    const arr = asObj(entry)['team'][0] as any[]
    const teamKey = String(findKey(arr, 'team_key'))
    const teamName = String(findKey(arr, 'name'))
    const owner = resolveOwner(season, teamName, managerNickname(findKey(arr, 'managers')))
    ownerByTeamKey.set(teamKey, owner)
    teamNameByKey.set(teamKey, teamName)

    const names = teamNamesByOwner.get(owner.id) ?? {}
    names[season] = teamName
    teamNamesByOwner.set(owner.id, names)
    seasonsByOwner.set(owner.id, [...(seasonsByOwner.get(owner.id) ?? []), Number(season)])
  }

  // ---- standings: regular-season record, plus Yahoo's final rank
  const standingsRows = normalizeStandings(
    (await cachedGet(`league/${leagueKey}/standings`, { force })).data,
  )
  const hasEverySeed = standingsRows.every(r => r.playoffSeed !== null)
  const seedSource = hasEverySeed ? 'yahoo-playoff-seed' : 'yahoo-final-rank'
  if (!hasEverySeed) {
    notes.push(
      'Yahoo seeded only the teams that reached a bracket this season, so the regular-season ' +
      'order below the bracket comes from its final rank instead. Those teams played no ' +
      'bracket games, so the two orderings cannot disagree.',
    )
  }
  // Seeded teams by seed, then the rest by Yahoo's final rank.
  const orderedStandings = [...standingsRows].sort((a, b) => {
    const aSeed = a.playoffSeed ?? Number.POSITIVE_INFINITY
    const bSeed = b.playoffSeed ?? Number.POSITIVE_INFINITY
    return aSeed !== bSeed ? aSeed - bSeed : a.rank - b.rank
  })
  const standings: TrophyStandingsRow[] = orderedStandings.map((r, i) => ({
    ownerId: ownerByTeamKey.get(r.teamKey)!.id,
    teamName: r.name,
    seed: i + 1,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    percentage: r.percentage,
  }))

  // ---- scoreboard: one request for the whole season
  const weekList = Array.from({ length: endWeek - startWeek + 1 }, (_, i) => startWeek + i).join(',')
  const scoreboardRaw = (await cachedGet(`league/${leagueKey}/scoreboard;week=${weekList}`, { force })).data
  const { matchups } = normalizeScoreboard(scoreboardRaw, settings)

  const playoffWeeks = [...new Set(matchups.filter(m => m.isPlayoffs).map(m => m.week))].sort((a, b) => a - b)
  const regularSeasonWeeks = [...new Set(matchups.filter(m => !m.isPlayoffs).map(m => m.week))].sort((a, b) => a - b)

  const games: BracketGame[] = matchups.map(m => ({
    week: m.week,
    teamKeys: [m.teams[0].teamKey, m.teams[1].teamKey],
    isPlayoff: m.isPlayoffs,
    isConsolation: m.isConsolation,
    winnerTeamKey: m.winnerTeamKey,
  }))
  const tagging = tagBrackets(games, playoffWeeks)
  for (const problem of tagging.problems) notes.push(`Bracket: ${problem}`)

  // ---- weeks
  const weekMeta = new Map<number, TrophyWeek>()
  for (const m of matchups) {
    if (weekMeta.has(m.week) || !m.weekStart || !m.weekEnd) continue
    const days = daysBetween(m.weekStart, m.weekEnd)
    weekMeta.set(m.week, {
      week: m.week,
      start: m.weekStart,
      end: m.weekEnd,
      days,
      isExtended: days > 7,
      isShort: days < 7,
      isPlayoff: m.isPlayoffs,
    })
  }
  const weeks = [...weekMeta.values()].sort((a, b) => a.week - b.week)

  // ---- rows
  const ipCategory = settings.categories.find(c => c.isDisplayOnly && c.abbr === 'IP')
  const abCategory = settings.categories.find(c => c.isDisplayOnly && c.abbr.includes('/'))
  const hasAtBats = !!abCategory
  let startedNobody = 0

  matchups.forEach((m, mi) => {
    const bracket: Bracket = tagging.brackets[mi]!
    const bracketCode = BRACKET_CODES[bracket]
    const week = weekMeta.get(m.week)

    for (const team of m.teams) {
      const owner = ownerByTeamKey.get(team.teamKey)
      if (!owner) throw new Error(`${season}: no owner for team ${team.teamKey}`)
      const values = globalCatKeys.map(key => {
        const category = scored.find(c => statKey(c.role, c.statId) === key)
        if (!category) return null // category did not exist this season
        return statValue(team.stats[key as never] ?? '', category)
      })
      const ipRaw = ipCategory ? parseInningsPitched(team.stats[statKey('pitching', ipCategory.statId)] ?? '') : null
      // A third of an inning repeats forever in binary; three places is exact
      // enough to rank by and keeps ~4,800 rows from carrying 15 digits each.
      const ip = ipRaw === null ? null : Math.round(ipRaw * 1000) / 1000
      const ab = abCategory ? parseAtBats(team.stats[statKey('batting', abCategory.statId)] ?? '') : null
      if (team.completedGames === 0) startedNobody++
      weeklyRows.push([
        Number(season), m.week, ownerIndex.get(owner.id)!,
        week?.days ?? 0, bracketCode,
        ...values, ab, ip, team.completedGames,
      ])
    }

    const [a, b] = m.teams
    const results = globalCatKeys
      .map(key => {
        const outcome = a.results[key as never]
        if (!outcome) return '.'
        return outcome === 'win' ? 'W' : outcome === 'loss' ? 'L' : 'T'
      })
      .join('')
    const winnerOwner = m.winnerTeamKey ? ownerByTeamKey.get(m.winnerTeamKey) : null
    matchupRows.push([
      Number(season), m.week,
      ownerIndex.get(ownerByTeamKey.get(a.teamKey)!.id)!,
      ownerIndex.get(ownerByTeamKey.get(b.teamKey)!.id)!,
      bracketCode, results,
      winnerOwner ? ownerIndex.get(winnerOwner.id)! : null,
    ])
  })

  if (startedNobody > 0) {
    notes.push(
      `${startedNobody} team-week(s) this season completed no games at all. Those are real ` +
      `results, not gaps: the roster was in place and every player was benched, so the ` +
      `counting categories are genuinely zero and the rate categories are undefined.`,
    )
  }
  if (!hasAtBats) {
    notes.push(
      'Yahoo carries no at-bat denominator this season, so the minimum-AB qualifier for ' +
      'AVG and OBP cannot be applied. Innings pitched is present, so ERA and WHIP qualify normally.',
    )
  }

  // ---- champion, cross-checked against Yahoo's own final standings
  const byFinalRank = [...standingsRows].sort((a, b) => a.rank - b.rank)
  const champTeamKey = tagging.championTeamKey
  const runnerTeamKey = tagging.runnerUpTeamKey
  if (isFinished && champTeamKey && byFinalRank[0] && champTeamKey !== byFinalRank[0].teamKey) {
    throw new Error(
      `${season}: computed champion ${champTeamKey} does not match Yahoo final rank 1 ` +
      `${byFinalRank[0].teamKey}. Refusing to publish a disputed title.`,
    )
  }

  const titleOf = (teamKey: string | null) =>
    teamKey && ownerByTeamKey.has(teamKey)
      ? { ownerId: ownerByTeamKey.get(teamKey)!.id, teamName: teamNameByKey.get(teamKey)! }
      : null
  const lastRow = standings[standings.length - 1]

  seasons.push({
    season: Number(season),
    leagueKey,
    numTeams: settings.numTeams,
    categories: scored.map(c => ({
      statId: c.statId, role: c.role, abbr: c.abbr, name: c.name,
      higherIsBetter: c.higherIsBetter, isDisplayOnly: c.isDisplayOnly,
    })),
    statOrder: scored.map(c => c.abbr),
    hasAtBats,
    weeks,
    regularSeasonWeeks,
    playoffWeeks,
    playoffStartWeek: settings.playoffStartWeek,
    numPlayoffTeams: settings.numPlayoffTeams,
    standings,
    seedSource,
    tiebreak: Number(season) >= 2024 ? 'regular-season-record' : 'head-to-head',
    champion: isFinished ? titleOf(champTeamKey) : null,
    runnerUp: isFinished ? titleOf(runnerTeamKey) : null,
    lastPlace: isFinished && lastRow ? { ownerId: lastRow.ownerId, teamName: lastRow.teamName } : null,
    isFinished,
    notes,
  })

  console.log(
    `${season}  weeks=${weeks.length} matchups=${matchups.length} ` +
    `teamWeeks=${matchups.length * 2} champion=${seasons.at(-1)!.champion?.ownerId ?? '—'}`,
  )
}

// ------------------------------------------------------------ transactions
if (!skipTransactions) {
  const PAGE = 25
  for (const [season, leagueKey] of entries) {
    const force = forceFor(season)
    const teamsRaw = (await cachedGet(`league/${leagueKey}/teams`, { force })).data
    const ownerByTeamKey = new Map<string, string>()
    for (const entry of indexed(asObj(asObj((teamsRaw.fantasy_content as AnyObj)['league'][1])['teams']))) {
      const arr = asObj(entry)['team'][0] as any[]
      const teamKey = String(findKey(arr, 'team_key'))
      const teamName = String(findKey(arr, 'name'))
      ownerByTeamKey.set(teamKey, resolveOwner(season, teamName, managerNickname(findKey(arr, 'managers'))).id)
    }

    const txMeta = (entry: any): AnyObj => {
      const t = asObj(entry)['transaction']
      return Array.isArray(t) ? asObj(t[0]) : asObj(t)
    }
    const txPlayers = (entry: any): AnyObj => {
      const t = asObj(entry)['transaction']
      return asObj(Array.isArray(t) ? asObj(t[1])['players'] : asObj(t)['players'])
    }
    // A team side becomes an owner index; anything else keeps Yahoo's word
    // for it ("freeagents", "waivers"), so the row is self-describing.
    const side = (td: AnyObj, which: 'source' | 'destination'): number | string | null => {
      const type = String(td[`${which}_type`] ?? '')
      if (type === 'team') {
        const key = String(td[`${which}_team_key`] ?? '')
        const ownerId = ownerByTeamKey.get(key)
        return ownerId !== undefined ? ownerIndex.get(ownerId)! : key || null
      }
      return type || null
    }

    const collect = (block: AnyObj): void => {
      for (const entry of indexed(block)) {
        const meta = txMeta(entry)
        const moves: TransactionMove[] = []
        for (const p of indexed(txPlayers(entry))) {
          const pair = asObj(p)['player'] as any[]
          if (!Array.isArray(pair) || pair.length < 2) continue
          const info = pair[0] as any[]
          const name = String(asObj(findKey(info, 'name'))['full'] ?? '')
          const tdRaw = asObj(pair[1])['transaction_data']
          const td = asObj(Array.isArray(tdRaw) ? tdRaw[0] : tdRaw)
          moves.push([internPlayer(name), side(td, 'source'), side(td, 'destination')])
        }
        const ts = Number(meta['timestamp'] ?? 0)
        transactionRows.push([
          Number(season),
          ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '',
          internType(String(meta['type'] ?? '')),
          moves,
        ])
      }
    }

    let lost = 0
    for (let start = 0; ; start += PAGE) {
      const page = await cachedGet(`league/${leagueKey}/transactions;start=${start};count=${PAGE}`, {
        allowRefusal: true, force,
      })
      if (page.refused) {
        // One deleted player key poisons a whole page; recover the rest singly.
        for (let i = start; i < start + PAGE; i++) {
          const one = await cachedGet(`league/${leagueKey}/transactions;start=${i};count=1`, {
            allowRefusal: true, force,
          })
          if (one.refused) {
            lost++
            unavailableTransactions.push({
              season: Number(season), listIndex: i,
              reason: 'Yahoo returns HTTP 400: the transaction references a player record it has deleted',
            })
            continue
          }
          collect(asObj(asObj((one.data.fantasy_content as AnyObj)['league'][1])['transactions']))
        }
        continue
      }
      const block = asObj(asObj((page.data.fantasy_content as AnyObj)['league'][1])['transactions'])
      if (Number(block['count'] ?? 0) === 0) break
      collect(block)
    }
    const seasonTx = transactionRows.filter(t => t[0] === Number(season))
    if (lost > 0) {
      const target = seasons.find(s => s.season === Number(season))
      target?.notes.push(
        `${lost} transaction(s) are unavailable: Yahoo returns HTTP 400 for them because they ` +
        `reference player records it has deleted. Transaction counts for this season are a ` +
        `known undercount by exactly that many.`,
      )
    }
    const tradeType = txTypes.indexOf('trade')
    console.log(`${season}  transactions=${seasonTx.length} lost=${lost} trades=${seasonTx.filter(t => t[2] === tradeType).length}`)
  }
}

// ------------------------------------------------------------------ write
const owners = OWNERS.map(o => {
  const yrs = (seasonsByOwner.get(o.id) ?? []).sort((a, b) => a - b)
  return {
    id: o.id,
    displayName: o.displayName,
    firstSeason: yrs[0] ?? 0,
    lastSeason: yrs.at(-1) ?? 0,
    seasonsPlayed: yrs.length,
    teamNames: teamNamesByOwner.get(o.id) ?? {},
  }
})

const weeklyColumns = [
  'season', 'week', 'owner', 'days', 'bracket',
  ...globalCategories.map(c => c.abbr),
  'ab', 'ip', 'completedGames',
]
const matchupColumns = ['season', 'week', 'ownerA', 'ownerB', 'bracket', 'results', 'winner']

const seasonsShard: SeasonsShard = {
  leagueId: LEAGUE_ID,
  owners,
  weeklyColumns,
  matchupColumns,
  seasons: seasons.sort((a, b) => a.season - b.season),
}
const weeklyShard: WeeklyShard = { leagueId: LEAGUE_ID, columns: weeklyColumns, rows: weeklyRows }
const matchupShard: MatchupShard = { leagueId: LEAGUE_ID, columns: matchupColumns, rows: matchupRows }
const transactionsShard: TransactionsShard = {
  leagueId: LEAGUE_ID,
  types: txTypes,
  playerNames,
  rows: transactionRows,
  unavailable: unavailableTransactions,
}

const report = validate({ seasonsShard, weeklyShard, matchupShard, transactionsShard, globalCategories })
console.log('\n' + report.text)
if (!report.ok) {
  console.error('Validation failed — refusing to write shards.')
  process.exit(1)
}

if (dryRun) {
  console.log(
    seasonFilter
      ? `\nDry run: --season ${seasonFilter} builds only part of the history, so nothing was written.`
      : '\nDry run: nothing written.',
  )
  process.exit(0)
}

const outDir = path.join(DATA_DIR, LEAGUE_ID, 'trophy')
writeJson(path.join(outDir, 'seasons.json'), seasonsShard)
writeJson(path.join(outDir, 'weekly.json'), weeklyShard)
writeJson(path.join(outDir, 'matchups.json'), matchupShard)
if (!skipTransactions) writeJson(path.join(outDir, 'transactions.json'), transactionsShard)
console.log(`\nWrote shards to data/${LEAGUE_ID}/trophy/`)
