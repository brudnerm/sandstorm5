/**
 * Yahoo client tests.
 *
 * These exist because `fetch` has no default timeout. During the trophy-room
 * backfill a single stalled Yahoo connection hung a run for ten minutes and
 * had to be killed; nothing in the client would ever have given up. The
 * scheduled refresh workflow has no wall-clock limit of its own, so the same
 * stall in CI would freeze the published data silently.
 *
 * Rules locked in here:
 *   1. Every request carries an abort signal, so a stall cannot hang forever.
 *   2. A timeout or socket error is retried like a 5xx, not thrown on sight.
 *   3. A request that keeps failing eventually throws, naming the resource.
 *   4. The existing 401-refresh and 429/5xx retry behaviour still holds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const OK_BODY = { fantasy_content: { league: [] } }

function okResponse(): Response {
  return { ok: true, status: 200, json: async () => OK_BODY } as unknown as Response
}
function errResponse(status: number, body = 'nope'): Response {
  return { ok: false, status, text: async () => body } as unknown as Response
}

/** Import client.ts fresh so its module-level pacing clock resets per test. */
async function loadClient() {
  vi.resetModules()
  vi.doMock('../src/yahoo/auth.js', () => ({
    getAccessToken: async () => 'test-token',
    refreshAccessToken: vi.fn(async () => ({
      accessToken: 'refreshed',
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
    })),
  }))
  return import('../src/yahoo/client.js')
}

beforeEach(() => {
  // Pacing and backoff sleep for real seconds; fake timers keep tests instant.
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.doUnmock('../src/yahoo/auth.js')
})

describe('yahooGet', () => {
  it('passes an abort signal so a stalled request cannot hang forever', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => okResponse())
    vi.stubGlobal('fetch', fetchSpy)
    const { yahooGet } = await loadClient()

    await yahooGet('league/1.l.1/settings')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0]![1]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('retries a timeout instead of failing the job on one stall', async () => {
    const fetchSpy = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(okResponse())
    vi.stubGlobal('fetch', fetchSpy)
    const { yahooGet } = await loadClient()

    const result = await yahooGet('league/1.l.1/scoreboard')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(result).toEqual(OK_BODY)
  })

  it('gives up after repeated timeouts and names the resource', async () => {
    const fetchSpy = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
    vi.stubGlobal('fetch', fetchSpy)
    const { yahooGet } = await loadClient()

    await expect(yahooGet('league/1.l.1/teams')).rejects.toThrow(/league\/1\.l\.1\/teams/)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('still refreshes the token once on a 401 and retries', async () => {
    const fetchSpy = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(errResponse(401, 'token expired'))
      .mockResolvedValueOnce(okResponse())
    vi.stubGlobal('fetch', fetchSpy)
    const { yahooGet } = await loadClient()

    const result = await yahooGet('league/1.l.1/standings')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(result).toEqual(OK_BODY)
  })

  it('still retries a 429 and surfaces a 400 immediately', async () => {
    const throttled = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(errResponse(429, 'slow down'))
      .mockResolvedValueOnce(okResponse())
    vi.stubGlobal('fetch', throttled)
    const { yahooGet } = await loadClient()
    await expect(yahooGet('league/1.l.1/a')).resolves.toEqual(OK_BODY)
    expect(throttled).toHaveBeenCalledTimes(2)

    // A 400 is Yahoo refusing the resource outright — retrying cannot help.
    const refused = vi.fn(async () => errResponse(400, 'Player key does not exist'))
    vi.stubGlobal('fetch', refused)
    const fresh = await loadClient()
    await expect(fresh.yahooGet('league/1.l.1/transactions')).rejects.toThrow(/400/)
    expect(refused).toHaveBeenCalledTimes(1)
  })
})
