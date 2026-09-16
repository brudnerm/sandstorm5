/**
 * Injury history: who got hurt, when, and what it cost — one IL stint per
 * row, grouped by team in standings order, plus a league-wide summary.
 *
 * Everything here comes straight from the injuries shard (derived in the
 * pipeline from weekly roster snapshots); the only client-side computation
 * is grouping/sorting and the playoff-impact flag, which reads the season's
 * matchups shard for which weeks were actually tagged as playoffs rather
 * than hard-coding a week range.
 */
import { useMemo } from 'react'
import { seasonLine } from '../lib/draftEval'
import { useHomeTeam } from '../lib/homeTeam'
import {
  isPlayoffImpact,
  mostWeeksLost,
  playoffWeeksFrom,
  stintCountsByTeam,
  weeksLabel,
  weeksLost,
} from '../lib/injuries'
import { managerName } from '../lib/managers'
import { useJson } from '../lib/useJson'
import type { LiveShard, Manifest, SeasonMatchups, StandingsRow } from '../../src/domain/matchups'
import type { InjuriesShard, InjuryStint } from '../../src/domain/rosters'

interface Props {
  league: Manifest['leagues'][number]
}

const PLAYOFF_SEEDS = 6

function StintRow({ stint, asOfWeek, playoffImpact }: {
  stint: InjuryStint
  asOfWeek: number
  playoffImpact: boolean
}) {
  const line = stint.seasonLine ? seasonLine(stint.seasonLine) : null
  return (
    <div className="inj-row">
      <div className="inj-row-top">
        <span className="inj-player">{stint.name}</span>
        <span className="inj-status">{stint.status}</span>
        <span className="inj-weeks">
          {weeksLabel(stint)}
          <span className="inj-weeks-count">
            {' '}({weeksLost(stint, asOfWeek)}{stint.lastWeek === null ? '+' : ''} wk)
          </span>
        </span>
      </div>
      <div className="inj-row-bottom">
        <span className="inj-line">{line ?? 'no MLB line on record'}</span>
        {playoffImpact && <span className="badge inj-flag">Playoff impact</span>}
        {stint.dropped && <span className="inj-note">dropped</span>}
        {stint.traded && <span className="inj-note">traded</span>}
      </div>
    </div>
  )
}

function TeamCard({
  row,
  stints,
  isHome,
  asOfWeek,
  playoffWeeks,
  playoffTeamKeys,
}: {
  row: StandingsRow
  stints: InjuryStint[]
  isHome: boolean
  asOfWeek: number
  playoffWeeks: Set<number>
  playoffTeamKeys: Set<string>
}) {
  return (
    <div className="card inj-team-card">
      <div className={`inj-team-head${isHome ? ' home' : ''}`}>
        {row.logoUrl
          ? <img className="team-logo small" src={row.logoUrl} alt="" loading="lazy" decoding="async" />
          : <span className="team-logo small placeholder" />}
        <span className="team-names">
          <span className="team-name">{row.name}</span>
          <span className="team-manager">{managerName(row.manager)}</span>
        </span>
        <span className="inj-team-count">{stints.length} IL {stints.length === 1 ? 'stint' : 'stints'}</span>
      </div>
      {stints.length === 0
        ? <p className="inj-empty">No IL stints this season.</p>
        : stints.map(stint => (
          <StintRow
            key={`${stint.playerKey}-${stint.firstWeek}`}
            stint={stint}
            asOfWeek={asOfWeek}
            playoffImpact={isPlayoffImpact(stint, asOfWeek, playoffWeeks, playoffTeamKeys)}
          />
        ))}
    </div>
  )
}

export default function Injuries({ league }: Props) {
  const injuries = useJson<InjuriesShard>(`data/${league.id}/injuries/${league.season}.json`)
  const live = useJson<LiveShard>(`data/${league.id}/live.json`)
  const season = useJson<SeasonMatchups>(`data/${league.id}/matchups/${league.season}.json`)
  const [homeKey] = useHomeTeam(league.id, live.data?.standings)

  const playoffWeeks = useMemo(
    () => (season.data ? playoffWeeksFrom(season.data.weeks) : new Set<number>()),
    [season.data],
  )
  const playoffTeamKeys = useMemo(
    () => new Set(
      (live.data?.standings ?? [])
        .filter(r => r.playoffSeed !== null && r.playoffSeed <= PLAYOFF_SEEDS)
        .map(r => r.teamKey),
    ),
    [live.data],
  )

  const stintsByTeam = useMemo(() => {
    const map = new Map<string, InjuryStint[]>()
    for (const stint of injuries.data?.stints ?? []) {
      const list = map.get(stint.teamKey) ?? []
      list.push(stint)
      map.set(stint.teamKey, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.firstWeek - b.firstWeek)
    return map
  }, [injuries.data])

  if (injuries.error) {
    return (
      <div className="empty-state">
        <p className="empty-title">No injury history for {league.season}</p>
        <p className="empty-desc">{injuries.error}</p>
      </div>
    )
  }
  if (!injuries.data || !live.data) {
    return <div className="view"><div className="card skeleton tall" aria-hidden /></div>
  }

  const rows = live.data.standings
  const asOfWeek = injuries.data.asOfWeek
  const stints = injuries.data.stints
  const teamCounts = stintCountsByTeam(stints, rows.map(r => r.teamKey))
  const nameOf = (teamKey: string) => rows.find(r => r.teamKey === teamKey)?.name ?? teamKey
  const leaders = mostWeeksLost(stints, asOfWeek, 5)
  const ongoing = stints.filter(s => s.lastWeek === null).length

  return (
    <div className="view">
      <section>
        <h2 className="section-title">League summary</h2>
        <p className="section-desc">
          Through week {asOfWeek} · {stints.length} IL stints league-wide, {ongoing} still ongoing.
        </p>
        <div className="tiles">
          <div className="tile">
            <span className="tile-big">{stints.length}</span>
            <span className="tile-label">IL stints</span>
          </div>
          <div className="tile">
            <span className="tile-big">{ongoing}</span>
            <span className="tile-label">Still out</span>
          </div>
          <div className="tile">
            <span className="tile-big">{teamCounts.filter(t => t.count > 0).length}</span>
            <span className="tile-label">Teams hit</span>
          </div>
        </div>

        <div className="card inj-summary-card">
          <p className="inj-summary-title">IL stints by team</p>
          {teamCounts.map(t => (
            <div key={t.teamKey} className="inj-summary-row">
              <span className="inj-summary-team">{nameOf(t.teamKey)}</span>
              <span className="inj-summary-count">{t.count}</span>
            </div>
          ))}
        </div>

        {leaders.length > 0 && (
          <div className="card inj-summary-card">
            <p className="inj-summary-title">Most weeks lost, league-wide</p>
            {leaders.map(({ stint, weeksLost: lost }) => (
              <div key={`${stint.playerKey}-${stint.firstWeek}`} className="inj-lead">
                <span className="inj-lead-name">{stint.name}</span>
                <span className="inj-lead-team">{nameOf(stint.teamKey)}</span>
                <span className="inj-lead-weeks">{lost}{stint.lastWeek === null ? '+' : ''} wk</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="section-title">By team</h2>
        <p className="section-desc">
          Standings order. &ldquo;Playoff impact&rdquo; marks a stint overlapping a
          playoff week for a team that made the playoffs.
        </p>
        <div className="card-list">
          {rows.map(row => (
            <TeamCard
              key={row.teamKey}
              row={row}
              stints={stintsByTeam.get(row.teamKey) ?? []}
              isHome={row.teamKey === homeKey}
              asOfWeek={asOfWeek}
              playoffWeeks={playoffWeeks}
              playoffTeamKeys={playoffTeamKeys}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
