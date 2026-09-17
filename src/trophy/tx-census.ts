/**
 * Transaction census: page every season's transaction list, working around
 * the records Yahoo can no longer serve, and report exactly what is lost.
 *
 * Uses a bounded fetch. The repo's client.ts has no request timeout, and a
 * stalled Yahoo connection hung an earlier run indefinitely — Stage 1 should
 * add a timeout there.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAccessToken, refreshAccessToken } from '../yahoo/auth.js'
import { leagueById } from '../domain/leagues.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE = path.join(ROOT, 'data', '.cache', 'yahoo')
const BASE = 'https://fantasysports.yahooapis.com/fantasy/v2'
const TIMEOUT_MS = 20_000
const PACE_MS = 300

type AnyObj = Record<string, any>
const asObj = (v: any): AnyObj => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
function* indexed(o: AnyObj): Generator<any> {
  const c = Number(o['count'] ?? 0); for (let i = 0; i < c; i++) yield o[String(i)]
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const cachePath = (r: string) => path.join(CACHE, r.replace(/[/;=,?&]/g, '_') + '.json')

let last = 0
/** null = Yahoo refuses this resource (4xx that is not auth). */
async function get(resource: string): Promise<AnyObj | null> {
  const file = cachePath(resource)
  if (existsSync(file)) {
    const txt = readFileSync(file, 'utf8')
    return txt === 'null' ? null : (JSON.parse(txt) as AnyObj)
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const since = Date.now() - last
    if (since < PACE_MS) await sleep(PACE_MS - since)
    last = Date.now()
    let resp: Response
    try {
      resp = await fetch(`${BASE}/${resource}?format=json`, {
        headers: { Authorization: `Bearer ${await getAccessToken()}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      if (attempt === 3) throw new Error(`network/timeout on ${resource}`)
      await sleep(1000 * attempt); continue
    }
    if (resp.ok) {
      const json = (await resp.json()) as AnyObj
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(json))
      return json
    }
    if (resp.status === 401 && attempt < 3) { await refreshAccessToken(); continue }
    if ((resp.status === 429 || resp.status >= 500) && attempt < 3) { await sleep(1000 * attempt); continue }
    // Permanent refusal — cache the refusal so reruns skip it.
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, 'null')
    return null
  }
  return null
}

function txMeta(entry: any): AnyObj {
  const t = asObj(entry)['transaction']
  return Array.isArray(t) ? asObj(t[0]) : asObj(t)
}
const txBlock = (json: AnyObj) => asObj(asObj(json['fantasy_content']?.['league']?.[1])['transactions'])

const PAGE = 25
const league = leagueById('kp')
const report: any[] = []

for (const [season, key] of Object.entries(league.seasons)) {
  const types: Record<string, number> = {}
  const deadIndexes: number[] = []
  let n = 0
  for (let start = 0; ; start += PAGE) {
    const page = await get(`league/${key}/transactions;start=${start};count=${PAGE}`)
    if (page === null) {
      // one poisoned record kills the page — recover the rest one at a time
      for (let i = start; i < start + PAGE; i++) {
        const one = await get(`league/${key}/transactions;start=${i};count=1`)
        if (one === null) { deadIndexes.push(i); continue }
        for (const e of indexed(txBlock(one))) {
          const ty = String(txMeta(e)['type'] ?? '?'); types[ty] = (types[ty] ?? 0) + 1; n++
        }
      }
      continue
    }
    const block = txBlock(page)
    if (Number(block['count'] ?? 0) === 0) break
    for (const e of indexed(block)) {
      const ty = String(txMeta(e)['type'] ?? '?'); types[ty] = (types[ty] ?? 0) + 1; n++
    }
  }
  const row = { season, leagueKey: key, retrieved: n, lost: deadIndexes.length, deadIndexes, types }
  report.push(row)
  process.stdout.write(
    `${season} retrieved=${String(n).padStart(4)} lost=${deadIndexes.length} ` +
    `trades=${types['trade'] ?? 0} ${JSON.stringify(types)}\n`,
  )
}

const total = report.reduce((a, r) => a + r.retrieved, 0)
const lost = report.reduce((a, r) => a + r.lost, 0)
const trades = report.reduce((a, r) => a + (r.types['trade'] ?? 0), 0)
process.stdout.write(`\nTOTAL retrieved=${total} lost=${lost} trades=${trades}\n`)
writeFileSync(path.join(ROOT, 'data/.cache/trophy-transactions.json'), JSON.stringify(report, null, 1))
