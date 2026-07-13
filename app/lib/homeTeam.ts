/**
 * The "home team" is the lens for the Home and Strategy views: every
 * comparison is computed from its perspective. Persisted per league.
 */
import { useCallback, useState } from 'react'
import type { StandingsRow } from '../../src/domain/matchups'

const DEFAULT_MANAGER = 'angel escobar'

function storageKey(leagueId: string): string {
  return `ss5-home-team:${leagueId}`
}

export function defaultHomeTeam(standings: StandingsRow[]): string | null {
  const mine = standings.find(r => r.manager.toLowerCase() === DEFAULT_MANAGER)
  return (mine ?? standings[0])?.teamKey ?? null
}

export function useHomeTeam(
  leagueId: string,
  standings: StandingsRow[] | undefined,
): [string | null, (teamKey: string) => void] {
  const [stored, setStored] = useState<string | null>(
    () => localStorage.getItem(storageKey(leagueId)),
  )

  const setHomeTeam = useCallback((teamKey: string) => {
    localStorage.setItem(storageKey(leagueId), teamKey)
    setStored(teamKey)
  }, [leagueId])

  // A stored key must still exist in the league (team keys change season
  // to season); otherwise fall back to the default manager's team.
  const valid = stored && standings?.some(r => r.teamKey === stored)
  const teamKey = valid ? stored : standings ? defaultHomeTeam(standings) : null
  return [teamKey, setHomeTeam]
}
