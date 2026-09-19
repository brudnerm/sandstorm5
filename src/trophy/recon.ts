/**
 * Stage 0 recon: pull every KP season from Yahoo, cache the raw responses,
 * and emit a machine summary the audit is written from.
 *
 * Three requests per season — standings, teams, and one multi-week
 * scoreboard (Yahoo accepts a comma-separated week list, so a whole season
 * comes back in a single call). Everything goes through cachedGet, so a
 * rerun costs nothing.
 *
 *   npx tsx src/trophy/recon.ts [--force]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { leagueById } from '../domain/leagues.js'
import { normalizeSettings } from '../yahoo/normalize/settings.js'
import { cachedGet } from './cache.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const force = process.argv.includes('--force')

type AnyObj = Record<string, any>
const asObj = (v: unknown): AnyObj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyObj) : {})
function* indexed(obj: AnyObj): Generator<any> {
  const count = Number(obj['count'] ?? 0)
  for (let i = 0; i < count; i++) yield obj[String(i)]
}
const findKey = (arr: any[], key: string): any =>
  arr.find(x => x && typeof x === 'object' && key in x)?.[key]

/**
 * Yahoo returns `managers` as a real array on the teams endpoint and as a
 * `{count, "0": ...}` pseudo-array on standings/scoreboard. Read both.
 */
function managerList(value: unknown): AnyObj[] {
  const out: AnyObj[] = []
  if (Array.isArray(value)) {
    for (const e of value) {
      const m = asObj(asObj(e)['manager'])
      if (Object.keys(m).length > 0) out.push(m)
    }
    return out
  }
  for (const e of indexed(asObj(value))) {
    const m = asObj(asObj(e)['manager'])
    if (Object.keys(m).length > 0) out.push(m)
  }
  return out
}

function daysBetween(start: string, end: string): number | null {
  const s = Date.parse(`${start}T00:00:00Z`)
  const e = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null
  return Math.round((e - s) / 86_400_000) + 1
}

interface ManagerRef { guid: string | null; nickname: string; isCommish: boolean }
interface TeamRef { teamKey: string; teamId: string; name: string; managers: ManagerRef[] }

interface WeekSummary {
  week: number
  start: string
  end: string
  days: number | null
  matchups: number
  playoff: number
  consolation: number
  statuses: string[]
  /** true when every team in the week reported at least one category value */
  hasStats: boolean
  missingStatTeams: number
}

interface SeasonSummary {
  season: string
  leagueKey: string
  name: string
  numTeams: number
  startWeek: number
  endWeek: number
  startDate: string
  endDate: string
  isFinished: boolean
  playoffStartWeek: number | null
  numPlayoffTeams: number | null
  numConsolationTeams: number | null
  usesReseeding: boolean
  scoredCategories: string[]
  displayOnlyCategories: string[]
  categoryCount: number
  weeks: WeekSummary[]
  regularSeasonWeeks: number[]
  playoffWeeks: number[]
  teams: TeamRef[]
  standings: Array<{
    teamKey: string
    finalRank: number
    playoffSeed: number | null
    wins: number
    losses: number
    ties: number
    percentage: string
    name: string
    manager: string
    managerGuid: string | null
  }>
  champion: { teamKey: string; name: string; manager: string } | null
  runnerUp: { teamKey: string; name: string; manager: string } | null
  lastPlace: { teamKey: string; name: string; manager: string } | null
  problems: string[]
}

const league = leagueById('kp')
const summaries: SeasonSummary[] = []

for (const [season, leagueKey] of Object.entries(league.seasons)) {
  const problems: string[] = []
  const settings = normalizeSettings(
    (await cachedGet(`league/${leagueKey}/settings`, { force })).data,
    'kp',
  )

  // --- league meta (week range, finished flag) ---
  const metaRaw = (await cachedGet(`league/${leagueKey}`, { force })).data
  const meta = asObj((metaRaw.fantasy_content as AnyObj)['league'][0])
  const startWeek = Number(meta['start_week'] ?? 1)
  const endWeek = Number(meta['end_week'] ?? startWeek)
  const isFinished = String(meta['is_finished'] ?? '0') === '1'

  // --- teams + managers ---
  const teamsRaw = (await cachedGet(`league/${leagueKey}/teams`, { force })).data
  const teamsObj = asObj(asObj((teamsRaw.fantasy_content as AnyObj)['league'][1])['teams'])
  const teams: TeamRef[] = []
  for (const entry of indexed(teamsObj)) {
    const arr = asObj(entry)['team'][0] as any[]
    const managers: ManagerRef[] = managerList(findKey(arr, 'managers')).map(mgr => ({
      guid: mgr['guid'] ? String(mgr['guid']) : null,
      nickname: String(mgr['nickname'] ?? ''),
      isCommish: String(mgr['is_commissioner'] ?? '0') === '1',
    }))
    teams.push({
      teamKey: String(findKey(arr, 'team_key')),
      teamId: String(findKey(arr, 'team_id')),
      name: String(findKey(arr, 'name')),
      managers,
    })
  }
  if (teams.length !== settings.numTeams) {
    problems.push(`teams endpoint returned ${teams.length}, settings says ${settings.numTeams}`)
  }

  // --- standings ---
  const standRaw = (await cachedGet(`league/${leagueKey}/standings`, { force })).data
  const standArr = asObj((standRaw.fantasy_content as AnyObj)['league'][1])['standings']
  const standTeams = asObj(asObj(Array.isArray(standArr) ? standArr[0] : standArr)['teams'])
  const standings: SeasonSummary['standings'] = []
  for (const entry of indexed(standTeams)) {
    const t = asObj(entry)['team'] as any[]
    const arr = t[0] as any[]
    const st = asObj(findKey(t, 'team_standings'))
    const outcomes = asObj(st['outcome_totals'])
    const mgr = managerList(findKey(arr, 'managers'))[0] ?? {}
    standings.push({
      teamKey: String(findKey(arr, 'team_key')),
      finalRank: Number(st['rank'] ?? 0),
      playoffSeed: st['playoff_seed'] === undefined || st['playoff_seed'] === '' ? null : Number(st['playoff_seed']),
      wins: Number(outcomes['wins'] ?? 0),
      losses: Number(outcomes['losses'] ?? 0),
      ties: Number(outcomes['ties'] ?? 0),
      percentage: String(outcomes['percentage'] ?? ''),
      name: String(findKey(arr, 'name')),
      manager: String(mgr['nickname'] ?? ''),
      managerGuid: mgr['guid'] ? String(mgr['guid']) : null,
    })
  }
  const unseeded = standings.filter(s => s.playoffSeed === null)
  if (unseeded.length > 0) {
    problems.push(
      `${unseeded.length} of ${standings.length} standings rows have no playoff_seed ` +
      `(${unseeded.map(u => u.name).join('; ')}) — regular-season order below the bracket must come from another source`,
    )
  }
  if (teams.some(t => t.managers.length === 0 || !t.managers[0]!.guid)) {
    problems.push('some teams have no manager GUID')
  }

  // --- full-season scoreboard in one request ---
  const weekList = Array.from({ length: endWeek - startWeek + 1 }, (_, i) => startWeek + i).join(',')
  const sbRaw = (await cachedGet(`league/${leagueKey}/scoreboard;week=${weekList}`, { force })).data
  const sb = asObj(asObj((sbRaw.fantasy_content as AnyObj)['league'][1])['scoreboard'])
  const matchupsObj = asObj(asObj(sb['0'])['matchups'])

  const byWeek = new Map<number, any[]>()
  for (const entry of indexed(matchupsObj)) {
    const mu = asObj(asObj(entry)['matchup'])
    const w = Number(mu['week'])
    const list = byWeek.get(w) ?? []
    list.push(mu)
    byWeek.set(w, list)
  }

  const scoredIds = new Set(settings.categories.filter(c => !c.isDisplayOnly).map(c => c.statId))
  const weeks: WeekSummary[] = []
  for (const w of [...byWeek.keys()].sort((a, b) => a - b)) {
    const list = byWeek.get(w)!
    const first = list[0]
    let missingStatTeams = 0
    let teamCount = 0
    for (const mu of list) {
      const tObj = asObj(asObj(mu['0'])['teams'])
      for (const te of indexed(tObj)) {
        teamCount++
        const arr = asObj(te)['team'] as any[]
        const statsArr = asObj(asObj(arr[1])['team_stats'])['stats']
        const present = Array.isArray(statsArr)
          ? statsArr.filter((e: any) => {
              const s = asObj(asObj(e)['stat'])
              return scoredIds.has(Number(s['stat_id'])) && String(s['value'] ?? '') !== ''
            }).length
          : 0
        if (present < scoredIds.size) missingStatTeams++
      }
    }
    weeks.push({
      week: w,
      start: String(first['week_start'] ?? ''),
      end: String(first['week_end'] ?? ''),
      days: daysBetween(String(first['week_start'] ?? ''), String(first['week_end'] ?? '')),
      matchups: list.length,
      playoff: list.filter((m: any) => String(m['is_playoffs'] ?? '0') === '1').length,
      consolation: list.filter((m: any) => String(m['is_consolation'] ?? '0') === '1').length,
      statuses: [...new Set(list.map((m: any) => String(m['status'] ?? '')))],
      hasStats: missingStatTeams === 0 && teamCount > 0,
      missingStatTeams,
    })
  }

  const regularSeasonWeeks = weeks.filter(w => w.playoff === 0).map(w => w.week)
  const playoffWeeks = weeks.filter(w => w.playoff > 0).map(w => w.week)

  // Regular-season weeks must be a full 6-matchup slate for all 12 teams.
  for (const w of weeks) {
    if (w.playoff === 0 && w.matchups !== settings.numTeams / 2) {
      problems.push(`week ${w.week}: ${w.matchups} matchups, expected ${settings.numTeams / 2}`)
    }
  }

  // --- champion: final standings rank 1, cross-checked against the bracket ---
  const byRank = [...standings].sort((a, b) => a.finalRank - b.finalRank)
  const bySeed = [...standings].sort(
    (a, b) => (a.playoffSeed ?? 99) - (b.playoffSeed ?? 99),
  )
  const champRow = isFinished ? byRank[0] ?? null : null
  const runnerRow = isFinished ? byRank[1] ?? null : null
  const lastRow = isFinished ? bySeed[bySeed.length - 1] ?? null : null

  if (isFinished && playoffWeeks.length > 0) {
    const finalWeek = Math.max(...playoffWeeks)
    const titleGames = (byWeek.get(finalWeek) ?? []).filter(
      (m: any) => String(m['is_playoffs'] ?? '0') === '1' && String(m['is_consolation'] ?? '0') !== '1',
    )
    const winners = titleGames.map((m: any) => String(m['winner_team_key'] ?? ''))
    if (champRow && !winners.includes(champRow.teamKey)) {
      problems.push(
        `champion mismatch: standings rank 1 is ${champRow.teamKey}, week ${finalWeek} championship-bracket winners are ${winners.join(', ')}`,
      )
    }
    if (titleGames.length !== 1) {
      problems.push(
        `week ${finalWeek} has ${titleGames.length} non-consolation games — the final cannot be identified by flag alone`,
      )
    }
  }

  summaries.push({
    season,
    leagueKey,
    name: String(meta['name'] ?? ''),
    numTeams: settings.numTeams,
    startWeek,
    endWeek,
    startDate: String(meta['start_date'] ?? ''),
    endDate: String(meta['end_date'] ?? ''),
    isFinished,
    playoffStartWeek: settings.playoffStartWeek,
    numPlayoffTeams: settings.numPlayoffTeams,
    numConsolationTeams: null,
    usesReseeding: false,
    scoredCategories: settings.categories.filter(c => !c.isDisplayOnly).map(c => `${c.abbr}${c.higherIsBetter ? '' : '↓'}`),
    displayOnlyCategories: settings.categories.filter(c => c.isDisplayOnly).map(c => c.abbr),
    categoryCount: scoredIds.size,
    weeks,
    regularSeasonWeeks,
    playoffWeeks,
    teams,
    standings,
    champion: champRow ? { teamKey: champRow.teamKey, name: champRow.name, manager: champRow.manager } : null,
    runnerUp: runnerRow ? { teamKey: runnerRow.teamKey, name: runnerRow.name, manager: runnerRow.manager } : null,
    lastPlace: lastRow ? { teamKey: lastRow.teamKey, name: lastRow.name, manager: lastRow.manager } : null,
    problems,
  })

  console.log(
    `${season} ${leagueKey} teams=${teams.length} weeks=${weeks.length} ` +
    `reg=${regularSeasonWeeks.length} po=${playoffWeeks.length} finished=${isFinished} ` +
    `problems=${problems.length}`,
  )
}

const outDir = path.join(ROOT, 'data', '.cache')
mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'trophy-recon.json'), JSON.stringify(summaries, null, 1))
console.log(`\nWrote ${summaries.length} season summaries to data/.cache/trophy-recon.json`)
