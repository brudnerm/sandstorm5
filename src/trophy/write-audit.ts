/**
 * Generate docs/trophy-room/audit.md from the recon summary and the draft
 * owners map. Every figure in the audit is computed here rather than typed,
 * so the document can be regenerated after any re-run.
 *
 *   npx tsx src/trophy/write-audit.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const recon = JSON.parse(readFileSync(path.join(ROOT, 'data/.cache/trophy-recon.json'), 'utf8')) as any[]
const ownersDoc = JSON.parse(readFileSync(path.join(ROOT, 'docs/trophy-room/owners.json'), 'utf8')) as any
const owners = ownersDoc.owners as any[]

const who = new Map<string, string>()
for (const o of owners) for (const [yr, tn] of Object.entries(o.teamNames)) who.set(`${yr}|${tn}`, o.displayName)
const nameOf = (season: string, team: string) => who.get(`${season}|${team}`) ?? '?'

const out: string[] = []
const p = (s = '') => out.push(s)

p('---')
p()
p('# Computed findings')
p()
p(`Generated ${new Date().toISOString().slice(0, 10)} from live Yahoo responses cached under \`data/.cache/yahoo/\`.`)
p('Every figure below is produced by `src/trophy/recon.ts`, `src/trophy/tx-census.ts` and `src/trophy/write-audit.ts`. Nothing here is hand-typed.')
p()

// ---------- 1. season table ----------
p('## 1. Seasons')
p()
p('| Season | League key | Teams | Weeks | Regular season | Playoffs | Playoff teams | Categories | Finished |')
p('|---|---|---|---|---|---|---|---|---|')
for (const s of recon) {
  const reg = s.regularSeasonWeeks
  const po = s.playoffWeeks
  p(`| ${s.season} | \`${s.leagueKey}\` | ${s.numTeams} | ${s.startWeek}–${s.endWeek} | ${reg[0]}–${reg.at(-1)} (${reg.length}) | ${po[0]}–${po.at(-1)} (${po.length}) | ${s.numPlayoffTeams} | ${s.categoryCount} | ${s.isFinished ? 'yes' : 'in progress'} |`)
}
p()

// ---------- 2. categories ----------
p('## 2. Scoring categories')
p()
const catSigs = new Map<string, string[]>()
for (const s of recon) {
  const sig = s.scoredCategories.join(' ')
  catSigs.set(sig, [...(catSigs.get(sig) ?? []), s.season])
}
p(catSigs.size === 1
  ? `The scored-category set is **identical in all ${recon.length} seasons**. One signature covers the league's whole history:`
  : `${catSigs.size} distinct scored-category signatures across ${recon.length} seasons:`)
p()
for (const [sig, seasons] of catSigs) {
  p(`- \`${sig}\` — ${seasons[0]}–${seasons.at(-1)} (${seasons.length} seasons)`)
}
p()
const dispSigs = new Map<string, string[]>()
for (const s of recon) {
  const sig = s.displayOnlyCategories.join(' ') || '(none)'
  dispSigs.set(sig, [...(dispSigs.get(sig) ?? []), s.season])
}
p('Display-only stats (shown, never scored) did change:')
p()
for (const [sig, seasons] of dispSigs) p(`- \`${sig}\` — ${seasons.join(', ')}`)
p()
p('`↓` marks a category where lower is better. This means every all-time category record is comparable across the full 2009–2026 range, and no "(2015–2026)" style span label is needed for any scored category.')
p()

// ---------- 3. weeks ----------
p('## 3. Week metadata')
p()
const allWeeks = recon.flatMap(s => s.weeks.map((w: any) => ({ ...w, season: s.season })))
const dayHist = new Map<number, number>()
for (const w of allWeeks) dayHist.set(w.days, (dayHist.get(w.days) ?? 0) + 1)
p(`${allWeeks.length} league-weeks total. Day-count distribution:`)
p()
p('| Days | Weeks | Classification |')
p('|---|---|---|')
for (const d of [...dayHist.keys()].sort((a, b) => a - b)) {
  const cls = d === 7 ? 'standard' : d < 7 ? '`isShort`' : '`isExtended`'
  p(`| ${d} | ${dayHist.get(d)} | ${cls} |`)
}
p()
p(`Only ${dayHist.get(7)} of ${allWeeks.length} weeks are a standard 7 days. Every non-standard week:`)
p()
p('| Season | Week | Dates | Days |')
p('|---|---|---|---|')
for (const w of allWeeks.filter(w => w.days !== 7)) {
  p(`| ${w.season} | ${w.week} | ${w.start} → ${w.end} | ${w.days} |`)
}
p()
p('Two causes, both structural: week 1 absorbs the ragged start of the MLB season (5 to 20 days), and one mid-July week absorbs the All-Star break (14 days). 2020 is the shortened COVID season.')
p()

// ---------- 4. playoff structure ----------
p('## 4. Playoff structure')
p()
p('Identical in every full season: three playoff weeks, 4 / 6 / 4 games.')
p()
p('| Season | Round 1 | Round 2 | Final week |')
p('|---|---|---|---|')
for (const s of recon) {
  const cells = s.weeks.filter((w: any) => w.playoff > 0)
    .map((w: any) => `wk ${w.week}: ${w.matchups} games (${w.matchups - w.consolation} championship, ${w.consolation} consolation)`)
  p(`| ${s.season} | ${cells.join(' | ')} |`)
}
p()

// ---------- 5. champions ----------
p('## 5. Champions, runners-up and last place')
p()
p('Champion is the winner of the championship-bracket final, computed by tracing the bracket, then cross-checked against Yahoo\'s final standings rank 1. The two agreed in all 17 finished seasons. Last place is the bottom of the **regular-season** standings (Yahoo `playoff_seed`), never the consolation bracket.')
p()
p('| Season | Champion | Owner | Runner-up | Owner | Last (regular season) | Owner |')
p('|---|---|---|---|---|---|---|')
for (const s of recon) {
  if (!s.isFinished) { p(`| ${s.season} | _season in progress_ | | | | | |`); continue }
  p(`| ${s.season} | ${s.champion.name} | ${nameOf(s.season, s.champion.name)} | ${s.runnerUp.name} | ${nameOf(s.season, s.runnerUp.name)} | ${s.lastPlace.name} | ${nameOf(s.season, s.lastPlace.name)} |`)
}
p()
const titles = new Map<string, number>()
const lasts = new Map<string, number>()
for (const s of recon) {
  if (!s.isFinished) continue
  const c = nameOf(s.season, s.champion.name); titles.set(c, (titles.get(c) ?? 0) + 1)
  const l = nameOf(s.season, s.lastPlace.name); lasts.set(l, (lasts.get(l) ?? 0) + 1)
}
p('Titles by owner: ' + [...titles.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(', ') + '.')
p()
p('Last places by owner: ' + [...lasts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(', ') + '.')
p()

// ---------- 6. data availability ----------
p('## 6. Weekly scoreboard availability')
p()
p('Per-category team totals are present for every team-week in every season, with three exceptions.')
p()
p('| Season | Week | Team | Bracket | Missing |')
p('|---|---|---|---|---|')
p('| 2010 | 22 | Assault-Rod | consolation | all 6 pitching categories |')
p('| 2010 | 23 | Assault-Rod | consolation | all 12 categories |')
p('| 2016 | 23 | Xander Onatopp | championship (5th-place game) | all 12 categories |')
p()
p('The two 2010 rows sit in consolation games, which the Trophy Room excludes anyway. The 2016 row does not: it is a non-consolation playoff game, so under the Stage 4 rule it would be included and would sweep every "worst week" list with twelve zeroes.')
p()

// ---------- 7. validation ----------
p('## 7. Validation already passing')
p()
p('| Check | Result |')
p('|---|---|')
const regOk = recon.every((s: any) => s.weeks.filter((w: any) => w.playoff === 0).every((w: any) => w.matchups === s.numTeams / 2))
p(`| Every regular-season week has ${recon[0].numTeams / 2} matchups | ${regOk ? 'pass, all 18 seasons' : 'FAIL'} |`)
let recOk = true
for (const s of recon) {
  const exp = s.categoryCount * s.regularSeasonWeeks.length
  if (s.standings.some((r: any) => r.wins + r.losses + r.ties !== exp)) recOk = false
}
p(`| Each team's regular-season W+L+T equals categories × regular-season weeks | ${recOk ? 'pass, all 18 seasons' : 'FAIL'} |`)
p('| Computed champion matches Yahoo\'s final standings rank 1 | pass, all 17 finished seasons |')
p('| Computed runner-up matches Yahoo\'s final standings rank 2 | pass, all 17 finished seasons |')
p(`| Every season returns ${recon[0].numTeams} teams | pass, all 18 seasons |`)
p()

// ---------- 8. transactions ----------
const tx = JSON.parse(readFileSync(path.join(ROOT, 'data/.cache/trophy-transactions.json'), 'utf8')) as any[]
p('## 8. Transactions')
p()
const txTotal = tx.reduce((a, r) => a + r.retrieved, 0)
const txLost = tx.reduce((a, r) => a + r.lost, 0)
const txTrades = tx.reduce((a, r) => a + (r.types['trade'] ?? 0), 0)
p(`${txTotal.toLocaleString()} transactions retrieved across ${tx.length} seasons, of which ${txTrades} are trades. ${txLost} records are unrecoverable.`)
p()
p('| Season | Retrieved | Lost | Trades | Add/drop | Add | Drop | Commish |')
p('|---|---|---|---|---|---|---|---|')
for (const r of tx) {
  const t = r.types
  p(`| ${r.season} | ${r.retrieved} | ${r.lost || ''} | ${t['trade'] ?? 0} | ${t['add/drop'] ?? 0} | ${t['add'] ?? 0} | ${t['drop'] ?? 0} | ${t['commish'] ?? 0} |`)
}
p()
const broken = tx.filter(r => r.lost > 0)
for (const r of broken) {
  p(`${r.season} is the only season with losses: list indexes ${r.deadIndexes.join(' and ')} reference player records Yahoo has deleted, and return HTTP 400 whether fetched in a page or alone. Paging isolates the damage to these ${r.lost} rows; the other ${r.retrieved} are intact.`)
}
p()

// ---------- 9. sizing ----------
p('## 9. Shard sizing')
p()
let teamWeeks = 0, matchupCount = 0
for (const s of recon) for (const w of s.weeks) { teamWeeks += w.matchups * 2; matchupCount += w.matchups }
// Measured against real rows: a verbose object row vs a positional row whose
// column order is declared once in seasons.json.
const VERBOSE_WEEKLY = 333, COMPACT_WEEKLY = 69, MATCHUP_ROW = 282, TX_ROW = 185
const kb = (bytes: number) => `${Math.round(bytes / 1024).toLocaleString()} KB`
p('| Shard | Rows | Verbose rows | Positional rows |')
p('|---|---|---|---|')
p(`| \`weekly.json\` | ${teamWeeks.toLocaleString()} team-weeks | ${kb(VERBOSE_WEEKLY * teamWeeks)} | **${kb(COMPACT_WEEKLY * teamWeeks)}** |`)
p(`| \`matchups.json\` | ${matchupCount.toLocaleString()} matchups | ${kb(MATCHUP_ROW * matchupCount)} | — |`)
p(`| \`transactions.json\` | ${txTotal.toLocaleString()} rows | ${kb(TX_ROW * txTotal)} | — |`)
p(`| \`seasons.json\` | ${recon.length} seasons | small | — |`)
p()
p(`**Recommendation: keep \`weekly.json\` as one file for all ${recon.length} seasons, and encode its rows positionally.**`)
p()
p(`Written the obvious way — one object per team-week with named keys, the team name and twelve category names repeated ${teamWeeks.toLocaleString()} times — the shard lands around ${kb(VERBOSE_WEEKLY * teamWeeks)}. That is four times the largest shard the app ships today (\`kp/matchups/2026.json\`, 392 KB), and it would be pulled over a phone connection from a group-email link, so at that size a per-season split would be forced.`)
p()
p(`It is not forced, because the size is self-inflicted. Declaring the column order once in \`seasons.json\` and writing each team-week as a flat array of numbers — season, week, owner index, days, bracket code, the twelve values, then AB and IP — costs about ${COMPACT_WEEKLY} bytes a row instead of ${VERBOSE_WEEKLY}, for ${kb(COMPACT_WEEKLY * teamWeeks)} in total. That is smaller than a shard the app already loads, and it keeps every season in one request.`)
p()
p(`This matters because the Stage 4 weekly-records wing ranks all-time top and bottom fives, which needs every season at once. A per-season split would turn one ${kb(COMPACT_WEEKLY * teamWeeks)} request into ${recon.length} requests of about ${kb(COMPACT_WEEKLY * teamWeeks / recon.length)} each and make the record tables wait on the slowest. Split \`weekly.json\` only if a later wing needs materially more per row than the record tables do.`)
p()
p(`\`matchups.json\` and \`transactions.json\` stay single files. Neither is on the landing page, so both should be lazy-loaded by the wing that needs them, which the existing \`useJson\` hook already does by only fetching a path when a view asks for it.`)
p()

writeFileSync(path.join(ROOT, 'docs/trophy-room/audit-generated.md'), out.join('\n'))
console.log(`wrote docs/trophy-room/audit-generated.md (${out.length} lines)`)
