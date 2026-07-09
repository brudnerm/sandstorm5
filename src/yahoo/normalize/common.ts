/**
 * Shared helpers for Yahoo's response idioms: pseudo-arrays keyed by
 * numeric strings plus `count`, and team-info arrays of single-key objects.
 */

export type AnyObj = Record<string, unknown>

export function asObj(v: unknown): AnyObj {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as AnyObj
  return {}
}

export function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/** Iterate `{ count: N, "0": …, "1": … }` pseudo-arrays in index order. */
export function* indexed(obj: AnyObj): Generator<unknown> {
  const count = Number(obj['count'] ?? 0)
  for (let i = 0; i < count; i++) yield obj[String(i)]
}

/** Find the first entry in a team-info array carrying the given key. */
function infoEntry(info: unknown[], key: string): AnyObj | undefined {
  for (const item of info) {
    const obj = asObj(item)
    if (key in obj) return obj
  }
  return undefined
}

export interface TeamInfo {
  teamKey: string
  name: string
  manager: string
  managerGuid: string | null
  logoUrl: string | null
  waiverPriority: number | null
  faabBalance: number | null
  moves: number | null
  trades: number | null
}

/** Parse the positional info array at team[0]. */
export function parseTeamInfo(info: unknown[]): TeamInfo {
  const teamKey = String(infoEntry(info, 'team_key')?.['team_key'] ?? '')
  if (!teamKey) throw new Error('Team info array has no team_key')

  const managersArr = infoEntry(info, 'managers')?.['managers']
  const firstManager = asObj(asObj(Array.isArray(managersArr) ? managersArr[0] : undefined)['manager'])

  let logoUrl: string | null = null
  const logosArr = infoEntry(info, 'team_logos')?.['team_logos']
  if (Array.isArray(logosArr)) {
    const logo = asObj(asObj(logosArr[0])['team_logo'])
    logoUrl = logo['url'] ? String(logo['url']) : null
  }

  return {
    teamKey,
    name: String(infoEntry(info, 'name')?.['name'] ?? 'Unknown'),
    manager: String(firstManager['nickname'] ?? 'Unknown'),
    managerGuid: firstManager['guid'] ? String(firstManager['guid']) : null,
    logoUrl,
    waiverPriority: num(infoEntry(info, 'waiver_priority')?.['waiver_priority']),
    faabBalance: num(infoEntry(info, 'faab_balance')?.['faab_balance']),
    moves: num(infoEntry(info, 'number_of_moves')?.['number_of_moves']),
    trades: num(infoEntry(info, 'number_of_trades')?.['number_of_trades']),
  }
}
