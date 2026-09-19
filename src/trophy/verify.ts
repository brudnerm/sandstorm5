/**
 * Validate the shards as they are actually published.
 *
 * `backfill.ts` validates the objects it is holding in memory just before it
 * writes them, which is the right place to catch a bad build. It is not the
 * same thing as checking what is on disk: a run with `--skip-transactions`
 * validates an empty transaction shard and reports a pass, while the real
 * transaction file sits beside it unexamined. A partial run, an interrupted
 * write or a hand-edit would all pass there and fail here.
 *
 * This reads the seven files the site fetches and runs the same checks over
 * them, so the thing being validated is the thing being served.
 *
 *   npx tsx src/trophy/verify.ts
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { validate } from './validate'
import { validateCurated, type CuratedShard } from '../domain/curated'
import type {
  MatchupShard, SeasonsShard, TransactionsShard, TrophyCategory, WeeklyShard,
} from '../domain/trophy'
import type { DraftsShard } from './drafts'
import type { CopyShard } from './copy'

const dir = path.join('data', 'kp', 'trophy')
const read = <T>(name: string): T => {
  const file = path.join(dir, name)
  if (!existsSync(file)) throw new Error(`missing shard: ${file}`)
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

const seasonsShard = read<SeasonsShard>('seasons.json')
const weeklyShard = read<WeeklyShard>('weekly.json')
const matchupShard = read<MatchupShard>('matchups.json')
const transactionsShard = read<TransactionsShard>('transactions.json')
const draftsShard = read<DraftsShard>('drafts.json')
const curated = read<CuratedShard>('curated.json')
const copy = read<CopyShard>('copy.json')

/**
 * Rebuild the global category order the same way the backfill does: first
 * appearance wins, keyed by role and stat id rather than by abbreviation,
 * because abbreviations are reused across roles.
 */
const globalCategories: TrophyCategory[] = []
const seen = new Set<string>()
for (const season of seasonsShard.seasons) {
  for (const c of season.categories) {
    const key = `${c.role}:${c.statId}`
    if (seen.has(key)) continue
    seen.add(key)
    globalCategories.push(c)
  }
}

const report = validate({
  seasonsShard, weeklyShard, matchupShard, transactionsShard, draftsShard, globalCategories,
})

/**
 * A check that examined nothing is not a check that passed.
 *
 * This is the failure that prompted the script: a backfill run that skips
 * transactions hands the validator an empty shard, every row in it is
 * trivially well formed, and it reports a pass. Counting the rows examined
 * and refusing to call zero a pass is the only thing that catches it.
 */
let vacuous = 0
for (const check of report.checks) {
  const empty = check.failures.length === 0 && check.passed === 0
  if (empty) vacuous++
  const status = check.failures.length > 0 ? 'FAIL' : empty ? 'EMPTY' : 'PASS'
  console.log(`${status.padEnd(5)} ${check.name} (${check.passed} examined, ${check.failures.length} failed)`)
  for (const f of check.failures.slice(0, 5)) console.log(`        ${f}`)
  if (check.failures.length > 5) console.log(`        …and ${check.failures.length - 5} more`)
  if (empty) console.log('        examined nothing, so this is not evidence of anything')
}

// --- the curated content is checked against the record it cites
const problems = validateCurated(curated, seasonsShard, weeklyShard)
const fatal = problems.filter(p => p.fatal)
console.log(
  `${fatal.length === 0 ? 'PASS' : 'FAIL'}  curated entries agree with the stored record ` +
  `(${problems.length - fatal.length} warning(s), ${fatal.length} fatal)`,
)
for (const p of problems) console.log(`        ${p.fatal ? 'fatal' : 'warn'}: ${p.entry} — ${p.problem}`)

// --- what is actually publishable today
const entries = [...curated.vetoes, ...curated.keepers, ...curated.plaques]
const approvedCurated = entries.filter(e => e.status === 'approved').length
const approvedCopy = Object.values(copy.entries).filter(e => e.status === 'approved').length
console.log(
  `\nCurated: ${entries.length} entries, ${approvedCurated} approved. ` +
  `Copy: ${Object.keys(copy.entries).length} blurbs, ${approvedCopy} approved.`,
)

const sizes = ['seasons', 'weekly', 'matchups', 'transactions', 'drafts', 'curated', 'copy']
  .map(n => `${n} ${(statSync(path.join(dir, `${n}.json`)).size / 1024).toFixed(0)} KB`)
console.log(`Shards on disk: ${sizes.join(', ')}.`)

const failed = report.checks.filter(c => c.failures.length > 0).length + (fatal.length > 0 ? 1 : 0) + vacuous
const examined = report.checks.reduce((n, c) => n + c.passed, 0)
console.log(
  failed === 0
    ? `\nEvery published shard passes: ${examined.toLocaleString()} rows examined across ${report.checks.length} checks.`
    : `\n${failed} check(s) failed or examined nothing.`,
)
process.exit(failed > 0 ? 1 : 0)
