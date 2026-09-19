/**
 * All-time owner standings, and a page for each owner.
 *
 * The standings count every season whose regular season is over, which
 * includes the current one: its regular-season record is final long before
 * Yahoo marks the season finished. Honours are only counted once the season
 * itself has ended, so a title in progress is never awarded early.
 *
 * The matrix in the Rivalries wing is required to sum to exactly these
 * totals. `npx tsx src/trophy/matrix-check.ts` is what proves it.
 */
import { useMemo, useState } from 'react'
import {
  allTimeStandings, formatPct, headToHead, regularSeasonComplete, winPct,
  type AllTimeRow,
} from '../../../src/domain/ownerStats'
import { leaderboard, type TeamWeek } from '../../../src/domain/records'
import type { MatchupShard, SeasonsShard, WeeklyShard } from '../../../src/domain/trophy'
import OwnerChip from '../../components/trophy/OwnerChip'
import Plaque from '../../components/trophy/Plaque'
import RecordTable from '../../components/trophy/RecordTable'
import SectionHeader from '../../components/trophy/SectionHeader'
import { decodeWeekly, ownerLookup } from '../../lib/trophy'

interface Props {
  leagueId: string
  shard: SeasonsShard
  weekly: WeeklyShard | null
  matchups: MatchupShard | null
  ownerId: string | null
}

type SortKey = 'percentage' | 'seasonsPlayed' | 'wins' | 'playoffAppearances'
  | 'titles' | 'runnerUps' | 'lastPlaces' | 'averageFinish'

/** Lower is better for these, so the first click should sort ascending. */
const ASCENDING_FIRST = new Set<SortKey>(['averageFinish', 'lastPlaces'])

/**
 * A finish-by-season line. Twelve places top to bottom, one point per season,
 * with first place at the top so a good run reads as a high line.
 */
function FinishChart({ finishes, numTeams }: {
  finishes: Array<{ season: number; seed: number }>
  numTeams: number
}) {
  if (finishes.length === 0) return null
  const w = 100
  const h = 34
  const stepX = finishes.length > 1 ? w / (finishes.length - 1) : 0
  const y = (seed: number) => ((seed - 1) / Math.max(1, numTeams - 1)) * h
  const points = finishes.map((f, i) => `${i * stepX},${y(f.seed).toFixed(1)}`).join(' ')
  const summary = finishes.map(f => `${f.season}: ${f.seed}`).join(', ')

  return (
    <figure className="trophy-spark">
      <svg viewBox={`-2 -4 ${w + 4} ${h + 8}`} role="img" aria-label={`Finish by season. ${summary}`}>
        <line x1="0" y1={y(1)} x2={w} y2={y(1)} className="trophy-spark-rule" />
        <line x1="0" y1={y(numTeams)} x2={w} y2={y(numTeams)} className="trophy-spark-rule" />
        <polyline points={points} className="trophy-spark-line" />
        {finishes.map((f, i) => (
          <circle
            key={f.season}
            cx={i * stepX}
            cy={y(f.seed)}
            r={f.seed === 1 ? 2.4 : 1.6}
            className={`trophy-spark-dot${f.seed === 1 ? ' first' : f.seed === numTeams ? ' last' : ''}`}
          />
        ))}
      </svg>
      <figcaption>
        First place at the top, {numTeams}th at the bottom. {finishes[0]!.season} to {finishes[finishes.length - 1]!.season}.
      </figcaption>
    </figure>
  )
}

function OwnerPage({ leagueId, shard, weekly, matchups, row }: {
  leagueId: string
  shard: SeasonsShard
  weekly: WeeklyShard | null
  matchups: MatchupShard | null
  row: AllTimeRow
}) {
  const lookup = ownerLookup(shard)
  const name = lookup.name(row.ownerId)
  const counted = shard.seasons.filter(regularSeasonComplete)

  const bySeason = counted
    .map(season => {
      const standing = season.standings.find(r => r.ownerId === row.ownerId)
      if (!standing) return null
      return {
        season: season.season,
        seed: standing.seed,
        numTeams: season.numTeams,
        record: `${standing.wins}-${standing.losses}-${standing.ties}`,
        percentage: standing.percentage,
        teamName: standing.teamName,
        madePlayoffs: season.numPlayoffTeams !== null && standing.seed <= season.numPlayoffTeams,
        champion: season.isFinished && season.champion?.ownerId === row.ownerId,
        runnerUp: season.isFinished && season.runnerUp?.ownerId === row.ownerId,
        last: season.isFinished && season.lastPlace?.ownerId === row.ownerId,
        retroSlug: season.retroSlugs[row.ownerId],
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.season - a.season)

  // Best and worst weeks, in the two categories with the clearest signal.
  const statOrder = shard.seasons[0]?.categories.map(c => c.abbr) ?? []
  const ownerIndex = shard.owners.findIndex(o => o.id === row.ownerId)
  const weeks: TeamWeek[] = useMemo(
    () => (weekly ? decodeWeekly(weekly, statOrder).filter(w => w.ownerIndex === ownerIndex) : []),
    [weekly, statOrder.join(','), ownerIndex],
  )
  const weekRows = useMemo(() => {
    if (weeks.length === 0) return []
    const out: Array<{ label: string; abbr: string; value: number; season: number; week: number }> = []
    for (const abbr of ['R', 'HR', 'K']) {
      const cat = shard.seasons[0]?.categories.find(c => c.abbr === abbr)
      if (!cat) continue
      for (const end of ['best', 'worst'] as const) {
        const board = leaderboard(weeks, abbr, 'standard', cat.higherIsBetter, end, 1)
        const r = board.rows[0]
        if (r) out.push({
          label: end === 'best' ? 'Best' : 'Worst',
          abbr, value: r.value, season: r.teamWeek.season, week: r.teamWeek.week,
        })
      }
    }
    return out
  }, [weeks, shard])

  const rivals = useMemo(() => {
    if (!matchups) return []
    const m = headToHead(shard, matchups, 'regular')
    return m.ownerIds
      .filter(id => id !== row.ownerId)
      .map(id => ({ id, cell: m.get(row.ownerId, id) }))
      .filter((x): x is { id: string; cell: NonNullable<typeof x.cell> } => !!x.cell)
      .sort((a, b) => b.cell.percentage - a.cell.percentage)
  }, [shard, matchups, row.ownerId])

  return (
    <>
      <a className="trophy-back" href={`#/${leagueId}/trophy/owners`}>All owners</a>
      <SectionHeader
        as="h1"
        eyebrow={`${row.firstSeason}–${row.lastSeason}${row.active ? '' : ', no longer in the league'}`}
        title={name}
        note={`${row.seasonsPlayed} seasons, ${row.wins}-${row.losses}-${row.ties} in the regular season, ${formatPct(row.percentage)}.`}
      />

      <section>
        <SectionHeader eyebrow="Summary" title="The record" />
        <div className="trophy-owner-summary">
          <Plaque season="Honours" title={`${row.titles} ${row.titles === 1 ? 'title' : 'titles'}`}>
            <div className="trophy-line">
              <span className="trophy-line-label">Runner-up</span>
              <span className="trophy-line-value">{row.runnerUps}</span>
            </div>
            <div className="trophy-line">
              <span className="trophy-line-label">Playoffs</span>
              <span className="trophy-line-value">
                {row.playoffAppearances} of {row.seasonsPlayed} seasons
              </span>
            </div>
            <div className="trophy-line">
              <span className="trophy-line-label">Best finish</span>
              <span className="trophy-line-value">{row.bestFinish}</span>
            </div>
          </Plaque>
          <Plaque
            tone={row.lastPlaces > 0 ? 'shame' : 'praise'}
            season="Shame"
            title={row.lastPlaces === 0 ? 'Never last' : `${row.lastPlaces} last ${row.lastPlaces === 1 ? 'place' : 'places'}`}
          >
            <div className="trophy-line">
              <span className="trophy-line-label">Average finish</span>
              <span className="trophy-line-value">{row.averageFinish.toFixed(2)}</span>
            </div>
            <div className="trophy-line">
              <span className="trophy-line-label">Missed playoffs</span>
              <span className="trophy-line-value">
                {row.seasonsPlayed - row.playoffAppearances} of {row.seasonsPlayed} seasons
              </span>
            </div>
          </Plaque>
          <div className="trophy-plaque">
            <p className="trophy-plaque-season">Finish by season</p>
            <FinishChart
              finishes={bySeason.slice().reverse().map(s => ({ season: s.season, seed: s.seed }))}
              numTeams={bySeason[0]?.numTeams ?? 12}
            />
          </div>
        </div>
      </section>

      {weekRows.length > 0 && (
        <section>
          <SectionHeader eyebrow="Extremes" title="Best and worst weeks" />
          <RecordTable
            caption={`${name}'s biggest and smallest weeks`}
            columns={[
              { key: 'what', label: 'Week' },
              { key: 'value', label: 'Value', numeric: true },
              { key: 'when', label: 'When', wrap: true },
            ]}
            rows={weekRows.map(r => ({
              key: `${r.label}-${r.abbr}`,
              cells: [`${r.label} ${r.abbr}`, r.value, `${r.season} wk ${r.week}`],
            }))}
            note="Standard seven-day weeks only, consolation excluded, as in the Weekly Records wing."
          />
        </section>
      )}

      <section>
        <SectionHeader eyebrow="Archive" title="Season by season" />
        <RecordTable
          caption={`${name}, season by season`}
          columns={[
            { key: 'season', label: 'Season', numeric: true },
            { key: 'team', label: 'Team name', wrap: true },
            { key: 'finish', label: 'Finish', numeric: true },
            { key: 'record', label: 'Record', numeric: true },
            { key: 'pct', label: 'Pct', numeric: true },
            { key: 'outcome', label: 'Outcome', wrap: true },
          ]}
          rows={bySeason.map(s => ({
            key: String(s.season),
            leader: s.champion,
            cells: [
              s.retroSlug
                ? <a className="trophy-inline-link" href={`#/${leagueId}/retro/${s.retroSlug}`}>{s.season}</a>
                : s.season,
              s.teamName,
              `${s.seed} of ${s.numTeams}`,
              s.record,
              s.percentage,
              s.champion ? 'Champion'
                : s.runnerUp ? 'Runner-up'
                : s.last ? 'Last place'
                : s.madePlayoffs ? 'Made the playoffs'
                : 'Missed the playoffs',
            ],
          }))}
          note="Finish is the regular-season standing, which is what decides the playoff seeding and the following year's draft order."
        />
      </section>

      {rivals.length > 0 && (
        <section>
          <SectionHeader
            eyebrow="Head to head"
            title="Against everyone else"
            note="Regular season only. The Rivalries wing has the same records as a matrix, with the playoffs kept separate."
          />
          <RecordTable
            caption={`${name} against every other owner, regular season`}
            ranked
            columns={[
              { key: 'owner', label: 'Opponent' },
              { key: 'record', label: 'Record', numeric: true },
              { key: 'pct', label: 'Pct', numeric: true },
              { key: 'meetings', label: 'Meetings', numeric: true },
            ]}
            rows={rivals.map((r, i) => ({
              key: r.id,
              rank: i + 1,
              cells: [
                <OwnerChip name={lookup.name(r.id)} />,
                `${r.cell.wins}-${r.cell.losses}-${r.cell.ties}`,
                formatPct(r.cell.percentage),
                r.cell.meetings,
              ],
            }))}
          />
        </section>
      )}
    </>
  )
}

export default function Owners({ leagueId, shard, weekly, matchups, ownerId }: Props) {
  const lookup = ownerLookup(shard)
  const rows = useMemo(() => allTimeStandings(shard), [shard])
  const [sortKey, setSortKey] = useState<SortKey>('percentage')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')

  const selected = ownerId ? rows.find(r => r.ownerId === ownerId) : null
  if (ownerId) {
    if (!selected) {
      return (
        <>
          <a className="trophy-back" href={`#/${leagueId}/trophy/owners`}>All owners</a>
          <p className="trophy-pending">No owner by that name.</p>
        </>
      )
    }
    return <OwnerPage leagueId={leagueId} shard={shard} weekly={weekly} matchups={matchups} row={selected} />
  }

  const sorted = [...rows].sort((a, b) => {
    const x = a[sortKey]
    const y = b[sortKey]
    return direction === 'asc' ? x - y : y - x
  })
  const onSort = (key: string) => {
    const k = key as SortKey
    if (k === sortKey) setDirection(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setDirection(ASCENDING_FIRST.has(k) ? 'asc' : 'desc')
    }
  }

  const counted = shard.seasons.filter(regularSeasonComplete)
  const span = counted.length > 0
    ? `${Math.min(...counted.map(s => s.season))}–${Math.max(...counted.map(s => s.season))}`
    : ''

  return (
    <>
      <SectionHeader
        as="h1"
        eyebrow="Trophy Room"
        title="Owners"
        note={`Every manager who has played, ${span}. Records are regular season only. A season counts once its regular season is complete, so the current one is included; titles are only counted once the season has finished.`}
      />

      <section>
        <RecordTable
          caption="All-time standings"
          ranked
          sort={{ key: sortKey, direction, onSort }}
          columns={[
            { key: 'owner', label: 'Owner' },
            { key: 'seasonsPlayed', label: 'Seasons', numeric: true, sortable: true },
            { key: 'wins', label: 'Record', numeric: true, sortable: true, title: 'Regular-season category record' },
            { key: 'percentage', label: 'Pct', numeric: true, sortable: true },
            { key: 'playoffAppearances', label: 'Playoffs', numeric: true, sortable: true },
            { key: 'titles', label: 'Titles', numeric: true, sortable: true },
            { key: 'runnerUps', label: 'Runner-up', numeric: true, sortable: true },
            { key: 'lastPlaces', label: 'Last', numeric: true, sortable: true },
            { key: 'averageFinish', label: 'Avg finish', numeric: true, sortable: true },
          ]}
          rows={sorted.map((r, i) => ({
            key: r.ownerId,
            rank: i + 1,
            leader: sortKey === 'percentage' && direction === 'desc' && i === 0,
            cells: [
              <a className="trophy-owner-link" href={`#/${leagueId}/trophy/owners/${r.ownerId}`}>
                <OwnerChip name={lookup.name(r.ownerId)} teamName={r.active ? null : 'no longer in the league'} />
              </a>,
              r.seasonsPlayed,
              `${r.wins}-${r.losses}-${r.ties}`,
              formatPct(r.percentage),
              r.playoffAppearances,
              r.titles,
              r.runnerUps,
              r.lastPlaces,
              r.averageFinish.toFixed(2),
            ],
          }))}
          note="Percentage counts a tie as half a win, which is how Yahoo computes it and the only way the shortened 2020 season compares with a full one. Average finish is the mean regular-season position, so lower is better."
        />
      </section>
    </>
  )
}

export { winPct }
