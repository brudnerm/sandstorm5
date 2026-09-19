/**
 * Weekly records: the best and worst single team-weeks in each category.
 *
 * Three controls sit above the tables, and each exists because a raw
 * leaderboard would mislead without it:
 *
 *   - **Weeks.** A fourteen-day All-Star week and a five-day opening week are
 *     not comparable with a normal one, so standard weeks are the default.
 *     All weeks tags the odd ones with their length; per day divides by it.
 *   - **Category.** The sort direction comes from the category definition, so
 *     the best earned-run average is the lowest and its worst list is the
 *     highest values.
 *   - **Qualifiers.** A rate over a handful of innings is a small sample, not
 *     a record. The bar is stated under every table it applies to.
 */
import { useMemo, useState } from 'react'
import {
  QUALIFIERS, isRate, leaderboard, qualifierLabel,
  type Mode, type RecordRow, type TeamWeek,
} from '../../../src/domain/records'
import type { SeasonsShard, TrophyCategory, WeeklyShard } from '../../../src/domain/trophy'
import OwnerChip from '../../components/trophy/OwnerChip'
import RecordTable from '../../components/trophy/RecordTable'
import SectionHeader from '../../components/trophy/SectionHeader'
import { decodeWeekly, ownerLookup, type OwnerLookup } from '../../lib/trophy'

interface Props {
  shard: SeasonsShard
  weekly: WeeklyShard | null
}

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'standard', label: 'Standard weeks', hint: 'Seven-day weeks only. Opening weeks and the All-Star break are excluded.' },
  { id: 'all', label: 'All weeks', hint: 'Every week, with the long and short ones tagged by their length.' },
  { id: 'perDay', label: 'Per day', hint: 'Counting categories divided by the number of days in the week.' },
]

/** Rates carry two or three decimals; counting stats are whole numbers. */
function formatValue(abbr: string, value: number, mode: Mode): string {
  if (abbr === 'AVG' || abbr === 'OBP' || abbr === 'SLG') return value.toFixed(3).replace(/^0/, '')
  if (abbr === 'ERA' || abbr === 'WHIP') return value.toFixed(2)
  return mode === 'perDay' ? value.toFixed(2) : String(value)
}

function Board({
  title, board, abbr, mode, lookup, seasonsCovered, allSeasons,
}: {
  title: string
  board: ReturnType<typeof leaderboard>
  abbr: string
  mode: Mode
  lookup: OwnerLookup
  seasonsCovered: number[]
  allSeasons: number[]
}) {
  const qualifier = qualifierLabel(abbr)
  const partial =
    seasonsCovered.length > 0 &&
    (seasonsCovered[0] !== allSeasons[0] || seasonsCovered[seasonsCovered.length - 1] !== allSeasons[allSeasons.length - 1])

  const notes: string[] = []
  if (partial) {
    notes.push(`${seasonsCovered[0]}–${seasonsCovered[seasonsCovered.length - 1]} only.`)
  }
  if (qualifier) notes.push(`${qualifier}. ${board.pool.toLocaleString()} team-weeks qualify.`)
  else notes.push(`${board.pool.toLocaleString()} team-weeks in the pool.`)
  if (board.assumed.length > 0) {
    const lastAssumed = board.assumed[board.assumed.length - 1]!
    notes.push(
      `Yahoo records no at-bat count before ${lastAssumed + 1}, so the ` +
      `${board.assumed.length} seasons up to ${lastAssumed} are taken as having met it. ` +
      `Where the count does exist, one full week in 980 falls short.`,
    )
  }
  if (board.tiedAtCut > 0) {
    notes.push(`${board.tiedAtCut} team-weeks share the value at the cut, so this is one slice of a larger tie. Ties are ordered oldest first.`)
  }

  const cell = (r: RecordRow) => {
    const tw = r.teamWeek
    return [
      <OwnerChip
        name={lookup.name(lookup.byIndex(tw.ownerIndex))}
        teamName={lookup.teamName(lookup.byIndex(tw.ownerIndex), tw.season)}
        stacked
      />,
      <span className="trophy-record-value">{formatValue(abbr, r.value, mode)}</span>,
      <>
        {tw.season} wk {tw.week}
        {mode === 'all' && tw.days !== 7 && (
          <span className="trophy-tag" title={`${tw.days}-day week`}>{tw.days}d</span>
        )}
        {tw.completedGames === 0 && (
          <span className="trophy-tag warn" title="This team started nobody; no games were completed">
            0 games
          </span>
        )}
        {tw.bracket !== 'regular' && (
          <span className="trophy-tag" title={`${tw.bracket} bracket`}>{tw.bracket}</span>
        )}
      </>,
    ]
  }

  return (
    <RecordTable
      caption={title}
      ranked
      columns={[
        { key: 'owner', label: 'Owner' },
        { key: 'value', label: abbr, numeric: true },
        { key: 'when', label: 'When', wrap: true },
      ]}
      rows={board.rows.map(r => ({
        key: `${r.teamWeek.season}-${r.teamWeek.week}-${r.teamWeek.ownerIndex}`,
        rank: r.rank,
        // Marking the record is pointless when every visible row shares it,
        // which happens in the categories where hundreds tie on zero.
        leader: r.rank === 1 && !board.rows.every(x => x.rank === 1),
        cells: cell(r),
      }))}
      empty="No team-weeks qualify"
      note={notes.join(' ')}
    />
  )
}

export default function Records({ shard, weekly }: Props) {
  const lookup = useMemo(() => ownerLookup(shard), [shard])

  const categories: TrophyCategory[] = shard.seasons[0]?.categories ?? []
  const [abbr, setAbbr] = useState(categories[1]?.abbr ?? 'HR')
  const [mode, setMode] = useState<Mode>('standard')
  const [expanded, setExpanded] = useState(false)

  const statOrder = categories.map(c => c.abbr)
  const weeks: TeamWeek[] = useMemo(
    () => (weekly ? decodeWeekly(weekly, statOrder) : []),
    [weekly, statOrder.join(',')],
  )

  const category = categories.find(c => c.abbr === abbr) ?? categories[0]
  const rateSelected = isRate(abbr)
  // Per day is meaningless for a rate, so the control refuses it rather than
  // producing a number nobody could interpret.
  const effectiveMode: Mode = mode === 'perDay' && rateSelected ? 'standard' : mode
  const limit = expanded ? 25 : 5

  const best = useMemo(
    () => leaderboard(weeks, abbr, effectiveMode, category?.higherIsBetter ?? true, 'best', limit),
    [weeks, abbr, effectiveMode, category, limit],
  )
  const worst = useMemo(
    () => leaderboard(weeks, abbr, effectiveMode, category?.higherIsBetter ?? true, 'worst', limit),
    [weeks, abbr, effectiveMode, category, limit],
  )

  const allSeasons = shard.seasons.map(s => s.season).sort((a, b) => a - b)

  if (!weekly) {
    return (
      <>
        <SectionHeader as="h1" eyebrow="Trophy Room" title="Weekly Records" />
        <p className="trophy-pending">Loading the week-by-week record…</p>
      </>
    )
  }

  return (
    <>
      <SectionHeader
        as="h1"
        eyebrow="Trophy Room"
        title="Weekly Records"
        note="The best and worst single team-weeks in every category. Regular-season, championship and placement weeks all count; consolation weeks are excluded entirely."
      />

      <section>
        <div className="trophy-controls">
          <div className="trophy-control">
            <span className="trophy-control-label" id="cat-label">Category</span>
            <div className="trophy-chips" role="tablist" aria-labelledby="cat-label">
              {categories.map(c => (
                <button
                  key={c.abbr}
                  role="tab"
                  aria-selected={c.abbr === abbr}
                  className={`trophy-chip${c.abbr === abbr ? ' active' : ''}`}
                  onClick={() => setAbbr(c.abbr)}
                  title={`${c.name}, ${c.higherIsBetter ? 'higher is better' : 'lower is better'}`}
                >
                  {c.abbr}
                  {!c.higherIsBetter && <span className="trophy-chip-dir" aria-hidden="true">{'↓'}</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="trophy-control">
            <span className="trophy-control-label" id="mode-label">Weeks</span>
            <div className="trophy-segmented" role="group" aria-labelledby="mode-label">
              {MODES.map(m => {
                const disabled = m.id === 'perDay' && rateSelected
                return (
                  <button
                    key={m.id}
                    className={`trophy-segment${effectiveMode === m.id ? ' active' : ''}`}
                    aria-pressed={effectiveMode === m.id}
                    disabled={disabled}
                    title={disabled
                      ? `${abbr} is already a rate, so dividing it by days would not mean anything`
                      : m.hint}
                    onClick={() => setMode(m.id)}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <p className="trophy-section-note">
          {rateSelected && mode === 'perDay'
            ? `${abbr} is already a rate, so per day is unavailable for it. Showing standard weeks.`
            : MODES.find(m => m.id === effectiveMode)?.hint}
          {category && ` For ${category.name}, ${category.higherIsBetter ? 'higher is better' : 'lower is better'}, so the worst list is the ${category.higherIsBetter ? 'lowest' : 'highest'} values.`}
        </p>
      </section>

      <section>
        <div className="trophy-boards">
          <Board
            title={`Best ${abbr} ${expanded ? '(top 25)' : '(top 5)'}`}
            board={best} abbr={abbr} mode={effectiveMode} lookup={lookup}
            seasonsCovered={best.seasons} allSeasons={allSeasons}
          />
          <Board
            title={`Worst ${abbr} ${expanded ? '(bottom 25)' : '(bottom 5)'}`}
            board={worst} abbr={abbr} mode={effectiveMode} lookup={lookup}
            seasonsCovered={worst.seasons} allSeasons={allSeasons}
          />
        </div>
        <button className="trophy-expander" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
          {expanded ? 'Show top 5' : 'Show top 25'}
        </button>
      </section>

      <section>
        <SectionHeader eyebrow="Method" title="How these are counted" />
        <ul className="trophy-method">
          <li>
            Consolation weeks never count. Championship and placement weeks do, so a
            record set in the playoffs stands alongside one set in May.
          </li>
          <li>
            Sort direction comes from each season's category definition rather than
            from the abbreviation, which is why earned-run average and walks plus hits
            per inning pitched rank the other way round.
          </li>
          <li>
            {Object.entries(QUALIFIERS).map(([k, q]) =>
              `${k} needs ${q.minIp ?? q.minAb} ${q.minIp ? 'innings' : 'at-bats'}`).join('; ')}.
            The thresholds and the evidence for them are in the Stage 4 qualifier note.
          </li>
          <li>
            Yahoo records no at-bat count before 2023. Rather than lose fourteen
            seasons of batting records to a missing column, those seasons are taken
            as having met the minimum: where the count does exist, only one full week
            in 980 falls short of it, and every leading week is a normal one. A week
            in which a team started nobody never qualifies for a rate.
          </li>
          <li>
            Tied team-weeks share a rank and are ordered oldest first, so the same
            list comes back every time. Where the cut falls inside a tie, the table
            says how many share the value.
          </li>
        </ul>
      </section>
    </>
  )
}
