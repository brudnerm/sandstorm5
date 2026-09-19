/**
 * Stage 8 deliverable: sample numbers the page displays and trace each one
 * back to the raw Yahoo payload.
 *
 * The chain under test has three links. The page computes a figure with the
 * same functions the views use. Those read a shard. The shard was derived
 * from a raw Yahoo response. This walks the chain backwards and compares the
 * two ends, so a fault anywhere between them shows up as a mismatch.
 *
 * The sample is random but reproducible: a fixed seed drives the choice, and
 * the seed is printed, so the same twenty come back every run and a different
 * twenty can be drawn by changing it.
 *
 *   npx tsx src/trophy/audit.ts [--seed 12345] [--count 20]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { leagueById } from '../domain/leagues.js'
import { allTimeStandings, headToHead } from '../domain/ownerStats.js'
import { leaderboard, type TeamWeek } from '../domain/records.js'
import {
  BRACKET_BY_CODE, type MatchupShard, type SeasonsShard, type TransactionsShard, type WeeklyShard,
} from '../domain/trophy.js'
import type { DraftsShard } from './drafts.js'
import { cachedGet } from './cache.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHARDS = path.join(ROOT, 'data', 'kp', 'trophy')
const read = <T>(n: string): T => JSON.parse(readFileSync(path.join(SHARDS, n), 'utf8')) as T

const args = process.argv.slice(2)
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) : fallback
}
const SEED = flag('seed', 20260918)
const COUNT = flag('count', 20)

/** Small deterministic generator, so the sample is reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = mulberry32(SEED)
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!

type AnyObj = Record<string, any>
const asObj = (v: unknown): AnyObj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyObj) : {}
function* indexed(o: AnyObj): Generator<any> {
  const count = Number(o['count'] ?? 0)
  for (let i = 0; i < count; i++) yield o[String(i)]
}
const findKey = (arr: any[], key: string): any =>
  arr.find(x => x && typeof x === 'object' && key in x)?.[key]

const seasonsShard = read<SeasonsShard>('seasons.json')
const weekly = read<WeeklyShard>('weekly.json')
const matchups = read<MatchupShard>('matchups.json')
const drafts = read<DraftsShard>('drafts.json')
const transactions = read<TransactionsShard>('transactions.json')
const league = leagueById('kp')

const name = (id: string) => seasonsShard.owners.find(o => o.id === id)?.displayName ?? id
const ownerIndexOf = (id: string) => seasonsShard.owners.findIndex(o => o.id === id)
const keyFor = (season: number) => league.seasons[String(season)]!
const categories = seasonsShard.seasons[0]!.categories
const statOrder = categories.map(c => c.abbr)

const col = (n: string) => weekly.columns.indexOf(n)
const teamWeeks: TeamWeek[] = weekly.rows.map(r => ({
  season: r[col('season')] as number,
  week: r[col('week')] as number,
  ownerIndex: r[col('owner')] as number,
  days: r[col('days')] as number,
  bracket: BRACKET_BY_CODE[r[col('bracket')] as number]!,
  values: Object.fromEntries(statOrder.map(n => [n, r[col(n)] ?? null])),
  ab: r[col('ab')] ?? null,
  ip: r[col('ip')] ?? null,
  completedGames: r[col('completedGames')] ?? null,
}))

/** Raw helpers -------------------------------------------------------- */

async function rawScoreboard(season: number) {
  const s = seasonsShard.seasons.find(x => x.season === season)!
  const weeks = s.weeks.map(w => w.week).join(',')
  const raw = (await cachedGet(`league/${keyFor(season)}/scoreboard;week=${weeks}`)).data
  return asObj(asObj(asObj((raw.fantasy_content as AnyObj)['league'][1])['scoreboard'])['0'])['matchups']
}

/** A team's raw stat value for one category in one week. */
async function rawTeamWeekValue(season: number, week: number, ownerId: string, abbr: string) {
  const category = categories.find(c => c.abbr === abbr)!
  const teamName = seasonsShard.seasons.find(s => s.season === season)!
    .standings.find(r => r.ownerId === ownerId)?.teamName
  for (const entry of indexed(asObj(await rawScoreboard(season)))) {
    const mu = asObj(asObj(entry)['matchup'])
    if (Number(mu['week']) !== week) continue
    for (const te of indexed(asObj(asObj(mu['0'])['teams']))) {
      const arr = asObj(te)['team'] as any[]
      if (String(findKey(arr[0], 'name')) !== teamName) continue
      const stats = asObj(asObj(arr[1])['team_stats'])['stats']
      if (!Array.isArray(stats)) continue
      for (const x of stats) {
        const st = asObj(asObj(x)['stat'])
        if (Number(st['stat_id']) === category.statId) return String(st['value'] ?? '')
      }
    }
  }
  return null
}

/** A team's raw regular-season outcome totals for a season. */
async function rawStandingsRow(season: number, ownerId: string) {
  const raw = (await cachedGet(`league/${keyFor(season)}/standings`)).data
  const arr = asObj((raw.fantasy_content as AnyObj)['league'][1])['standings']
  const teams = asObj(asObj(Array.isArray(arr) ? arr[0] : arr)['teams'])
  const teamName = seasonsShard.seasons.find(s => s.season === season)!
    .standings.find(r => r.ownerId === ownerId)?.teamName
  for (const entry of indexed(teams)) {
    const t = asObj(entry)['team'] as any[]
    if (String(findKey(t[0], 'name')) !== teamName) continue
    const st = asObj(findKey(t, 'team_standings'))
    const o = asObj(st['outcome_totals'])
    return {
      wins: Number(o['wins']), losses: Number(o['losses']), ties: Number(o['ties']),
      rank: Number(st['rank']),
    }
  }
  return null
}

/** Sum a pair's category record out of the raw scoreboards. */
async function rawHeadToHead(a: string, b: string, scope: 'regular' | 'playoffs') {
  let wins = 0, losses = 0, ties = 0, meetings = 0
  for (const season of seasonsShard.seasons) {
    const names = season.standings
    const aName = names.find(r => r.ownerId === a)?.teamName
    const bName = names.find(r => r.ownerId === b)?.teamName
    if (!aName || !bName) continue
    for (const entry of indexed(asObj(await rawScoreboard(season.season)))) {
      const mu = asObj(asObj(entry)['matchup'])
      const isPlayoff = String(mu['is_playoffs'] ?? '0') === '1'
      const isConsolation = String(mu['is_consolation'] ?? '0') === '1'
      if (isConsolation) continue
      if (scope === 'regular' ? isPlayoff : !isPlayoff) continue
      const sides: string[] = []
      for (const te of indexed(asObj(asObj(mu['0'])['teams']))) {
        sides.push(String(findKey(asObj(te)['team'][0], 'name')))
      }
      if (!(sides.includes(aName) && sides.includes(bName))) continue
      meetings++
      // Read the per-category winners exactly as Yahoo recorded them.
      const aKeyMatch = (() => {
        for (const te of indexed(asObj(asObj(mu['0'])['teams']))) {
          const arr = asObj(te)['team'] as any[]
          if (String(findKey(arr[0], 'name')) === aName) return String(findKey(arr[0], 'team_key'))
        }
        return ''
      })()
      for (const sw of (Array.isArray(mu['stat_winners']) ? mu['stat_winners'] : [])) {
        const s = asObj(asObj(sw)['stat_winner'])
        const statId = Number(s['stat_id'])
        const category = categories.find(c => c.statId === statId)
        if (!category) continue
        if (String(s['is_tied'] ?? '0') === '1') ties++
        else if (String(s['winner_team_key'] ?? '') === aKeyMatch) wins++
        else losses++
      }
    }
  }
  return { wins, losses, ties, meetings }
}

/** Sample types ------------------------------------------------------- */

interface Sample {
  what: string
  where: string
  displayed: string
  raw: string
  ok: boolean
}

const finished = seasonsShard.seasons.filter(s => s.isFinished)
const samples: Sample[] = []

async function sampleWeeklyRecord(): Promise<Sample> {
  const category = pick(categories)
  const end = random() < 0.5 ? 'best' : 'worst'
  const board = leaderboard(teamWeeks, category.abbr, 'standard', category.higherIsBetter, end, 5)
  const row = pick(board.rows)
  const ownerId = seasonsShard.owners[row.teamWeek.ownerIndex]!.id
  const raw = await rawTeamWeekValue(row.teamWeek.season, row.teamWeek.week, ownerId, category.abbr)
  const displayed = String(row.value)
  const ok = raw !== null && Number(raw) === row.value
  return {
    what: `Weekly record, ${end} ${category.abbr}`,
    where: `Records wing: ${name(ownerId)}, ${row.teamWeek.season} week ${row.teamWeek.week}`,
    displayed, raw: raw === null ? 'not found' : raw, ok,
  }
}

async function sampleSeasonRecord(): Promise<Sample> {
  const season = pick(finished)
  const row = pick(season.standings)
  const raw = await rawStandingsRow(season.season, row.ownerId)
  const displayed = `${row.wins}-${row.losses}-${row.ties}`
  const rawText = raw ? `${raw.wins}-${raw.losses}-${raw.ties}` : 'not found'
  return {
    what: 'Regular-season record',
    where: `Owner page: ${name(row.ownerId)}, ${season.season}`,
    displayed, raw: rawText, ok: displayed === rawText,
  }
}

async function sampleChampion(): Promise<Sample> {
  const season = pick(finished)
  const raw = await rawStandingsRow(season.season, season.champion!.ownerId)
  return {
    what: 'Champion',
    where: `Hall of Champions: ${season.season}`,
    displayed: `${name(season.champion!.ownerId)} (rank 1)`,
    raw: raw ? `rank ${raw.rank}` : 'not found',
    ok: raw?.rank === 1,
  }
}

async function sampleAllTime(): Promise<Sample> {
  const row = pick(allTimeStandings(seasonsShard))
  let wins = 0, losses = 0, ties = 0
  for (const season of seasonsShard.seasons) {
    if (!season.standings.some(r => r.ownerId === row.ownerId)) continue
    const raw = await rawStandingsRow(season.season, row.ownerId)
    if (!raw) continue
    wins += raw.wins; losses += raw.losses; ties += raw.ties
  }
  const displayed = `${row.wins}-${row.losses}-${row.ties}`
  const rawText = `${wins}-${losses}-${ties}`
  return {
    what: 'All-time record',
    where: `Owners wing: ${name(row.ownerId)}`,
    displayed, raw: rawText, ok: displayed === rawText,
  }
}

async function sampleHeadToHead(): Promise<Sample> {
  const ids = seasonsShard.owners.map(o => o.id)
  const matrix = headToHead(seasonsShard, matchups, 'regular')
  let a = pick(ids), b = pick(ids)
  let cell = a === b ? null : matrix.get(a, b)
  for (let tries = 0; tries < 30 && !cell; tries++) {
    a = pick(ids); b = pick(ids)
    cell = a === b ? null : matrix.get(a, b)
  }
  if (!cell) return { what: 'Head to head', where: 'none available', displayed: '-', raw: '-', ok: true }
  const raw = await rawHeadToHead(a, b, 'regular')
  const displayed = `${cell.wins}-${cell.losses}-${cell.ties} in ${cell.meetings}`
  const rawText = `${raw.wins}-${raw.losses}-${raw.ties} in ${raw.meetings}`
  return {
    what: 'Head-to-head record',
    where: `Rivalries: ${name(a)} against ${name(b)}, regular season`,
    displayed, raw: rawText, ok: displayed === rawText,
  }
}

async function sampleKeeper(): Promise<Sample> {
  const withKeepers = drafts.seasons.filter(d => d.keepers.length > 0)
  const draft = pick(withKeepers)
  const keeper = pick(draft.keepers)
  const season = draft.season

  // Resolve the owner's team key for that season from the raw teams payload.
  const teamsRaw = (await cachedGet(`league/${keyFor(season)}/teams`)).data
  const teamName = seasonsShard.seasons.find(s => s.season === season)!
    .standings.find(r => r.ownerId === keeper.ownerId)?.teamName
  let teamKey = ''
  for (const entry of indexed(asObj(asObj((teamsRaw.fantasy_content as AnyObj)['league'][1])['teams']))) {
    const arr = asObj(entry)['team'][0] as any[]
    if (String(findKey(arr, 'name')) === teamName) teamKey = String(findKey(arr, 'team_key'))
  }

  // The house rule the pipeline uses: a team's last five picks are its
  // keepers. Re-derive that here straight from the raw draft results.
  const raw = (await cachedGet(`league/${keyFor(season)}/draftresults`)).data
  const results = asObj(asObj((raw.fantasy_content as AnyObj)['league'][1])['draft_results'])
  const mine: Array<{ playerKey: string; overall: number }> = []
  for (const entry of indexed(results)) {
    const dr = asObj(asObj(entry)['draft_result'])
    if (String(dr['team_key'] ?? '') !== teamKey) continue
    const playerKey = String(dr['player_key'] ?? '')
    if (playerKey) mine.push({ playerKey, overall: Number(dr['pick']) })
  }
  const lastFive = mine.sort((a, b) => a.overall - b.overall).slice(-5)

  const players = (await cachedGet(
    `league/${keyFor(season)}/players;player_keys=${lastFive.map(p => p.playerKey).join(',')}`,
  )).data
  const names: string[] = []
  for (const entry of indexed(asObj(asObj((players.fantasy_content as AnyObj)['league'][1])['players']))) {
    const arr = asObj(entry)['player'][0] as any[]
    names.push(String(asObj(findKey(arr, 'name'))['full'] ?? ''))
  }

  return {
    what: 'Keeper',
    where: `Hall of Champions: ${name(keeper.ownerId)}, ${season}${teamName ? `, ${teamName}` : ''}`,
    displayed: keeper.playerName,
    raw: names.includes(keeper.playerName)
      ? `one of that team's last five picks: ${names.join(', ')}`
      : `not among that team's last five picks: ${names.join(', ')}`,
    ok: names.includes(keeper.playerName),
  }
}

async function sampleTransactionCount(): Promise<Sample> {
  const season = pick(seasonsShard.seasons).season
  const stored = transactions.rows.filter(r => r[0] === season).length
  // Count the raw pages for the same season.
  let raw = 0
  for (let start = 0; ; start += 25) {
    const page = await cachedGet(
      `league/${keyFor(season)}/transactions;start=${start};count=25`,
      { allowRefusal: true },
    )
    if (page.refused) {
      for (let i = start; i < start + 25; i++) {
        const one = await cachedGet(
          `league/${keyFor(season)}/transactions;start=${i};count=1`,
          { allowRefusal: true },
        )
        if (one.refused) continue
        raw += Number(asObj(asObj((one.data.fantasy_content as AnyObj)['league'][1])['transactions'])['count'] ?? 0)
      }
      continue
    }
    const n = Number(asObj(asObj((page.data.fantasy_content as AnyObj)['league'][1])['transactions'])['count'] ?? 0)
    if (n === 0) break
    raw += n
  }
  return {
    what: 'Transactions in a season',
    where: `Archive: ${season}`,
    displayed: String(stored),
    raw: String(raw),
    ok: stored === raw,
  }
}

const TRACERS = [
  sampleWeeklyRecord, sampleSeasonRecord, sampleChampion,
  sampleAllTime, sampleHeadToHead, sampleKeeper, sampleTransactionCount,
]

for (let i = 0; i < COUNT; i++) {
  const tracer = TRACERS[i % TRACERS.length]!
  const sample = await tracer()
  samples.push(sample)
  console.log(`${sample.ok ? 'OK  ' : 'FAIL'} ${sample.what} — ${sample.where}`)
  if (!sample.ok) console.log(`       displayed ${sample.displayed}, raw ${sample.raw}`)
}

const failures = samples.filter(s => !s.ok)
const out: string[] = []
const p = (s = '') => out.push(s)
p('# Trophy Room — Stage 8 accuracy audit')
p()
p(`Generated by \`npx tsx src/trophy/audit.ts --seed ${SEED}\`.`)
p()
p('Each row takes a figure the page displays, computed by the same functions the views')
p('use, and traces it back to the raw Yahoo payload the shard was built from. The sample')
p('is random but reproducible: the seed above selects it, so the same rows come back every')
p('run and a different draw is one flag away.')
p()
p('| # | Figure | Where it appears | Displayed | Raw Yahoo | Result |')
p('|---|---|---|---|---|---|')
samples.forEach((s, i) => {
  p(`| ${i + 1} | ${s.what} | ${s.where} | ${s.displayed} | ${s.raw} | ${s.ok ? 'match' : 'MISMATCH'} |`)
})
p()
p(failures.length === 0
  ? `All ${samples.length} sampled figures match the raw Yahoo record.`
  : `${failures.length} of ${samples.length} figures did NOT match.`)
p()

mkdirSync(path.join(ROOT, 'docs', 'trophy-room'), { recursive: true })
writeFileSync(path.join(ROOT, 'docs/trophy-room/stage8-audit.md'), out.join('\n'))
console.log(`\n${samples.length - failures.length} of ${samples.length} matched.`)
console.log('Wrote docs/trophy-room/stage8-audit.md')
if (failures.length > 0) process.exit(1)
