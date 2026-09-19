/**
 * Disk cache for raw Yahoo responses, so the historical backfill can be
 * rerun without re-hitting the API. Keyed by the Yahoo resource path.
 *
 * Lives under data/.cache/yahoo/ — data/ is gitignored, so nothing raw is
 * ever committed, and the cache survives across runs on one machine. This
 * is what makes the backfill idempotent: a second run reads eighteen
 * seasons off disk and issues no requests at all.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { yahooGet, type YahooResponse } from '../yahoo/client.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const CACHE_DIR = path.join(ROOT, 'data', '.cache', 'yahoo')

/** Marker written when Yahoo permanently refuses a resource. */
const REFUSED = '"__yahoo_refused__"'

/**
 * Filenames stay readable for ordinary resources, but a batched player
 * lookup carries 25 keys and blows past the 255-byte limit macOS enforces,
 * so anything long keeps a readable prefix and ends in a digest of the full
 * resource. Short paths are unaffected, so the existing cache stays valid.
 */
const MAX_STEM = 120

function cachePath(resource: string): string {
  const stem = resource.replace(/[/;=,?&]/g, '_')
  if (stem.length <= MAX_STEM) return path.join(CACHE_DIR, `${stem}.json`)
  const digest = createHash('sha1').update(resource).digest('hex').slice(0, 16)
  return path.join(CACHE_DIR, `${stem.slice(0, MAX_STEM - 17)}-${digest}.json`)
}

export interface FetchOptions {
  /** Ignore any cached copy and re-fetch. */
  force?: boolean
  /**
   * Treat a non-auth 4xx as an answer rather than an error. Some historical
   * transactions reference player records Yahoo has deleted and return HTTP
   * 400 however they are requested; the backfill needs to record those as
   * unavailable and carry on, not abort eighteen seasons of work.
   */
  allowRefusal?: boolean
}

export interface CachedResult {
  data: YahooResponse
  fromCache: boolean
  /** True when Yahoo will not serve this resource. `data` is then empty. */
  refused: boolean
}

const EMPTY: YahooResponse = { fantasy_content: {} }

/**
 * GET a Yahoo resource, returning the cached copy when one exists.
 * Every request in the trophy pipeline goes through here.
 */
export async function cachedGet(
  resource: string,
  opts: FetchOptions = {},
): Promise<CachedResult> {
  const file = cachePath(resource)
  if (!opts.force && existsSync(file)) {
    const text = readFileSync(file, 'utf8')
    // 'null' is the marker an earlier census run wrote for the same thing.
    if (text === REFUSED || text === 'null') {
      if (!opts.allowRefusal) throw new Error(`Yahoo permanently refuses ${resource}`)
      return { data: EMPTY, fromCache: true, refused: true }
    }
    return { data: JSON.parse(text) as YahooResponse, fromCache: true, refused: false }
  }

  try {
    const data = await yahooGet(resource)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(data))
    return { data, fromCache: false, refused: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isRefusal = /HTTP 4\d\d/.test(message) && !/HTTP 401|HTTP 429/.test(message)
    if (opts.allowRefusal && isRefusal) {
      // Cache the refusal so reruns cost nothing and stay deterministic.
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, REFUSED)
      return { data: EMPTY, fromCache: false, refused: true }
    }
    throw err
  }
}
