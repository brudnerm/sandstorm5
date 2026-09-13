/**
 * Yahoo `league/{key}/draftresults` → typed picks.
 *
 * Keeper detection reads Yahoo's own `type` annotation on each draft_result
 * ('keeper' | 'regular'), which is authoritative. KP's house rule slots
 * keepers into the late rounds, but the rounds are NOT a reliable test: in
 * 2026 keepers landed anywhere from round 14 to 21 while five genuine picks
 * sat in rounds 17-18, so a round-range rule would mislabel ten picks. The
 * per-team fallback below only runs for older seasons where Yahoo omits the
 * field entirely.
 */
import { asObj, indexed, num, type AnyObj } from './common.js'

export interface ParsedDraftPick {
  round: number
  overall: number
  teamKey: string
  playerKey: string
  /** Yahoo's own annotation, when present: 'keeper' | 'regular'. */
  type: string | null
}

/** KP requires exactly five keepers per team, at no draft cost. */
const KEEPERS_PER_TEAM = 5

export function parseDraftResults(raw: { fantasy_content: AnyObj }): ParsedDraftPick[] {
  const leagueArr = raw.fantasy_content['league']
  if (!Array.isArray(leagueArr)) throw new Error('draftresults: no league array')

  const results = asObj(asObj(leagueArr[1])['draft_results'])
  const picks: ParsedDraftPick[] = []
  for (const entry of indexed(results)) {
    const dr = asObj(asObj(entry)['draft_result'])
    const teamKey = String(dr['team_key'] ?? '')
    const playerKey = String(dr['player_key'] ?? '')
    // Yahoo emits a row for every slot; an undrafted slot has no player.
    if (!teamKey || !playerKey) continue
    picks.push({
      round: num(dr['round']) ?? 0,
      overall: num(dr['pick']) ?? 0,
      teamKey,
      playerKey,
      type: dr['type'] ? String(dr['type']) : null,
    })
  }
  return picks.sort((a, b) => a.overall - b.overall)
}

/**
 * Which picks are keepers. Trusts Yahoo's `type` whenever any pick carries
 * it; otherwise falls back to "the last five picks each team made", which is
 * how KP has slotted keepers since 2015.
 */
export function keeperOverallPicks(picks: ParsedDraftPick[]): Set<number> {
  const annotated = picks.some(p => p.type !== null)
  if (annotated) {
    return new Set(picks.filter(p => p.type === 'keeper').map(p => p.overall))
  }

  const byTeam = new Map<string, ParsedDraftPick[]>()
  for (const pick of picks) {
    const list = byTeam.get(pick.teamKey) ?? []
    list.push(pick)
    byTeam.set(pick.teamKey, list)
  }
  const keepers = new Set<number>()
  for (const teamPicks of byTeam.values()) {
    const sorted = [...teamPicks].sort((a, b) => a.overall - b.overall)
    for (const pick of sorted.slice(-KEEPERS_PER_TEAM)) keepers.add(pick.overall)
  }
  return keepers
}
