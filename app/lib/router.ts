/**
 * Tiny hash router: #/{leagueId}/{view}[/{week|slug}]
 * Hash routing keeps URLs shareable on GitHub Pages with zero server config.
 */
import { useCallback, useSyncExternalStore } from 'react'

export type View =
  | 'home' | 'scoreboard' | 'standings' | 'strategy' | 'draft' | 'injuries' | 'retro' | 'trophy'

const VIEWS: View[] = ['home', 'scoreboard', 'standings', 'strategy', 'draft', 'injuries', 'retro', 'trophy']

/** Views whose third path segment is a name, not a week number. */
const SLUG_VIEWS: View[] = ['retro', 'trophy']

export interface Route {
  league: string | null
  view: View
  week: number | null
  /** Name segment for a slug view: a retro article, or a Trophy Room wing. */
  slug?: string | null
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const league = parts[0] ?? null
  const view = VIEWS.find(v => v === parts[1]) ?? 'home'
  if (SLUG_VIEWS.includes(view)) {
    return { league, view, week: null, slug: parts[2] ? decodeURIComponent(parts[2]) : null }
  }
  const week = parts[2] ? Number.parseInt(parts[2], 10) : null
  return { league, view, week: Number.isNaN(week) ? null : week, slug: null }
}

export function routeToHash(route: Route): string {
  if (!route.league) return '#/'
  const parts = [route.league, route.view]
  if (SLUG_VIEWS.includes(route.view)) {
    if (route.slug) parts.push(encodeURIComponent(route.slug))
  } else {
    const hasWeek = route.view === 'scoreboard' || route.view === 'home'
    if (hasWeek && route.week !== null) parts.push(String(route.week))
  }
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
