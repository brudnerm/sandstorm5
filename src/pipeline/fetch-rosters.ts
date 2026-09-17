/**
 * Fetch weekly roster snapshots and derive injury history:
 *
 *   data/{leagueId}/rosters/{season}/{week}.json   who was on each roster,
 *                                                  and the lineup slot they
 *                                                  filled, that week
 *   data/{leagueId}/injuries/{season}.json         IL stints derived from the
 *                                                  weekly snapshots
 *
 * The stored `status` is the player's status when the snapshot was *taken*,
 * not that week's — only `selectedPosition` is week-scoped, and it is what the
 * stints are cut from. See the note at the top of src/domain/rosters.ts.
 *
 * Earlier weeks are immutable once played, so only the current week is
 * re-fetched on a steady-state run — a full backfill (all weeks × all teams)
 * only happens once per league.
 *
 * `--rederive` rebuilds the injury shards from the stored snapshots and makes
 * no Yahoo calls at all. Use it after changing the stint logic: the snapshots
 * are the expensive part, the derivation is free, and re-deriving offline
 * keeps a code change from spending API budget or rotating the token. Requires live.json + settings (run
 * fetch:settings and fetch:live first); the injury shard's season lines also
 * prefer the draft shard and fall back to players/current.json, so those are
 * best fetched first too (fetch:draft, fetch:players) though neither is
 * required.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DraftShard } from '../domain/draft.js'
import { LEAGUES, currentSeason } from '../domain/leagues.js'
import type { LiveShard } from '../domain/matchups.js'
import type { PlayersShard } from '../domain/players.js'
import {
  deriveInjuryStints,
  statLineToSeasonLine,
  type InjuriesShard,
  type InjuryStint,
  type WeekSnapshot,
  type WeeklyRosterPlayer,
  type WeeklyRostersShard,
  type WeeklyTeamRoster,
} from '../domain/rosters.js'
import type { LeagueSeasonSettings } from '../domain/stats.js'
import { yahooGet } from '../yahoo/client.js'
import { normalizeRoster } from '../yahoo/normalize/players.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DATA_DIR = path.join(ROOT, 'data')
const REDERIVE = process.argv.includes('--rederive')

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 1))
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

async function fetchWeekRosters(
  leagueKey: string,
  settings: LeagueSeasonSettings,
  teamKeys: string[],
  week: number,
): Promise<WeeklyTeamRoster[]> {
  const teams: WeeklyTeamRoster[] = []
  for (const teamKey of teamKeys) {
    const raw = await yahooGet(`team/${teamKey}/roster;week=${week}/players`)
    const { players } = normalizeRoster(raw, settings)
    teams.push({
      teamKey,
      players: players.map((p): WeeklyRosterPlayer => ({
        playerKey: p.playerKey,
        name: p.name,
        positions: p.eligiblePositions,
        selectedPosition: p.selectedPosition,
        status: p.status,
      })),
    })
  }
  return teams
}

for (const league of LEAGUES) {
  const season = currentSeason(league)
  const leagueKey = league.seasons[season]!
  const settings = readJson<LeagueSeasonSettings>(
    path.join(DATA_DIR, league.id, 'settings', `${season}.json`),
  )
  const live = readJson<LiveShard>(path.join(DATA_DIR, league.id, 'live.json'))
  if (!settings || !live) {
    console.log(`[${league.id}] missing settings/live.json — run fetch:settings and fetch:live first, skipping`)
    continue
  }

  const currentWeek = live.currentWeek
  const teamKeys = live.standings.map(row => row.teamKey)
  console.log(`[${league.id}] ${season} weeks 1-${currentWeek} (${leagueKey})`)

  const rostersDir = path.join(DATA_DIR, league.id, 'rosters', season)
  const weeks: WeekSnapshot[] = []
  let fetched = 0

  for (let w = 1; w <= currentWeek; w++) {
    const weekPath = path.join(rostersDir, `${w}.json`)
    // The current week is still in progress, so its snapshot is refreshed
    // every run; past weeks are settled and never re-fetched.
    const stale = w === currentWeek && !REDERIVE
    const existing = stale ? null : readJson<WeeklyRostersShard>(weekPath)
    if (existing) {
      weeks.push({ week: w, teams: existing.teams })
      continue
    }
    if (REDERIVE) {
      console.log(`  week ${w}: no stored snapshot — skipping (--rederive makes no Yahoo calls)`)
      continue
    }
    const teams = await fetchWeekRosters(leagueKey, settings, teamKeys, w)
    writeJson(weekPath, { leagueId: league.id, season, week: w, teams } satisfies WeeklyRostersShard)
    weeks.push({ week: w, teams })
    fetched++
  }
  console.log(`  rosters: ${weeks.length} weeks stored (${fetched} fetched)`)

  // ── Injury stints, joined to season production ─────────────────────
  const draft = readJson<DraftShard>(path.join(DATA_DIR, league.id, 'draft', `${season}.json`))
  const players = readJson<PlayersShard>(path.join(DATA_DIR, league.id, 'players', 'current.json'))

  const draftByKey = new Map((draft?.picks ?? []).map(p => [p.playerKey, p]))
  const rosterByKey = new Map(
    (players?.rosters ?? []).flatMap(r => r.players.map(p => [p.playerKey, p] as const)),
  )

  const stints: InjuryStint[] = deriveInjuryStints(weeks).map(stint => {
    const pick = draftByKey.get(stint.playerKey)
    if (pick && (pick.batting || pick.pitching)) {
      return { ...stint, seasonLine: { role: pick.role, batting: pick.batting, pitching: pick.pitching } }
    }
    const roster = rosterByKey.get(stint.playerKey)
    const seasonStats = roster?.windows.season
    if (roster && seasonStats) {
      const role = roster.positionType === 'P' ? 'pitching' : 'batting'
      return { ...stint, seasonLine: statLineToSeasonLine(role, seasonStats, settings.categories) }
    }
    return { ...stint, seasonLine: null }
  })

  writeJson(path.join(DATA_DIR, league.id, 'injuries', `${season}.json`), {
    leagueId: league.id,
    season,
    asOfWeek: currentWeek,
    playoffStartWeek: settings.playoffStartWeek,
    numPlayoffTeams: settings.numPlayoffTeams,
    stints,
  } satisfies InjuriesShard)

  const ongoing = stints.filter(s => s.lastWeek === null).length
  console.log(`  injuries: ${stints.length} stints (${ongoing} ongoing)`)
  // Stints are cut from the IL lineup slot, which is week-scoped; `status` is
  // not (see src/domain/rosters.ts). If a backfill ever reads `status` again,
  // every stint runs to the final week and this is what shows it.
  if (stints.length > 4 && ongoing === stints.length) {
    console.warn(
      `  [${league.id}] WARNING: every stint is open at week ${currentWeek}. ` +
      'That is the signature of reading a non-week-scoped field — check the derivation.',
    )
  }
}

console.log('\nDone.')
