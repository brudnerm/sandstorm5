/**
 * Fetch draft results joined to full-season MLB production:
 *
 *   data/{leagueId}/draft/{season}.json
 *
 * Two sources. Yahoo's `draftresults` endpoint gives the picks (round,
 * overall, team, player, and its own keeper annotation); the public MLB
 * Stats API gives what each of those players actually did over the season.
 * The bridge between them is the player's name, so the matching is the part
 * worth reading carefully:
 *
 *   1. Pull MLB's season player directory and index it by normalized name
 *      (accents folded, Jr./III dropped, Yahoo's "(Pitcher)" parenthetical
 *      stripped) — the same normalizeName() the Statcast join already uses.
 *   2. When a normalized name is ambiguous, split it by role: Yahoo tells us
 *      whether the drafted player is a batter or a pitcher, and MLB tells us
 *      the same, so "Will Smith" resolves correctly on both sides.
 *   3. OVERRIDES below catch the stragglers by exact Yahoo name.
 *
 * Unmatched names are printed and recorded in the shard rather than being
 * silently dropped — a missing star badly distorts the value pool, so it
 * should be loud.
 *
 * Requires the settings shard (run fetch:settings first). Yahoo auth is
 * needed; the MLB API is public. Roughly 15 Yahoo + 10 MLB requests per
 * league, and the MLB directory and stat lookups are shared across leagues.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseInnings,
  type DraftBatting,
  type DraftPick,
  type DraftPitching,
  type DraftShard,
} from '../domain/draft.js'
import { LEAGUES, currentSeason } from '../domain/leagues.js'
import { normalizeName } from '../domain/mlb.js'
import type { LeagueSeasonSettings } from '../domain/stats.js'
import { yahooGet } from '../yahoo/client.js'
import { keeperOverallPicks, parseDraftResults } from '../yahoo/normalize/draft.js'
import { normalizeLeaguePlayers, type ParsedPlayer } from '../yahoo/normalize/players.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DATA_DIR = path.join(ROOT, 'data')

/** Yahoo caps the players collection at 25 keys per request. */
const YAHOO_PAGE = 25
/** statsapi tolerates far more, but ~40 keeps URLs and responses sane. */
const MLB_BATCH = 40

/**
 * Names the directory join can't settle on its own, keyed by the exact Yahoo
 * name. Two-way players are the main case: Yahoo carries Ohtani as two
 * separate draftable players, both of which normalize to one MLBAM id.
 */
const OVERRIDES: Record<string, number> = {
  // Yahoo carries two-way players as two draftable entries; both are one id.
  'Shohei Ohtani (Pitcher)': 660271,
  'Shohei Ohtani (Batter)': 660271,
  // Two active Max Muncys, both listed 3B, so neither role nor position
  // separates them. This is the Dodgers veteran (b. 1990); the Athletics
  // prospect is 691777. Yahoo's editorial team says LAD.
  'Max Muncy': 571970,
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 1))
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function mlbGet(url: string): Promise<Record<string, unknown>> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`)
  return (await resp.json()) as Record<string, unknown>
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ── MLBAM directory, shared across leagues ────────────────────────────

interface MlbPerson {
  id: number
  fullName: string
  isPitcher: boolean
}

/**
 * normalized name → the people carrying it. Kept as a list because the
 * ambiguity is the point: resolution picks by role.
 */
type Directory = Map<string, MlbPerson[]>

async function loadDirectory(season: string): Promise<Directory> {
  const raw = await mlbGet(
    `https://statsapi.mlb.com/api/v1/sports/1/players?season=${season}&gameType=R`,
  )
  const people = (raw['people'] as Array<Record<string, unknown>>) ?? []
  const dir: Directory = new Map()
  for (const person of people) {
    const position = (person['primaryPosition'] ?? {}) as Record<string, unknown>
    const entry: MlbPerson = {
      id: Number(person['id']),
      fullName: String(person['fullName'] ?? ''),
      isPitcher: String(position['type'] ?? '') === 'Pitcher',
    }
    const key = normalizeName(entry.fullName)
    if (!key) continue
    const list = dir.get(key) ?? []
    list.push(entry)
    dir.set(key, list)
  }
  console.log(`  statsapi directory: ${people.length} players, ${dir.size} distinct names`)
  return dir
}

/**
 * Resolve one Yahoo player to an MLBAM id. `wantsPitcher` comes from Yahoo's
 * position_type, and is used only to break ties — a lone match wins even if
 * the roles disagree, since Yahoo and MLB classify swingmen differently.
 */
type Resolution =
  | { id: number }
  | { id: null; reason: 'absent' | 'ambiguous' }

function resolve(player: ParsedPlayer, dir: Directory): Resolution {
  const override = OVERRIDES[player.name]
  if (override !== undefined) return { id: override }

  const candidates = dir.get(normalizeName(player.name))
  if (!candidates || candidates.length === 0) return { id: null, reason: 'absent' }
  if (candidates.length === 1) return { id: candidates[0]!.id }

  const wantsPitcher = player.positionType === 'P'
  const byRole = candidates.filter(c => c.isPitcher === wantsPitcher)
  if (byRole.length === 1) return { id: byRole[0]!.id }
  // Same name, same role (two active Max Muncys, both 3B). Never guess —
  // an override belongs above, and the pipeline prints this loudly.
  return { id: null, reason: 'ambiguous' }
}

// ── Season stat lines, shared across leagues ──────────────────────────

interface SeasonLines {
  batting: DraftBatting | null
  pitching: DraftPitching | null
}

/**
 * Pick the season TOTAL split. A player who was traded gets one split per
 * stop plus an aggregate; only the aggregate lacks a `team`, and summing the
 * stops instead would double-count nothing but would break every rate stat.
 */
function totalSplit(splits: Array<Record<string, unknown>>): Record<string, unknown> | null {
  if (splits.length === 0) return null
  const aggregate = splits.find(s => !('team' in s))
  const chosen = aggregate ?? splits[0]!
  return (chosen['stat'] as Record<string, unknown>) ?? null
}

async function loadSeasonLines(
  mlbamIds: number[],
  season: string,
): Promise<Map<number, SeasonLines>> {
  const lines = new Map<number, SeasonLines>()
  for (const batch of chunk(mlbamIds, MLB_BATCH)) {
    const url =
      `https://statsapi.mlb.com/api/v1/people?personIds=${batch.join(',')}` +
      `&hydrate=stats(group=[hitting,pitching],type=[season],season=${season})`
    const raw = await mlbGet(url)
    for (const person of (raw['people'] as Array<Record<string, unknown>>) ?? []) {
      const id = Number(person['id'])
      const groups = (person['stats'] as Array<Record<string, unknown>>) ?? []
      let batting: DraftBatting | null = null
      let pitching: DraftPitching | null = null

      for (const group of groups) {
        const name = String((group['group'] as Record<string, unknown>)?.['displayName'] ?? '')
        const splits = (group['splits'] as Array<Record<string, unknown>>) ?? []
        const stat = totalSplit(splits)
        if (!stat) continue
        if (name === 'hitting') {
          batting = {
            ab: num(stat['atBats']),
            r: num(stat['runs']),
            hr: num(stat['homeRuns']),
            rbi: num(stat['rbi']),
            sb: num(stat['stolenBases']),
            avg: num(stat['avg']),
            obp: num(stat['obp']),
          }
        } else if (name === 'pitching') {
          pitching = {
            ip: parseInnings(stat['inningsPitched']),
            w: num(stat['wins']),
            l: num(stat['losses']),
            sv: num(stat['saves']),
            k: num(stat['strikeOuts']),
            era: num(stat['era']),
            whip: num(stat['whip']),
          }
        }
      }
      lines.set(id, { batting, pitching })
    }
  }
  return lines
}

// ── Yahoo player identity ─────────────────────────────────────────────

async function fetchPlayerInfo(
  leagueKey: string,
  settings: LeagueSeasonSettings,
  playerKeys: string[],
): Promise<Map<string, ParsedPlayer>> {
  const info = new Map<string, ParsedPlayer>()
  for (const batch of chunk(playerKeys, YAHOO_PAGE)) {
    const raw = await yahooGet(`league/${leagueKey}/players;player_keys=${batch.join(',')}`)
    for (const player of normalizeLeaguePlayers(raw, settings)) {
      info.set(player.playerKey, player)
    }
  }
  return info
}

// ── Main ──────────────────────────────────────────────────────────────

const season = currentSeason(LEAGUES[0]!)
console.log(`Draft results + season production, ${season}`)
const directory = await loadDirectory(season)
/** mlbamId → season lines, memoized across leagues. */
const lineCache = new Map<number, SeasonLines>()

for (const league of LEAGUES) {
  const leagueSeason = currentSeason(league)
  const leagueKey = league.seasons[leagueSeason]!
  console.log(`[${league.id}] ${leagueSeason} (${leagueKey})`)

  const settings = readJson<LeagueSeasonSettings>(
    path.join(DATA_DIR, league.id, 'settings', `${leagueSeason}.json`),
  )

  const raw = await yahooGet(`league/${leagueKey}/draftresults`)
  const parsed = parseDraftResults(raw)
  if (parsed.length === 0) {
    console.log('  no draft results — skipping')
    continue
  }
  const keepers = keeperOverallPicks(parsed)
  console.log(`  ${parsed.length} picks (${keepers.size} keepers) across ` +
    `${new Set(parsed.map(p => p.teamKey)).size} teams`)

  const playerKeys = [...new Set(parsed.map(p => p.playerKey))]
  const info = await fetchPlayerInfo(leagueKey, settings, playerKeys)
  console.log(`  resolved ${info.size}/${playerKeys.length} Yahoo players`)

  // ── Name → MLBAM, then the season lines those ids need ──────────────
  const mlbamByName: Record<string, number> = {}
  const unmatched: string[] = []
  const ambiguous: string[] = []
  for (const key of playerKeys) {
    const player = info.get(key)
    if (!player) continue
    const resolved = resolve(player, directory)
    if (resolved.id !== null) {
      mlbamByName[player.name] = resolved.id
      continue
    }
    unmatched.push(player.name)
    if (resolved.reason === 'ambiguous') ambiguous.push(player.name)
  }

  const needed = [...new Set(Object.values(mlbamByName))].filter(id => !lineCache.has(id))
  if (needed.length > 0) {
    for (const [id, line] of await loadSeasonLines(needed, leagueSeason)) {
      lineCache.set(id, line)
    }
  }

  const picks: DraftPick[] = parsed.map((pick): DraftPick => {
    const player = info.get(pick.playerKey)
    const name = player?.name ?? pick.playerKey
    const mlbamId = mlbamByName[name] ?? null
    const lines = mlbamId !== null ? lineCache.get(mlbamId) : undefined
    // Gate the stat line on Yahoo's role. Two-way players appear twice in
    // Yahoo with one MLBAM id, and a pitcher's plate appearances must never
    // land in the hitter pool.
    const isPitcher = player?.positionType === 'P'
    return {
      round: pick.round,
      overall: pick.overall,
      teamKey: pick.teamKey,
      playerKey: pick.playerKey,
      name,
      position: player?.displayPosition ?? '',
      role: isPitcher ? 'pitching' : 'batting',
      mlbTeam: player?.mlbTeam ?? '',
      keeper: keepers.has(pick.overall),
      mlbamId,
      batting: isPitcher ? null : lines?.batting ?? null,
      pitching: isPitcher ? lines?.pitching ?? null : null,
    }
  })

  const withStats = picks.filter(p => p.batting || p.pitching).length
  writeJson(path.join(DATA_DIR, league.id, 'draft', `${leagueSeason}.json`), {
    leagueId: league.id,
    leagueKey,
    season: leagueSeason,
    picks,
    mlbamByName,
    unmatched,
  } satisfies DraftShard)

  console.log(`  ${withStats}/${picks.length} picks carry a season line`)
  // Unmatched is usually not a bug: a player who missed the whole season, or
  // a prospect who never debuted, is genuinely absent from the season
  // directory and genuinely produced nothing. Ambiguous IS a bug — it means a
  // name needs an entry in OVERRIDES.
  if (unmatched.length > 0) {
    console.log(`  no season line (${unmatched.length}): ${unmatched.join(', ')}`)
  }
  if (ambiguous.length > 0) {
    console.log(`  AMBIGUOUS — add to OVERRIDES (${ambiguous.length}): ${ambiguous.join(', ')}`)
  }
  console.log(`  wrote data/${league.id}/draft/${leagueSeason}.json`)
}

console.log('\nDone.')
