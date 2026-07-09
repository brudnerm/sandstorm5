/**
 * Scoreboard + standings normalizer tests against recorded mid-season
 * fixtures (July 2026, week 16, live games in progress).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { statKey } from '../src/domain/stats.js'
import type { YahooResponse } from '../src/yahoo/client.js'
import { normalizeScoreboard } from '../src/yahoo/normalize/scoreboard.js'
import { normalizeSettings } from '../src/yahoo/normalize/settings.js'
import { normalizeStandings } from '../src/yahoo/normalize/standings.js'

const FIXTURES = path.resolve(__dirname, '../fixtures')

function load(rel: string): YahooResponse {
  return JSON.parse(readFileSync(path.join(FIXTURES, rel), 'utf8'))
}

const sidebarSettings = normalizeSettings(load('settings/sidebar-2026.json'), 'sidebar')
const kpSettings = normalizeSettings(load('settings/kp-2026.json'), 'kp')

describe('normalizeScoreboard (sidebar 2026, live week)', () => {
  const { week, matchups } = normalizeScoreboard(load('scoreboard/sidebar-2026-current.json'), sidebarSettings)

  it('parses a full week of matchups', () => {
    expect(week).toBeGreaterThan(0)
    expect(matchups.length).toBeGreaterThanOrEqual(4) // 10-team league minus byes
    for (const m of matchups) expect(m.teams).toHaveLength(2)
  })

  it('keys team stats by (role, stat_id) — batter-K and pitcher-K both survive', () => {
    const team = matchups[0]!.teams[0]!
    expect(team.stats[statKey('batting', 21)]).toBeDefined()   // batter K
    expect(team.stats[statKey('pitching', 42)]).toBeDefined()  // pitcher K
    expect(team.stats[statKey('batting', 22)]).toBeDefined()   // batter GIDP
    expect(team.stats[statKey('pitching', 46)]).toBeDefined()  // pitcher GIDP
  })

  it('category score sums to the number of scored categories', () => {
    const scored = sidebarSettings.categories.filter(c => !c.isDisplayOnly).length
    for (const m of matchups) {
      for (const team of m.teams) {
        expect(team.score.w + team.score.l + team.score.t).toBe(scored)
      }
    }
  })

  it('opponents have mirrored outcomes', () => {
    for (const m of matchups) {
      const [a, b] = m.teams
      expect(a.score.w).toBe(b.score.l)
      expect(a.score.l).toBe(b.score.w)
      expect(a.score.t).toBe(b.score.t)
      for (const key of Object.keys(a.results) as (keyof typeof a.results)[]) {
        const flip = { win: 'loss', loss: 'win', tie: 'tie' } as const
        expect(b.results[key]).toBe(flip[a.results[key]!])
      }
    }
  })

  it('display-only categories never score', () => {
    const hab = statKey('batting', 60)
    for (const m of matchups) {
      for (const team of m.teams) {
        if (hab in team.results) expect(team.results[hab]).toBe('tie')
      }
    }
  })

  it('agrees with Yahoo team_points totals', () => {
    // team_points.total in the raw fixture is Yahoo's own category-win count
    const raw = load('scoreboard/sidebar-2026-current.json')
    const leagueArr = raw.fantasy_content['league'] as unknown[]
    const matchupsObj = (leagueArr[1] as Record<string, Record<string, Record<string, unknown>>>)['scoreboard']!['0']!['matchups'] as Record<string, unknown>
    const count = Number((matchupsObj as { count?: number }).count ?? 0)
    for (let i = 0; i < count; i++) {
      const rawMatchup = (matchupsObj[String(i)] as Record<string, unknown>)['matchup'] as Record<string, unknown>
      const teamsObj = (rawMatchup['0'] as Record<string, unknown>)['teams'] as Record<string, unknown>
      for (let t = 0; t < 2; t++) {
        const wrapper = (teamsObj[String(t)] as Record<string, unknown>)['team'] as unknown[]
        const points = ((wrapper[1] as Record<string, unknown>)['team_points'] as Record<string, unknown>)['total']
        expect(matchups[i]!.teams[t]!.score.w).toBe(Number(points))
      }
    }
  })
})

describe('normalizeScoreboard (kp 2026)', () => {
  const { matchups } = normalizeScoreboard(load('scoreboard/kp-2026-current.json'), kpSettings)

  it('parses 6 matchups for a 12-team league', () => {
    expect(matchups).toHaveLength(6)
  })

  it('carries live-game telemetry', () => {
    const team = matchups[0]!.teams[0]!
    expect(team.completedGames).not.toBeNull()
    expect(team.remainingGames).not.toBeNull()
  })
})

describe('normalizeStandings', () => {
  const kp = normalizeStandings(load('standings/kp-2026.json'))
  const sidebar = normalizeStandings(load('standings/sidebar-2026.json'))

  it('returns all teams sorted by rank', () => {
    expect(kp).toHaveLength(12)
    expect(sidebar).toHaveLength(10)
    expect(kp.map(r => r.rank)).toEqual([...Array(12)].map((_, i) => i + 1))
  })

  it('parses records and games back', () => {
    const leader = kp[0]!
    expect(leader.wins).toBeGreaterThan(0)
    expect(leader.gamesBack).toBe('-')
    expect(leader.percentage).toMatch(/^\.\d{3}$/)
  })

  it('parses manager identity with guid', () => {
    for (const row of kp) {
      expect(row.manager).not.toBe('')
      expect(row.managerGuid).not.toBeNull()
    }
  })

  it('sidebar carries FAAB balances', () => {
    expect(sidebar.some(r => r.faabBalance !== null)).toBe(true)
  })
})
