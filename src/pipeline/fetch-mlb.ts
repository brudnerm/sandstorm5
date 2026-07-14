/**
 * Fetch league-agnostic MLB reference data → data/mlb/players.json
 *
 * Joins the MLB StatsAPI player directory (identity: MLBAM id, team,
 * position, handedness) with Baseball Savant's expected-statistics and
 * statcast leaderboards (quality of contact), all keyed by MLBAM id.
 * The client matches Yahoo players to these entries by normalized name.
 *
 * No auth required — both APIs are public. ~6 requests total.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MlbPlayer, MlbShard, StatcastBatting, StatcastPitching } from '../domain/mlb.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SEASON = String(new Date().getFullYear())
const SAVANT_MIN = 10 // min PA — low, so waiver-wire part-timers are covered

async function getJson(url: string): Promise<Record<string, unknown>> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`)
  return (await resp.json()) as Record<string, unknown>
}

async function getCsv(url: string): Promise<Array<Record<string, string>>> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`)
  return parseCsv(await resp.text())
}

/** Minimal CSV parser: quoted fields may contain commas (e.g. "Last, First"). */
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^﻿/, '').split('\n').filter(l => l.trim() !== '')
  if (lines.length === 0) return []
  const parseLine = (line: string): string[] => {
    const fields: string[] = []
    let field = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (inQuotes) {
        if (ch === '"') inQuotes = false
        else field += ch
      } else if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(field)
        field = ''
      } else {
        field += ch
      }
    }
    fields.push(field)
    return fields
  }
  const header = parseLine(lines[0]!)
  return lines.slice(1).map(line => {
    const values = parseLine(line)
    const row: Record<string, string> = {}
    header.forEach((h, i) => { row[h] = values[i] ?? '' })
    return row
  })
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

function indexById(rows: Array<Record<string, string>>): Map<number, Record<string, string>> {
  const map = new Map<number, Record<string, string>>()
  for (const row of rows) {
    const id = num(row['player_id'])
    if (id !== null) map.set(id, row)
  }
  return map
}

console.log(`MLB reference data, season ${SEASON}`)

// ── Identity: every active player, plus team-id → abbreviation ────────
const teamsRaw = await getJson(`https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${SEASON}`)
const teamAbbr = new Map<number, string>()
for (const team of (teamsRaw['teams'] as Array<Record<string, unknown>>) ?? []) {
  teamAbbr.set(Number(team['id']), String(team['abbreviation'] ?? ''))
}

const peopleRaw = await getJson(`https://statsapi.mlb.com/api/v1/sports/1/players?season=${SEASON}`)
const people = (peopleRaw['people'] as Array<Record<string, unknown>>) ?? []
console.log(`  statsapi: ${people.length} players, ${teamAbbr.size} teams`)

// ── Savant leaderboards, joined by MLBAM id ───────────────────────────
const savant = 'https://baseballsavant.mlb.com/leaderboard'
const [xB, xP, scB, scP] = await Promise.all([
  getCsv(`${savant}/expected_statistics?type=batter&year=${SEASON}&position=&team=&csv=true&min=${SAVANT_MIN}`),
  getCsv(`${savant}/expected_statistics?type=pitcher&year=${SEASON}&position=&team=&csv=true&min=${SAVANT_MIN}`),
  getCsv(`${savant}/statcast?type=batter&year=${SEASON}&csv=true&min=${SAVANT_MIN}`),
  getCsv(`${savant}/statcast?type=pitcher&year=${SEASON}&csv=true&min=${SAVANT_MIN}`),
])
console.log(`  savant: ${xB.length} xstat batters, ${xP.length} xstat pitchers, ${scB.length}/${scP.length} statcast`)
const xBat = indexById(xB)
const xPit = indexById(xP)
const scBat = indexById(scB)
const scPit = indexById(scP)

function batting(id: number): StatcastBatting | null {
  const x = xBat.get(id)
  const sc = scBat.get(id)
  if (!x && !sc) return null
  return {
    pa: num(x?.['pa']),
    ba: num(x?.['ba']),
    xba: num(x?.['est_ba']),
    slg: num(x?.['slg']),
    xslg: num(x?.['est_slg']),
    woba: num(x?.['woba']),
    xwoba: num(x?.['est_woba']),
    ev: num(sc?.['avg_hit_speed']),
    maxEv: num(sc?.['max_hit_speed']),
    hardHitPct: num(sc?.['ev95percent']),
    barrelPct: num(sc?.['brl_percent']),
    sweetSpotPct: num(sc?.['anglesweetspotpercent']),
  }
}

function pitching(id: number): StatcastPitching | null {
  const x = xPit.get(id)
  const sc = scPit.get(id)
  if (!x && !sc) return null
  return {
    pa: num(x?.['pa']),
    ba: num(x?.['ba']),
    xba: num(x?.['est_ba']),
    woba: num(x?.['woba']),
    xwoba: num(x?.['est_woba']),
    era: num(x?.['era']),
    xera: num(x?.['xera']),
    ev: num(sc?.['avg_hit_speed']),
    hardHitPct: num(sc?.['ev95percent']),
    barrelPct: num(sc?.['brl_percent']),
  }
}

const players: MlbPlayer[] = people.map(p => {
  const id = Number(p['id'])
  const teamId = Number((p['currentTeam'] as Record<string, unknown> | undefined)?.['id'])
  return {
    mlbamId: id,
    name: String(p['fullName'] ?? ''),
    team: teamAbbr.get(teamId) ?? '',
    position: String((p['primaryPosition'] as Record<string, unknown> | undefined)?.['abbreviation'] ?? ''),
    bats: (p['batSide'] as Record<string, unknown> | undefined)?.['code'] as string ?? null,
    throws: (p['pitchHand'] as Record<string, unknown> | undefined)?.['code'] as string ?? null,
    batting: batting(id),
    pitching: pitching(id),
  }
})

const withStatcast = players.filter(p => p.batting || p.pitching).length
const outPath = path.join(ROOT, 'data', 'mlb', 'players.json')
mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify({ season: SEASON, players } satisfies MlbShard, null, 1))
console.log(`  wrote ${players.length} players (${withStatcast} with statcast) → ${path.relative(ROOT, outPath)}`)
