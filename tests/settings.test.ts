/**
 * Normalizer tests against recorded Yahoo API responses (fixtures/settings/).
 * The GIDP test is the acceptance test for the whole data model: the same
 * abbreviation must be able to score in opposite directions per role.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareStat, statKey } from '../src/domain/stats.js'
import type { YahooResponse } from '../src/yahoo/client.js'
import { normalizeSettings } from '../src/yahoo/normalize/settings.js'

const FIXTURES = path.resolve(__dirname, '../fixtures/settings')

function loadFixture(name: string): YahooResponse {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'))
}

describe('GIDP acceptance test (sidebar 2026)', () => {
  const settings = normalizeSettings(loadFixture('sidebar-2026.json'), 'sidebar')

  const batterGidp = settings.categories.find(c => c.abbr === 'GIDP' && c.role === 'batting')
  const pitcherGidp = settings.categories.find(c => c.abbr === 'GIDP' && c.role === 'pitching')
  const batterK = settings.categories.find(c => c.abbr === 'K' && c.role === 'batting')
  const pitcherK = settings.categories.find(c => c.abbr === 'K' && c.role === 'pitching')

  it('carries batter-GIDP and pitcher-GIDP as distinct scored categories', () => {
    expect(batterGidp).toBeDefined()
    expect(pitcherGidp).toBeDefined()
    expect(batterGidp!.statId).not.toBe(pitcherGidp!.statId)
    expect(batterGidp!.isDisplayOnly).toBe(false)
    expect(pitcherGidp!.isDisplayOnly).toBe(false)
  })

  it('scores GIDP in opposite directions for batters vs pitchers', () => {
    expect(batterGidp!.higherIsBetter).toBe(false) // grounding into DPs is bad
    expect(pitcherGidp!.higherIsBetter).toBe(true) // inducing DPs is good
  })

  it('scores K in opposite directions for batters vs pitchers', () => {
    expect(batterK!.higherIsBetter).toBe(false)
    expect(pitcherK!.higherIsBetter).toBe(true)
  })

  it('compareStat resolves the same values oppositely per role', () => {
    // Team A has 10 GIDP, team B has 12 — for batters A wins, for pitchers A loses.
    expect(compareStat(batterGidp!, '10', '12')).toBe('win')
    expect(compareStat(pitcherGidp!, '10', '12')).toBe('loss')
  })

  it('statKey disambiguates what the abbreviation cannot', () => {
    const keys = new Set(settings.categories.map(c => statKey(c.role, c.statId)))
    expect(keys.size).toBe(settings.categories.length)
    const abbrs = new Set(settings.categories.map(c => c.abbr))
    expect(abbrs.size).toBeLessThan(settings.categories.length) // K and GIDP collide
  })

  it('marks display-only stats (H/AB, IP) as never scoring', () => {
    const displayOnly = settings.categories.filter(c => c.isDisplayOnly).map(c => c.abbr)
    expect(displayOnly.sort()).toEqual(['H/AB', 'IP'])
    const hab = settings.categories.find(c => c.abbr === 'H/AB')!
    expect(compareStat(hab, '100', '50')).toBe('tie')
  })
})

describe('KP 2026 settings', () => {
  const settings = normalizeSettings(loadFixture('kp-2026.json'), 'kp')

  it('derives league shape from Yahoo', () => {
    expect(settings.name).toBe('Keeping Pattycakes')
    expect(settings.draftType).toBe('snake')
    expect(settings.numTeams).toBe(12)
    expect(settings.categories.filter(c => !c.isDisplayOnly)).toHaveLength(12)
  })

  it('derives lower-is-better categories from sort_order, not a hand-written list', () => {
    const lower = settings.categories
      .filter(c => !c.higherIsBetter && !c.isDisplayOnly)
      .map(c => c.abbr)
      .sort()
    expect(lower).toEqual(['ERA', 'L', 'WHIP'])
  })
})

describe('compareStat edge cases', () => {
  const era = {
    statId: 26, role: 'pitching' as const, abbr: 'ERA', name: 'ERA',
    higherIsBetter: false, isDisplayOnly: false,
  }

  it('treats near-equal floats as ties', () => {
    expect(compareStat(era, '3.50', '3.5000000001')).toBe('tie')
  })

  it('treats non-numeric values as ties', () => {
    expect(compareStat(era, '-', '3.50')).toBe('tie')
  })

  it('lower ERA wins', () => {
    expect(compareStat(era, '2.90', '3.50')).toBe('win')
  })
})

describe('all recorded fixtures normalize cleanly', () => {
  const files = readdirSync(FIXTURES).filter(f => f.endsWith('.json'))

  it('has fixtures for both leagues across seasons', () => {
    expect(files.length).toBeGreaterThanOrEqual(33)
  })

  it.each(files)('%s', file => {
    const leagueId = file.startsWith('kp-') ? 'kp' : 'sidebar'
    const settings = normalizeSettings(loadFixture(file), leagueId)
    expect(settings.leagueKey).toMatch(/^\d+\.l\.\d+$/)
    expect(settings.season).toMatch(/^\d{4}$/)
    expect(settings.categories.length).toBeGreaterThan(0)
    // Every category fully resolved: role assigned, direction known.
    for (const c of settings.categories) {
      expect(['batting', 'pitching']).toContain(c.role)
      expect(typeof c.higherIsBetter).toBe('boolean')
    }
  })
})
