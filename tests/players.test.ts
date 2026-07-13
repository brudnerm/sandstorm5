/**
 * Player normalizer tests against recorded mid-season fixtures (July 2026,
 * KP week 16): a team roster with weekly stats, a free-agent list with
 * last-week stats, a percent_owned list, and a batched lastmonth request.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { statKey } from '../src/domain/stats.js'
import type { YahooResponse } from '../src/yahoo/client.js'
import { normalizeLeaguePlayers, normalizeRoster } from '../src/yahoo/normalize/players.js'
import { normalizeSettings } from '../src/yahoo/normalize/settings.js'

const FIXTURES = path.resolve(__dirname, '../fixtures')

function load(rel: string): YahooResponse {
  return JSON.parse(readFileSync(path.join(FIXTURES, rel), 'utf8'))
}

const settings = normalizeSettings(load('settings/kp-2026.json'), 'kp')

describe('normalizeRoster (kp 2026, week stats)', () => {
  const { teamKey, players } = normalizeRoster(load('players/kp-2026-roster-week.json'), settings)

  it('parses the full roster', () => {
    expect(teamKey).toBe('469.l.13624.t.1')
    expect(players.length).toBeGreaterThanOrEqual(20)
  })

  it('carries identity, positions, and lineup slot', () => {
    const dingler = players.find(p => p.name === 'Dillon Dingler')!
    expect(dingler).toBeDefined()
    expect(dingler.mlbTeam).toBe('DET')
    expect(dingler.positionType).toBe('B')
    expect(dingler.eligiblePositions).toContain('C')
    expect(dingler.selectedPosition).toBe('C')
    expect(dingler.headshotUrl).toMatch(/^https:/)
  })

  it('keys player stats by (role, stat_id) from league categories', () => {
    const batter = players.find(p => p.positionType === 'B' && p.stats)!
    expect(batter.coverage).toBe('week')
    // batter stat lines only carry batting keys
    for (const key of Object.keys(batter.stats!)) {
      expect(key.startsWith('batting:')).toBe(true)
    }
    const pitcher = players.find(p => p.positionType === 'P' && p.stats)!
    for (const key of Object.keys(pitcher.stats!)) {
      expect(key.startsWith('pitching:')).toBe(true)
    }
  })

  it('parses injury status when present', () => {
    const onIl = players.filter(p => p.status !== null)
    expect(onIl.length).toBeGreaterThan(0)
    expect(onIl.some(p => p.status!.startsWith('IL'))).toBe(true)
  })
})

describe('normalizeLeaguePlayers (kp 2026 free agents)', () => {
  const lastweek = normalizeLeaguePlayers(load('players/kp-2026-fa-lastweek.json'), settings)
  const owned = normalizeLeaguePlayers(load('players/kp-2026-fa-percent-owned.json'), settings)
  const batch = normalizeLeaguePlayers(load('players/kp-2026-batch-lastmonth.json'), settings)

  it('parses a page of free agents with lastweek coverage', () => {
    expect(lastweek).toHaveLength(25)
    for (const p of lastweek) {
      expect(p.playerKey).toMatch(/^469\.p\./)
      if (p.stats) expect(p.coverage).toBe('lastweek')
    }
  })

  it('parses percent_owned value and delta', () => {
    expect(owned).toHaveLength(25)
    const withOwnership = owned.filter(p => p.percentOwned !== null)
    expect(withOwnership.length).toBeGreaterThan(0)
    expect(withOwnership.some(p => p.ownershipDelta !== null)).toBe(true)
  })

  it('parses batched lastmonth stats', () => {
    expect(batch).toHaveLength(10)
    for (const p of batch) {
      expect(p.coverage).toBe('lastmonth')
      expect(p.stats).not.toBeNull()
    }
    const dingler = batch.find(p => p.name === 'Dillon Dingler')!
    expect(dingler.stats![statKey('batting', 12)]).toBeDefined() // HR
  })
})
