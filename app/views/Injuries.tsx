/**
 * Injury history: who sat on the IL, for how long, and what it cost each
 * roster — one stint per row, grouped by team in standings order, plus a
 * league-wide summary.
 *
 * A "stint" is a run of consecutive weeks a player spent in a team's IL
 * lineup slot, which is the week-scoped field Yahoo actually backdates (see
 * src/domain/rosters.ts). Everything numeric comes straight from the injuries
 * shard; the only client-side work is grouping, sorting, and the playoff flag.
 */
import { useMemo } from 'react'
import { seasonLine } from '../lib/draftEval'
import { useHomeTeam } from '../lib/homeTeam'
import {
  isPlayoffImpact,
  longestStints,
  playoffTeamKeys,
  summarize,
  teamInjuryTotals,
  weeksLabel,
  weeksLostLabel,
} from '../lib/injuries'
import { managerName } from '../lib/managers'
import { useJson } from '../lib/useJson'
import type { LiveShard, Manifest, StandingsRow } from '../../src/domain/matchups'
import type { InjuriesShard, InjuryStint } from '../../src/domain/rosters'

interface Props {
  league: Manifest['leagues'][number]
}

function StintRow({ stint, season, playoffImpact }: {
  stint: InjuryStint
  season: string
  playoffImpact: boolean
}) {
  const line = stint.seasonLine ? seasonLine(stint.seasonLine) : null
  return (
    <div className="inj-row">
      <div className="inj-row-top">
        <span className="inj-player">{stint.name}</span>
        {/* Only an open stint carries a status: it is the one week whose
            status was read while it still applied. */}
        {stint.status && <span className="inj-status">{stint.status}</span>}
        <span className="inj-weeks">
          {weeksLabel(stint)}
          <span className="inj-weeks-count"> ({weeksLostLabel(stint)})</span>
        </span>
      </div>
      <div className="inj-row-bottom">
        {/* Full-season production, not production while hurt — labelled so the
            row cannot be read as "this is what the injury cost". */}
        <span className="inj-line">
          {line ? <><span className="inj-line-label">{season}</span> {line}</> : 'no season line on record'}
        </span>
        {playoffImpact && <span className="badge inj-flag">Playoff weeks</span>}
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
  season,
  asOfWeek,
  playoffStartWeek,
  playoffTeams,
}: {
  row: StandingsRow
  stints: InjuryStint[]
  isHome: boolean
  season: string
  asOfWeek: number
  playoffStartWeek: number | null
  playoffTeams: Set<string>
}) {
  // Weeks this team carried, not the stint's full length — a stint shared
  // with another manager after a trade only counts here for their share.
  const weeks = stints.reduce(
    (sum, s) => sum + (s.teams.find(t => t.teamKey === row.teamKey)?.weeks ?? s.weeksLost),
    0,
  )
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
        <span className="inj-team-count">
          {stints.length} {stints.length === 1 ? 'stint' : 'stints'} · {weeks} wk
        </span>
      </div>
      {stints.length === 0
        ? <p className="inj-empty">No IL stints this season.</p>
        : stints.map(stint => (
          <StintRow
            key={`${stint.playerKey}-${stint.firstWeek}`}
            stint={stint}
            season={season}
            playoffImpact={isPlayoffImpact(stint, asOfWeek, playoffStartWeek, playoffTeams)}
          />
        ))}
    </div>
  )
}

export default function Injuries({ league }: Props) {
  const injuries = useJson<InjuriesShard>(`data/${league.id}/injuries/${league.season}.json`)
  const live = useJson<LiveShard>(`data/${league.id}/live.json`)
  const [homeKey] = useHomeTeam(league.id, live.data?.standings)

  const standings = live.data?.standings
  const playoffTeams = useMemo(
    () => playoffTeamKeys(standings ?? [], injuries.data?.numPlayoffTeams ?? null),
    [standings, injuries.data],
  )

  // A stint appears under every team that carried it, so a mid-injury trade
  // shows up on both rosters rather than only the one it started on.
  const stintsByTeam = useMemo(() => {
    const map = new Map<string, InjuryStint[]>()
    for (const stint of injuries.data?.stints ?? []) {
      const keys = stint.teams.length > 0 ? stint.teams.map(t => t.teamKey) : [stint.teamKey]
      for (const key of keys) {
        const list = map.get(key) ?? []
        list.push(stint)
        map.set(key, list)
      }
    }
    for (const list of map.values()) list.sort((a, b) => b.weeksLost - a.weeksLost || a.firstWeek - b.firstWeek)
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
  const { asOfWeek, stints, playoffStartWeek } = injuries.data
  const totals = teamInjuryTotals(stints, rows.map(r => r.teamKey))
  const summary = summarize(injuries.data, rows.map(r => r.teamKey))
  const nameOf = (teamKey: string) => rows.find(r => r.teamKey === teamKey)?.name ?? teamKey
  const leaders = longestStints(stints, 5)

  if (stints.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-title">No IL stints yet</p>
        <p className="empty-desc">
          Nobody has been placed in an IL slot through week {asOfWeek}.
        </p>
      </div>
    )
  }

  return (
    <div className="view">
      <section>
        <h2 className="section-title">League summary</h2>
        <p className="section-desc">
          Through week {asOfWeek} · {summary.stints} IL stints league-wide,
          {' '}{summary.ongoing} still open, {summary.weeksLost} roster-weeks lost.
        </p>
        <div className="tiles">
          <div className="tile">
            <span className="tile-big">{summary.stints}</span>
            <span className="tile-label">IL stints</span>
          </div>
          <div className="tile">
            <span className="tile-big">{summary.ongoing}</span>
            <span className="tile-label">Still out</span>
          </div>
          <div className="tile">
            <span className="tile-big">{summary.weeksLost}</span>
            <span className="tile-label">Weeks lost</span>
          </div>
        </div>

        <div className="card inj-summary-card">
          <p className="inj-summary-title">Weeks lost to the IL, by team</p>
          {totals.map(t => (
            <div key={t.teamKey} className="inj-summary-row">
              <span className="inj-summary-team">{nameOf(t.teamKey)}</span>
              <span className="inj-summary-detail">{t.stints} {t.stints === 1 ? 'stint' : 'stints'}</span>
              <span className="inj-summary-count">{t.weeksLost}</span>
            </div>
          ))}
        </div>

        {leaders.length > 0 && (
          <div className="card inj-summary-card">
            <p className="inj-summary-title">Longest stints, league-wide</p>
            {leaders.map(stint => (
              <div key={`${stint.playerKey}-${stint.firstWeek}`} className="inj-lead">
                <span className="inj-lead-name">{stint.name}</span>
                <span className="inj-lead-team">{nameOf(stint.teamKey)}</span>
                <span className="inj-lead-weeks">{weeksLostLabel(stint)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="section-title">By team</h2>
        <p className="section-desc">
          Standings order. A stint is a run of weeks in that team&rsquo;s IL slot;
          {playoffStartWeek !== null && <> &ldquo;Playoff weeks&rdquo; marks one running into week {playoffStartWeek} or later for a team in the field;</>}
          {' '}an injured player left in a bench slot never counts.
        </p>
        <div className="card-list">
          {rows.map(row => (
            <TeamCard
              key={row.teamKey}
              row={row}
              stints={stintsByTeam.get(row.teamKey) ?? []}
              isHome={row.teamKey === homeKey}
              season={league.season}
              asOfWeek={asOfWeek}
              playoffStartWeek={playoffStartWeek}
              playoffTeams={playoffTeams}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
