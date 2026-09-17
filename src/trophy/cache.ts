/**
 * Disk cache for raw Yahoo responses, so the historical backfill can be
 * rerun without re-hitting the API. Keyed by the Yahoo resource path.
 *
 * Lives under data/.cache/yahoo/ — data/ is gitignored, so nothing raw is
 * ever committed, and the cache survives across runs on one machine.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { yahooGet, type YahooResponse } from '../yahoo/client.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const CACHE_DIR = path.join(ROOT, 'data', '.cache', 'yahoo')

function cachePath(resource: string): string {
  return path.join(CACHE_DIR, resource.replace(/[/;=,?&]/g, '_') + '.json')
}

export interface FetchOptions {
  /** Ignore any cached copy and re-fetch. */
  force?: boolean
}

/**
 * GET a Yahoo resource, returning the cached copy when one exists.
 * Every request in the trophy pipeline goes through here.
 */
export async function cachedGet(
  resource: string,
  opts: FetchOptions = {},
): Promise<{ data: YahooResponse; fromCache: boolean }> {
  const file = cachePath(resource)
  if (!opts.force && existsSync(file)) {
    return { data: JSON.parse(readFileSync(file, 'utf8')) as YahooResponse, fromCache: true }
  }
  const data = await yahooGet(resource)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data))
  return { data, fromCache: false }
}
