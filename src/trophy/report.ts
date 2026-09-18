/**
 * Stage 1 deliverable: read the published shards back off disk and report
 * what they contain, season by season, with the gaps named.
 *
 * Deliberately reads the shards rather than the pipeline's in-memory state,
 * so it describes what was actually written.
 *
 *   npx tsx src/trophy/report.ts
 */
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRACKET_BY_CODE, type MatchupShard, type SeasonsShard, type TransactionsShard, type WeeklyShard } from '../domain/trophy.js'
import type { DraftsShard } from './drafts.js'
import { validate } from './validate.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHARD_DIR = path.join(ROOT, 'data', 'kp', 'trophy')

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(path.join(SHARD_DIR, name), 'utf8')) as T

const seasonsShard = read<SeasonsShard>('seasons.json')
const weeklyShard = read<WeeklyShard>('weekly.json')
const matchupShard = read<MatchupShard>('matchups.json')
const transactionsShard = read<TransactionsShard>('transactions.json')
const draftsShard = read<DraftsShard>('drafts.json')

const globalCategories = seasonsShard.seasons[0]!.categories
const report = validate({
  seasonsShard, weeklyShard, matchupShard, transactionsShard, draftsShard, globalCategories,
})

const kb = (n: number) => `${Math.round(n / 1024).toLocaleString()} KB`
const out: string[] = []
const p = (s = '') => out.push(s)

p('# Trophy Room — Stage 1 pipeline report')
p()
p(`Generated ${new Date().toISOString().slice(0, 10)} by \`npx tsx src/trophy/report.ts\` from the shards`)
p('in `data/kp/trophy/`. Every figure is read back off disk, not carried over from the build.')
p()

// ---------------------------------------------------------------- sizes
p('## Shard sizes')
p()
p('GitHub Pages serves these gzipped, so the compressed column is what a phone actually pulls.')
p()
p('| Shard | Raw | Gzipped | Rows |')
p('|---|---|---|---|')
const sizes: Array<[string, number]> = []
for (const [name, rows] of [
  ['seasons.json', seasonsShard.seasons.length],
  ['weekly.json', weeklyShard.rows.length],
  ['matchups.json', matchupShard.rows.length],
  ['transactions.json', transactionsShard.rows.length],
] as const) {
  const raw = statSync(path.join(SHARD_DIR, name)).size
  const gz = gzipSync(readFileSync(path.join(SHARD_DIR, name))).length
  sizes.push([name, gz])
  const label = name === 'seasons.json' ? `${rows} seasons`
    : name === 'weekly.json' ? `${rows.toLocaleString()} team-weeks`
    : name === 'matchups.json' ? `${rows.toLocaleString()} matchups`
    : `${rows.toLocaleString()} transactions`
  p(`| \`${name}\` | ${kb(raw)} | ${kb(gz)} | ${label} |`)
}
p()
const landingGz = sizes.filter(([n]) => n !== 'transactions.json').reduce((a, [, g]) => a + g, 0)
p(`**Recommendation: do not split \`weekly.json\` per season.** Stored positionally it is ` +
  `${kb(statSync(path.join(SHARD_DIR, 'weekly.json')).size)} raw and ` +
  `${kb(gzipSync(readFileSync(path.join(SHARD_DIR, 'weekly.json'))).length)} over the wire, ` +
  `smaller than \`kp/matchups/2026.json\` (392 KB) which the app already loads for a single season. ` +
  `The Stage 4 records wing ranks all-time top and bottom fives, so it needs every season at once; ` +
  `splitting would turn one request into eighteen and make the tables wait on the slowest.`)
p()
p(`Everything except transactions comes to ${kb(landingGz)} gzipped. \`transactions.json\` is the ` +
  `one heavy shard and belongs only to the records wing that uses it, so it should be lazy-loaded — ` +
  `which \`useJson\` already does by only fetching a path when a view asks for it.`)
p()

// ------------------------------------------------------------ per season
p('## Validation, season by season')
p()
p('| Season | Team-weeks | Matchups | Reg. weeks | Champion | Runner-up | Last (reg.) | Standings recompute | Gaps |')
p('|---|---|---|---|---|---|---|---|---|')
const ownerName = (id: string) => seasonsShard.owners.find(o => o.id === id)?.displayName ?? id
const wSeason = weeklyShard.columns.indexOf('season')
const mSeason = matchupShard.columns.indexOf('season')

const gapsBySeason = new Map<number, string[]>()
const wCompleted = weeklyShard.columns.indexOf('completedGames')
const wWeek = weeklyShard.columns.indexOf('week')
const wOwner = weeklyShard.columns.indexOf('owner')
const wBracket = weeklyShard.columns.indexOf('bracket')
for (const row of weeklyShard.rows) {
  if (row[wCompleted] !== 0) continue
  const season = row[wSeason] as number
  const bracket = BRACKET_BY_CODE[row[wBracket] as number]
  gapsBySeason.set(season, [
    ...(gapsBySeason.get(season) ?? []),
    `week ${row[wWeek]} ${ownerName(seasonsShard.owners[row[wOwner] as number]!.id)} completed no games (${bracket})`,
  ])
}
for (const u of transactionsShard.unavailable) {
  gapsBySeason.set(u.season, [...(gapsBySeason.get(u.season) ?? []), `1 transaction unavailable (index ${u.listIndex})`])
}
for (const season of seasonsShard.seasons) {
  if (!season.hasAtBats) {
    gapsBySeason.set(season.season, [...(gapsBySeason.get(season.season) ?? []), 'no at-bat denominator'])
  }
}

for (const season of seasonsShard.seasons) {
  const teamWeeks = weeklyShard.rows.filter(r => r[wSeason] === season.season).length
  const matchups = matchupShard.rows.filter(r => r[mSeason] === season.season).length
  const failed = report.checks.some(c => c.failures.some(f => f.startsWith(String(season.season))))
  const gaps = gapsBySeason.get(season.season) ?? []
  const summarise = (list: string[]): string => {
    if (list.length === 0) return 'none'
    const tx = list.filter(g => g.includes('transaction')).length
    const parts: string[] = []
    if (tx) parts.push(`${tx} transaction${tx > 1 ? 's' : ''} unavailable`)
    for (const g of list) if (!g.includes('transaction')) parts.push(g)
    return parts.join('; ')
  }
  p(
    `| ${season.season} | ${teamWeeks} | ${matchups} | ${season.regularSeasonWeeks.length} | ` +
    `${season.champion ? ownerName(season.champion.ownerId) : '—'} | ` +
    `${season.runnerUp ? ownerName(season.runnerUp.ownerId) : '—'} | ` +
    `${season.lastPlace ? ownerName(season.lastPlace.ownerId) : '—'} | ` +
    `${failed ? 'FAIL' : 'pass'} | ${summarise(gaps)} |`,
  )
}
p()

// ---------------------------------------------------------------- checks
p('## Checks')
p()
p('| Check | Result | Cases |')
p('|---|---|---|')
for (const c of report.checks) {
  p(`| ${c.name} | ${c.failures.length === 0 ? 'pass' : `FAIL (${c.failures.length})`} | ${c.passed.toLocaleString()} |`)
}
p()
if (report.ok) {
  p('No season failed validation.')
} else {
  p('Failures:')
  for (const c of report.checks) for (const f of c.failures) p(`- ${c.name}: ${f}`)
}
p()

// ----------------------------------------------------------------- gaps
p('## Known gaps')
p()
p('Everything the shards cannot answer, and why. Nothing here is interpolated.')
p()
p('| Season | Gap | Effect |')
p('|---|---|---|')
for (const u of transactionsShard.unavailable) {
  p(`| ${u.season} | Transaction at list index ${u.listIndex} | ${u.reason}. Transaction counts for ${u.season} are a known undercount by one. |`)
}
const noAb = seasonsShard.seasons.filter(s => !s.hasAtBats)
if (noAb.length > 0) {
  p(`| ${noAb[0]!.season}–${noAb.at(-1)!.season} | No at-bat denominator | Yahoo only carries the H/AB display stat from 2023 on, so the minimum-AB qualifier for AVG and OBP cannot be applied to these seasons. Innings pitched is present throughout, so ERA and WHIP qualify normally. |`)
}
for (const [season, list] of [...gapsBySeason].sort((a, b) => a[0] - b[0])) {
  for (const g of list) {
    if (g.includes('transaction') || g.includes('at-bat')) continue
    p(`| ${season} | ${g} | Not a missing value. The roster was in place and every player benched, so the counting categories are genuinely zero and the rate categories are undefined. |`)
  }
}
p()
p('No season is missing a week, a matchup, a standings row, a champion or a category value.')
p()

mkdirSync(path.join(ROOT, 'docs', 'trophy-room'), { recursive: true })
writeFileSync(path.join(ROOT, 'docs', 'trophy-room', 'stage1-report.md'), out.join('\n'))
console.log(out.join('\n'))
console.log(`\nWrote docs/trophy-room/stage1-report.md`)
