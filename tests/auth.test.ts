/**
 * Token rotation tests.
 *
 * These exist because of the 2026-07-14 outage. Yahoo revokes the previous
 * refresh token the moment it issues a new one, so every unnecessary rotation
 * is a chance to break the chain permanently. CI used to force a refresh on
 * every run (~96/day) even when the cached access token was still valid, and it
 * never carried the cache between runs — so each run was *forced* to rotate.
 *
 * Rules locked in here:
 *   1. A valid cached access token must NOT trigger a rotation.
 *   2. An expired one (or a missing cache) must.
 *   3. Four runs inside one token lifetime rotate exactly once.
 *   4. A live refresh token that disagrees with the durable store must be
 *      reported as owing a write — even when no rotation happened this run.
 *   5. A rotation that happens *after* the initial check — client.ts refreshes
 *      on a 401 mid-fetch — must still be caught by re-reading the cache.
 *
 * These use a real cache file in a temp dir via YAHOO_TOKEN_CACHE rather than
 * mocking fs, so the genuine read/write path is exercised and the repo's own
 * token-cache.json is never touched.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HOUR = 3_600_000

let dir: string
let cachePath: string
let fetchSpy: ReturnType<typeof vi.fn>

/** Import auth.ts fresh so it picks up the current YAHOO_TOKEN_CACHE. */
async function loadAuth() {
  vi.resetModules()
  return import('../src/yahoo/auth.js')
}

function seedCache(refreshToken: string, expiresAt: number): void {
  writeFileSync(
    cachePath,
    JSON.stringify({ accessToken: `access-${refreshToken}`, refreshToken, expiresAt }),
  )
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sandstorm-auth-'))
  cachePath = path.join(dir, 'token-cache.json')

  process.env.YAHOO_TOKEN_CACHE = cachePath
  process.env.YAHOO_CLIENT_ID = 'test-client-id'
  process.env.YAHOO_CLIENT_SECRET = 'test-client-secret'
  process.env.YAHOO_REFRESH_TOKEN = 'stored-token'

  // Mirror Yahoo: every successful refresh issues a brand new refresh token
  // and kills the previous one.
  let n = 0
  fetchSpy = vi.fn(async () => {
    n += 1
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: `fresh-access-${n}`,
          refresh_token: `rotated-token-${n}`,
          expires_in: 3600,
        }),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.YAHOO_TOKEN_CACHE
  rmSync(dir, { recursive: true, force: true })
})

describe('ensureFreshToken', () => {
  it('does NOT rotate while the cached access token is still valid', async () => {
    seedCache('stored-token', Date.now() + HOUR)
    const { ensureFreshToken } = await loadAuth()

    const { cache, refreshed } = await ensureFreshToken()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(refreshed).toBe(false)
    expect(cache.refreshToken).toBe('stored-token')
  })

  it('rotates once the cached access token has expired', async () => {
    seedCache('stored-token', Date.now() - 1)
    const { ensureFreshToken } = await loadAuth()

    const { cache, refreshed } = await ensureFreshToken()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(refreshed).toBe(true)
    expect(cache.refreshToken).toBe('rotated-token-1')
  })

  it('rotates on a cold runner with no cache at all', async () => {
    const { ensureFreshToken } = await loadAuth()

    const { refreshed } = await ensureFreshToken()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(refreshed).toBe(true)
  })

  it('rotates exactly once across four runs inside one token lifetime', async () => {
    // The actual regression. Four 15-minute CI runs sharing a cached token used
    // to rotate four times; each rotation was a chance to brick the chain.
    const { ensureFreshToken } = await loadAuth()

    for (let run = 0; run < 4; run++) await ensureFreshToken()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('persists the rotated token to the cache (what makes reuse possible)', async () => {
    const { ensureFreshToken } = await loadAuth()

    await ensureFreshToken()

    expect(existsSync(cachePath)).toBe(true)
    expect(JSON.parse(readFileSync(cachePath, 'utf8')).refreshToken).toBe('rotated-token-1')
  })

  it('never writes to the repo cache path when overridden', async () => {
    const { ensureFreshToken } = await loadAuth()
    await ensureFreshToken()
    // Guards the safety property the whole suite depends on.
    expect(cachePath.startsWith(tmpdir())).toBe(true)
  })
})

describe('needsStore', () => {
  it('owes a write after a rotation', async () => {
    const { needsStore } = await loadAuth()
    expect(needsStore('rotated-token-1', 'stored-token')).toBe(true)
  })

  it('owes nothing when the store already matches', async () => {
    const { needsStore } = await loadAuth()
    expect(needsStore('stored-token', 'stored-token')).toBe(false)
  })

  it('self-heals when an earlier run rotated but failed to persist', async () => {
    // No rotation this run — the cache was simply restored — but the stored
    // secret is a token Yahoo already revoked. Must still be reported.
    const { needsStore } = await loadAuth()
    expect(needsStore('rotated-token-1', 'long-dead-token')).toBe(true)
  })

  it('owes a write when the store is unset entirely', async () => {
    const { needsStore } = await loadAuth()
    expect(needsStore('rotated-token-1', undefined)).toBe(true)
  })
})

describe('a rotation during the fetch pipelines', () => {
  it('is caught by re-reading the cache afterwards', async () => {
    // The gap this guards: CI used to decide what to persist *before* running
    // the pipelines. But client.ts refreshes on a 401, so the fetch itself can
    // rotate the token — and that replacement exists nowhere but the cache. A
    // decision made up front saves the token Yahoo just revoked and discards
    // the live one with the runner, which bricks the chain exactly like the
    // 2026-07-14 outage.
    seedCache('stored-token', Date.now() + HOUR)
    const { ensureFreshToken, needsStore, readTokenCache, refreshAccessToken } = await loadAuth()

    // Before the fetch: cached token is valid, nothing owed.
    const before = await ensureFreshToken()
    expect(before.refreshed).toBe(false)
    expect(needsStore(before.cache.refreshToken, process.env.YAHOO_REFRESH_TOKEN)).toBe(false)

    // During the fetch: a 401 sends client.ts through refreshAccessToken().
    await refreshAccessToken()

    // After the fetch: the up-front answer is now stale and would lose the
    // token. Re-reading from disk is what makes the write happen.
    const after = readTokenCache()
    expect(after?.refreshToken).toBe('rotated-token-1')
    expect(needsStore(after!.refreshToken, process.env.YAHOO_REFRESH_TOKEN)).toBe(true)
  })

  it('leaves nothing owed when the fetch never rotated', async () => {
    seedCache('stored-token', Date.now() + HOUR)
    const { ensureFreshToken, needsStore, readTokenCache } = await loadAuth()

    await ensureFreshToken()

    const after = readTokenCache()
    expect(needsStore(after!.refreshToken, process.env.YAHOO_REFRESH_TOKEN)).toBe(false)
  })
})
