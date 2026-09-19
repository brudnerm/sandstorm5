/**
 * The head-to-head matrix: every owner against every other owner.
 *
 * Regular season and playoffs are separate tabs rather than one combined
 * number, because they are not the same thing: thirty-five regular-season
 * meetings and one playoff meeting would otherwise average into something
 * that describes neither.
 *
 * The colour scale carries the same information as the text in every cell, so
 * nothing here depends on seeing the colour. Cells are buttons: opening one
 * shows the full series underneath.
 */
import { useMemo, useState } from 'react'
import {
  formatPct, headToHead, mostLopsided,
  type BracketScope, type HeadToHead,
} from '../../../src/domain/ownerStats'
import type { MatchupShard, SeasonsShard } from '../../../src/domain/trophy'
import OwnerChip from '../../components/trophy/OwnerChip'
import Plaque from '../../components/trophy/Plaque'
import RecordTable from '../../components/trophy/RecordTable'
import SectionHeader from '../../components/trophy/SectionHeader'
import { ownerLookup } from '../../lib/trophy'

interface Props {
  leagueId: string
  shard: SeasonsShard
  matchups: MatchupShard | null
}

/**
 * How often a pair must have met before a margin means anything. A 12-0 from
 * a single playoff meeting is a result, not a rivalry, so the callout ignores
 * it and says so.
 */
const MINIMUM_MEETINGS: Record<BracketScope, number> = { regular: 15, playoffs: 4 }

const SCOPES: Array<{ id: BracketScope; label: string }> = [
  { id: 'regular', label: 'Regular season' },
  { id: 'playoffs', label: 'Playoffs' },
]

/** Five steps either side of even, so the scale reads without a legend. */
function heatClass(cell: HeadToHead | null): string {
  if (!cell || cell.meetings === 0) return 'none'
  const delta = cell.percentage - 0.5
  const step = Math.min(3, Math.ceil(Math.abs(delta) / 0.05))
  if (step === 0) return 'even'
  return `${delta > 0 ? 'up' : 'down'}${step}`
}

export default function Rivalries({ leagueId, shard, matchups }: Props) {
  const lookup = ownerLookup(shard)
  const [scope, setScope] = useState<BracketScope>('regular')
  const [open, setOpen] = useState<{ a: string; b: string } | null>(null)

  const matrix = useMemo(
    () => (matchups ? headToHead(shard, matchups, scope) : null),
    [shard, matchups, scope],
  )
  const lopsided = useMemo(
    () => (matrix ? mostLopsided(matrix, MINIMUM_MEETINGS[scope]) : null),
    [matrix, scope],
  )

  if (!matchups || !matrix) {
    return (
      <>
        <SectionHeader as="h1" eyebrow="Trophy Room" title="Rivalries" />
        <p className="trophy-pending">Loading the matchup record…</p>
      </>
    )
  }

  // Only owners who have actually played in this scope.
  const ids = matrix.ownerIds.filter(id =>
    matrix.ownerIds.some(other => other !== id && matrix.get(id, other)),
  )
  const openCell = open ? matrix.get(open.a, open.b) : null

  return (
    <>
      <SectionHeader
        as="h1"
        eyebrow="Trophy Room"
        title="Rivalries"
        note="Every owner against every other, all time, by category record. Read a row as that owner's record against each opponent."
      />

      <section>
        <div className="trophy-control">
          <span className="trophy-control-label" id="scope-label">Games</span>
          <div className="trophy-segmented" role="group" aria-labelledby="scope-label">
            {SCOPES.map(s => (
              <button
                key={s.id}
                className={`trophy-segment${scope === s.id ? ' active' : ''}`}
                aria-pressed={scope === s.id}
                onClick={() => { setScope(s.id); setOpen(null) }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <p className="trophy-section-note">
          {scope === 'regular'
            ? 'Regular-season meetings only. These totals sum to the all-time standings exactly.'
            : 'Every bracket game that is not consolation, so third- and fifth-place games count as meetings. Playoff samples are small: most pairs have met once or twice.'}
        </p>
      </section>

      {lopsided && (
        <section>
          <SectionHeader eyebrow="Callout" title="Most lopsided rivalry" />
          <Plaque
            season={scope === 'regular' ? 'Regular season' : 'Playoffs'}
            title={`${lookup.name(lopsided.a)} over ${lookup.name(lopsided.b)}`}
            subtitle={`${lopsided.record.wins}-${lopsided.record.losses}-${lopsided.record.ties} in ${lopsided.record.meetings} meetings, ${formatPct(lopsided.record.percentage)}`}
            footnote={`Among pairs who have met at least ${MINIMUM_MEETINGS[scope]} times. A one-sided result from two meetings is a result, not a rivalry, so it is left out of this callout — it still appears in the matrix.`}
          />
        </section>
      )}

      <section>
        <SectionHeader
          eyebrow="Matrix"
          title="Owner against owner"
          note="Each cell is that row's record against that column. Select a cell to see the full series."
        />
        <div className="trophy-matrix-wrap">
          <table className="trophy-matrix">
            <caption>
              Head-to-head category records, {scope === 'regular' ? 'regular season' : 'playoffs'}
            </caption>
            <thead>
              <tr>
                <th scope="col"><span className="trophy-visually-hidden">Owner</span></th>
                {ids.map(id => (
                  <th key={id} scope="col" title={lookup.name(id)}>{lookup.name(id)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ids.map(rowId => (
                <tr key={rowId}>
                  <th scope="row">
                    <a className="trophy-owner-link" href={`#/${leagueId}/trophy/owners/${rowId}`}>
                      {lookup.name(rowId)}
                    </a>
                  </th>
                  {ids.map(colId => {
                    if (rowId === colId) return <td key={colId} className="trophy-cell self" aria-hidden="true" />
                    const cell = matrix.get(rowId, colId)
                    if (!cell) {
                      return (
                        <td key={colId} className="trophy-cell none">
                          <span className="trophy-visually-hidden">
                            {lookup.name(rowId)} has never met {lookup.name(colId)}
                          </span>
                          <span aria-hidden="true">–</span>
                        </td>
                      )
                    }
                    const isOpen = open?.a === rowId && open?.b === colId
                    return (
                      <td key={colId} className={`trophy-cell ${heatClass(cell)}${isOpen ? ' open' : ''}`}>
                        <button
                          onClick={() => setOpen(isOpen ? null : { a: rowId, b: colId })}
                          aria-expanded={isOpen}
                        >
                          <span className="trophy-visually-hidden">
                            {lookup.name(rowId)} against {lookup.name(colId)}:{' '}
                          </span>
                          {cell.wins}-{cell.losses}-{cell.ties}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {open && openCell && (
        <section>
          <SectionHeader
            eyebrow="Series"
            title={`${lookup.name(open.a)} against ${lookup.name(open.b)}`}
            note={`${openCell.wins}-${openCell.losses}-${openCell.ties} across ${openCell.meetings} ${openCell.meetings === 1 ? 'meeting' : 'meetings'}, ${formatPct(openCell.percentage)}.`}
          />
          <RecordTable
            caption={`Every meeting, ${scope === 'regular' ? 'regular season' : 'playoffs'}`}
            columns={[
              { key: 'when', label: 'When' },
              { key: 'bracket', label: 'Bracket', wrap: true },
              { key: 'score', label: 'Score', numeric: true },
              { key: 'result', label: 'Result' },
            ]}
            rows={openCell.series.map(m => ({
              key: `${m.season}-${m.week}`,
              cells: [
                `${m.season} wk ${m.week}`,
                m.bracket,
                `${m.wins}-${m.losses}-${m.ties}`,
                m.wins > m.losses ? 'Won' : m.wins < m.losses ? 'Lost' : 'Level',
              ],
            }))}
            note={
              <>
                Score is from{' '}
                <OwnerChip name={lookup.name(open.a)} />
                {"'s point of view."}
              </>
            }
          />
        </section>
      )}
    </>
  )
}
