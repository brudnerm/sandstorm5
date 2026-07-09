/**
 * The league registry — the ONE hand-maintained piece of league config.
 * Identity only: names, season → Yahoo league key, and feature flags.
 * Scoring rules are never written here; they are derived from the Yahoo
 * settings endpoint by the pipeline (see src/pipeline/fetch-settings.ts).
 *
 * To add a league: add an entry. To find keys for a new season, run:
 *   npm run discover-leagues
 */

export interface LeagueRegistryEntry {
  /** Stable slug used in URLs and data paths. Never changes. */
  id: string
  name: string
  /** season (year) → Yahoo league_key, e.g. '2026': '469.l.13624' */
  seasons: Record<string, string>
  features: {
    transactions: boolean
    draftHistory: boolean
    hallOfFame: boolean
    /**
     * League runs keepers. Not derivable from Yahoo settings — KP keeps
     * players as late-round draft picks, so Yahoo's uses_keeper is '0'.
     * Actual keeper picks are identified from draft results.
     */
    keepers: boolean
  }
}

export const LEAGUES: LeagueRegistryEntry[] = [
  {
    id: 'kp',
    name: 'Keeping Pattycakes',
    seasons: {
      '2009': '215.l.134803',
      '2010': '238.l.429668',
      '2011': '253.l.89167',
      '2012': '268.l.116014',
      '2013': '308.l.61021',
      '2014': '328.l.60208',
      '2015': '346.l.36240',
      '2016': '357.l.2951',
      '2017': '370.l.29314',
      '2018': '378.l.4717',
      '2019': '388.l.12105',
      '2020': '398.l.8122',
      '2021': '404.l.33954',
      '2022': '412.l.13714',
      '2023': '422.l.20451',
      '2024': '431.l.11978',
      '2025': '458.l.19784',
      '2026': '469.l.13624',
    },
    features: { transactions: true, draftHistory: true, hallOfFame: true, keepers: true },
  },
  {
    id: 'sidebar',
    name: 'sidebar',
    seasons: {
      '2012': '268.l.145820',
      '2013': '308.l.5575',
      '2014': '328.l.65274',
      '2015': '346.l.37992',
      '2016': '357.l.5925',
      '2017': '370.l.40810',
      '2018': '378.l.19632',
      '2019': '388.l.20459',
      '2020': '398.l.53123',
      '2021': '404.l.33830',
      '2022': '412.l.13188',
      '2023': '422.l.26755',
      '2024': '431.l.19527',
      '2025': '458.l.19841',
      '2026': '469.l.20795',
    },
    features: { transactions: true, draftHistory: true, hallOfFame: true, keepers: false },
  },
]

export function leagueById(id: string): LeagueRegistryEntry {
  const league = LEAGUES.find(l => l.id === id)
  if (!league) throw new Error(`Unknown league id: ${id}`)
  return league
}

export function currentSeason(league: LeagueRegistryEntry): string {
  return Object.keys(league.seasons).sort().at(-1)!
}
