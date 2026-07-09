/**
 * Tiny hash router: #/{leagueId}/{view}[/{week}]
 * Hash routing keeps URLs shareable on GitHub Pages with zero server config.
 */
import { useCallback, useSyncExternalStore } from 'react'

export type View = 'scoreboard' | 'standings'

export interface Route {
  league: string | null
  view: View
  week: number | null
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const league = parts[0] ?? null
  const view: View = parts[1] === 'standings' ? 'standings' : 'scoreboard'
  const week = parts[2] ? Number.parseInt(parts[2], 10) : null
  return { league, view, week: Number.isNaN(week) ? null : week }
}

export function routeToHash(route: Route): string {
  if (!route.league) return '#/'
  const parts = [route.league, route.view]
  if (route.view === 'scoreboard' && route.week !== null) parts.push(String(route.week))
  return '#/' + parts.join('/')
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): [Route, (route: Route, replace?: boolean) => void] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  const navigate = useCallback((route: Route, replace = false) => {
    const next = routeToHash(route)
    if (replace) {
      window.location.replace(next)
    } else if (window.location.hash !== next) {
      window.location.hash = next
    }
  }, [])
  return [parseHash(hash), navigate]
}
