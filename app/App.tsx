import { useEffect } from 'react'
import type { Manifest } from '../src/domain/matchups'
import { timeAgo } from './lib/format'
import { useRoute, type View } from './lib/router'
import { useJson } from './lib/useJson'
import Home from './views/Home'
import Scoreboard from './views/Scoreboard'
import Standings from './views/Standings'
import Strategy from './views/Strategy'

function ThemeToggle() {
  const toggle = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    localStorage.setItem('ss5-theme', next)
  }
  return (
    <button className="icon-btn" onClick={toggle} aria-label="Toggle dark mode">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle className="theme-sun" cx="12" cy="12" r="4" />
        <g className="theme-rays">
          <line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" />
          <line x1="4.2" y1="4.2" x2="5.6" y2="5.6" /><line x1="18.4" y1="18.4" x2="19.8" y2="19.8" />
          <line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" />
          <line x1="4.2" y1="19.8" x2="5.6" y2="18.4" /><line x1="18.4" y1="5.6" x2="19.8" y2="4.2" />
        </g>
      </svg>
    </button>
  )
}

const TABS: Array<{ id: View; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'scoreboard', label: 'Scoreboard' },
  { id: 'standings', label: 'Standings' },
  { id: 'strategy', label: 'Strategy' },
]

export default function App() {
  const manifest = useJson<Manifest>('data/manifest.json')
  const [route, navigate] = useRoute()

  const leagues = manifest.data?.leagues ?? []
  const league = leagues.find(l => l.id === route.league) ?? null

  // Normalize bad or missing league in the URL once the manifest is known.
  useEffect(() => {
    if (leagues.length > 0 && !league) {
      navigate({ league: leagues[0]!.id, view: route.view, week: null }, true)
    }
  }, [leagues, league, route.view, navigate])

  return (
    <div className={`app${route.view === 'home' ? ' wide' : ''}`}>
      <header className="header">
        <div className="header-row">
          <span className="wordmark">Sandstorm</span>
          {leagues.length > 0 && (
            <select
              className="league-select"
              aria-label="League"
              value={league?.id ?? ''}
              onChange={e => navigate({ league: e.target.value, view: route.view, week: null })}
            >
              {leagues.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )}
          <span className="spacer" />
          <ThemeToggle />
        </div>
        <nav className="tabs" role="tablist" aria-label="Views">
          {TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={route.view === tab.id}
              className={`tab${route.view === tab.id ? ' active' : ''}`}
              onClick={() => league && navigate({ league: league.id, view: tab.id, week: null })}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="content">
        {manifest.error && (
          <div className="empty-state">
            <p className="empty-title">Couldn’t load league data</p>
            <p className="empty-desc">{manifest.error}</p>
          </div>
        )}
        {league && route.view === 'home' && (
          <Home
            key={league.id}
            league={league}
            week={route.week}
            onWeekChange={week => navigate({ league: league.id, view: 'home', week })}
          />
        )}
        {league && route.view === 'strategy' && <Strategy key={league.id} league={league} />}
        {league && route.view === 'scoreboard' && (
          <Scoreboard
            key={league.id}
            league={league}
            week={route.week}
            onWeekChange={week => navigate({ league: league.id, view: 'scoreboard', week })}
          />
        )}
        {league && route.view === 'standings' && <Standings key={league.id} league={league} />}
      </main>

      {manifest.data && (
        <footer className="footer">
          Updated {timeAgo(manifest.data.generatedAt)}
        </footer>
      )}
    </div>
  )
}
