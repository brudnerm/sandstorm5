import { useEffect, useRef } from 'react'
import type { LiveShard, Manifest, SeasonMatchups } from '../../src/domain/matchups'
import type { LeagueSeasonSettings } from '../../src/domain/stats'
import MatchupCard from '../components/MatchupCard'
import { useJson } from '../lib/useJson'

interface Props {
  league: Manifest['leagues'][number]
  week: number | null
  onWeekChange: (week: number | null) => void
}

function SkeletonCards() {
  return (
    <div className="card-list" aria-hidden>
      {[0, 1, 2].map(i => <div key={i} className="card skeleton" />)}
    </div>
  )
}

export default function Scoreboard({ league, week, onWeekChange }: Props) {
  const live = useJson<LiveShard>(`data/${league.id}/live.json`)
  const settings = useJson<LeagueSeasonSettings>(`data/${league.id}/settings/${league.season}.json`)

  const currentWeek = live.data?.currentWeek ?? league.currentWeek
  const selectedWeek = week !== null && week >= 1 && week <= currentWeek ? week : currentWeek
  const isCurrent = selectedWeek === currentWeek

  // Past weeks come from the season shard; the current week rides in live.json.
  const season = useJson<SeasonMatchups>(isCurrent ? null : `data/${league.id}/matchups/${league.season}.json`)
  const matchups = isCurrent ? live.data?.scoreboard : season.data?.weeks[String(selectedWeek)]

  const chipsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    chipsRef.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [selectedWeek, live.data])

  const error = live.error ?? settings.error ?? (!isCurrent ? season.error : null)

  return (
    <div className="view">
      <div className="week-chips" ref={chipsRef} role="group" aria-label="Week">
        {Array.from({ length: currentWeek }, (_, i) => i + 1).map(w => (
          <button
            key={w}
            className={`chip${w === selectedWeek ? ' active' : ''}`}
            aria-pressed={w === selectedWeek}
            onClick={() => onWeekChange(w === currentWeek ? null : w)}
          >
            {w === currentWeek ? `Wk ${w} · Now` : `Wk ${w}`}
          </button>
        ))}
      </div>

      {error && (
        <div className="empty-state">
          <p className="empty-title">Couldn’t load this week</p>
          <p className="empty-desc">{error}</p>
        </div>
      )}

      {!error && (!matchups || !settings.data) && <SkeletonCards />}

      {!error && matchups && settings.data && (
        <div className="card-list">
          {matchups.map(m => (
            <MatchupCard
              key={`${m.week}-${m.teams[0].teamKey}`}
              matchup={m}
              categories={settings.data!.categories}
            />
          ))}
          {matchups.length === 0 && (
            <div className="empty-state">
              <p className="empty-title">No matchups</p>
              <p className="empty-desc">Nothing scheduled for week {selectedWeek}.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
