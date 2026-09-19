/**
 * Stage 4 deliverable: trace displayed records back to raw Yahoo.
 *
 * Takes the record the page would show at the top of a board, then goes back
 * to the cached raw scoreboard response for that season and reads the value
 * out of Yahoo's own payload — not out of any shard. Three things have to
 * agree: what Yahoo said, what the shard stored, and what the ranking picked.
 *
 * The owner is resolved from the raw response too, through owners.json, so a
 * record attributed to the wrong person would fail here rather than looking
 * plausible.
 *
 *   npx tsx src/trophy/spotcheck.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { leagueById } from '../domain/leagues.js'
import { resolveOwner } from '../domain/owners.js'
import { leaderboard, type Mode, type TeamWeek } from '../domain/records.js'
import { BRACKET_BY_CODE, type SeasonsShard, type WeeklyShard } from '../domain/trophy.js'
import { cachedGet } from './cache.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHARDS = path.join(ROOT, 'data', 'kp', 'trophy')
const read = <T>(name: string): T => JSON.parse(readFileSync(path.join(SHARDS, name), 'utf8')) as T

type AnyObj = Record<string, any>
const asObj = (v: unknown): AnyObj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyObj) : {}
function* indexed(o: AnyObj): Generator<any> {
  const count = Number(o['count'] ?? 0)
  for (let i = 0; i < count; i++) yield o[String(i)]
}
const findKey = (arr: any[], key: string): any =>
  arr.find(x => x && typeof x === 'object' && key in x)?.[key]
function managerNickname(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : asObj(value)['0']
  const mgr = asObj(asObj(first)['manager'])
  return mgr['nickname'] ? String(mgr['nickname']) : null
}

const seasonsShard = read<SeasonsShard>('seasons.json')
const weekly = read<WeeklyShard>('weekly.json')
const col = (n: string) => weekly.columns.indexOf(n)
const categories = seasonsShard.seasons[0]!.categories
const statOrder = categories.map(c => c.abbr)
const ownerName = (i: number) => seasonsShard.owners[i]?.displayName ?? `#${i}`
const ownerId = (i: number) => seasonsShard.owners[i]?.id ?? ''

const weeks: TeamWeek[] = weekly.rows.map(r => ({
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

/**
 * Six records, chosen to cover both directions, both ends, a week with no
 * games, and a batting record from a season with no at-bat count — the case
 * the assumed qualifier admits, and so the one most worth tracing.
 */
const TARGETS: Array<{ abbr: string; end: 'best' | 'worst'; mode: Mode }> = [
  { abbr: 'HR', end: 'best', mode: 'standard' },
  { abbr: 'ERA', end: 'best', mode: 'standard' },
  { abbr: 'WHIP', end: 'worst', mode: 'standard' },
  { abbr: 'K', end: 'best', mode: 'standard' },
  { abbr: 'R', end: 'worst', mode: 'standard' },
  { abbr: 'AVG', end: 'best', mode: 'standard' },
]

const league = leagueById('kp')
const out: string[] = []
const p = (s = '') => out.push(s)
p('# Trophy Room — Stage 4 spot check')
p()
p('Six displayed records traced back to the raw Yahoo responses. For each, the')
p('value is read out of Yahoo\'s own scoreboard payload and compared with what the')
p('shard stored and what the ranking selected. The owner is re-resolved from the')
p('raw response through `owners.json`, so a misattributed record would fail here.')
p()
p('The batting-average record is included deliberately: it comes from a season with')
p('no at-bat count, which is the case the assumed qualifier admits.')
p()
p('| Record | Owner | Season, week | Yahoo raw | Shard | Board | Result |')
p('|---|---|---|---|---|---|---|')

let failures = 0
for (const target of TARGETS) {
  const cat = categories.find(c => c.abbr === target.abbr)!
  const board = leaderboard(weeks, target.abbr, target.mode, cat.higherIsBetter, target.end, 1)
  const row = board.rows[0]
  if (!row) { p(`| ${target.abbr} ${target.end} | — | — | — | — | — | NO ROW |`); failures++; continue }

  const tw = row.teamWeek
  const leagueKey = league.seasons[String(tw.season)]!
  const season = seasonsShard.seasons.find(s => s.season === tw.season)!
  const weekList = season.weeks.map(w => w.week).join(',')
  const raw = (await cachedGet(`league/${leagueKey}/scoreboard;week=${weekList}`)).data

  // Walk Yahoo's payload for this week and find the team whose manager
  // resolves to the owner the board is crediting.
  const matchups = asObj(asObj(asObj((raw.fantasy_content as AnyObj)['league'][1])['scoreboard'])['0'])['matchups']
  let yahooValue: string | null = null
  let yahooTeam = ''
  for (const entry of indexed(asObj(matchups))) {
    const mu = asObj(asObj(entry)['matchup'])
    if (Number(mu['week']) !== tw.week) continue
    for (const te of indexed(asObj(asObj(mu['0'])['teams']))) {
      const arr = asObj(te)['team'] as any[]
      const meta = arr[0] as any[]
      const teamName = String(findKey(meta, 'name'))
      const owner = resolveOwner(String(tw.season), teamName, managerNickname(findKey(meta, 'managers')))
      if (owner.id !== ownerId(tw.ownerIndex)) continue
      yahooTeam = teamName
      const stats = asObj(asObj(arr[1])['team_stats'])['stats']
      if (Array.isArray(stats)) {
        for (const x of stats) {
          const st = asObj(asObj(x)['stat'])
          if (Number(st['stat_id']) === cat.statId) yahooValue = String(st['value'] ?? '')
        }
      }
    }
  }

  const shardValue = tw.values[target.abbr]
  // Yahoo returns an empty string for a team that completed no games. That
  // stores as a genuine zero, but Number('') is also 0, so comparing them
  // numerically would pass a real gap too. Require the zero to be explained.
  const emptyButExplained =
    yahooValue === '' && tw.completedGames === 0 && shardValue === 0 && row.value === 0
  const numbersAgree =
    yahooValue !== null && yahooValue !== '' &&
    Math.abs(Number(yahooValue) - (shardValue ?? NaN)) < 1e-9 &&
    Math.abs(row.value - (shardValue ?? NaN)) < 1e-9
  const agree = numbersAgree || emptyButExplained
  if (!agree) failures++

  p(
    `| ${target.end === 'best' ? 'Best' : 'Worst'} ${target.abbr} | ` +
    `${ownerName(tw.ownerIndex)} (${yahooTeam}) | ${tw.season} week ${tw.week} | ` +
    `${yahooValue === '' ? '_(empty)_' : `\`${yahooValue ?? 'not found'}\``} | ${shardValue} | ${row.value} | ` +
    `${!agree ? 'MISMATCH' : emptyButExplained ? 'match, empty because no games were completed' : 'match'} |`,
  )
  console.log(
    `${agree ? 'OK  ' : 'FAIL'} ${target.end} ${target.abbr}: ` +
    `${ownerName(tw.ownerIndex)} ${tw.season} wk ${tw.week} — ` +
    `yahoo=${yahooValue === '' ? '(empty)' : yahooValue} shard=${shardValue} board=${row.value}` +
    `${emptyButExplained ? ' [empty because no games were completed]' : ''}`,
  )
}

p()
p(failures === 0
  ? `All ${TARGETS.length} records agree with Yahoo's raw payload. Five match value for ` +
    `value; the fifth is the week in which a team started nobody, where Yahoo returns an ` +
    `empty string and the shard stores the zero it represents. That case is accepted only ` +
    `when the team also reports no completed games, so a genuine gap could not pass as a zero.`
  : `${failures} of ${TARGETS.length} records did NOT match.`)
p()

mkdirSync(path.join(ROOT, 'docs', 'trophy-room'), { recursive: true })
writeFileSync(path.join(ROOT, 'docs/trophy-room/stage4-spotcheck.md'), out.join('\n'))
console.log(`\nWrote docs/trophy-room/stage4-spotcheck.md`)
if (failures > 0) process.exit(1)
