/**
 * Draft report: how each team's picks actually panned out over the season.
 *
 * Everything shown here is computed on the client from the draft shard —
 * picks joined to full-season MLB lines — by draftEval.ts. The shard carries
 * no grades or rankings of its own, so the methodology stays readable in one
 * place instead of being baked into the data.
 */
import { useMemo, useState } from 'react'
import DraftRoundChart from '../components/DraftRoundChart'
import type { DraftShard } from '../../src/domain/draft'
import type { LiveShard, Manifest } from '../../src/domain/matchups'
import {
  ROUND_BUCKETS,
  evaluateDraft,
  seasonLine,
  type PickValue,
  type TeamDraft,
} from '../lib/draftEval'
import { useHomeTeam } from '../lib/homeTeam'
import { managerName } from '../lib/managers'
import { useJson } from '../lib/useJson'

interface Props {
  league: Manifest['leagues'][number]
}

function signed(value: number, digits = 1): string {
  const text = value.toFixed(digits)
  // Avoid "-0.0", which reads as a real deficit.
  if (Number(text) === 0) return `0.${'0'.repeat(digits)}`
  return value > 0 ? `+${text}` : text
}

function surplusClass(value: number | null): string {
  if (value === null || Math.abs(value) < 0.05) return ''
  return value > 0 ? ' win' : ' loss'
}

/** One pick inside an expanded team, or inside its keeper block. */
function PickRow({ entry }: { entry: PickValue }) {
  const { pick } = entry
  return (
    <div className="dft-pick">
      <span className="dft-pick-slot">
        {pick.round}
        <span className="dft-pick-overall">·{pick.overall}</span>
      </span>
      <span className="dft-pick-who">
        <span className="dft-pick-name">
          {pick.name}
          <span className="dft-pick-pos">{pick.position}</span>
        </span>
        <span className="dft-pick-line">{seasonLine(pick)}</span>
      </span>
      <span className="st-num">{entry.var.toFixed(1)}</span>
      <span className={`st-num dft-surplus${surplusClass(entry.surplus)}`}>
        {entry.surplus === null ? '–' : signed(entry.surplus)}
      </span>
    </div>
  )
}

function TeamRow({
  draft,
  rank,
  name,
  manager,
  isHome,
  expanded,
  onToggle,
}: {
  draft: TeamDraft
  rank: number
  name: string
  manager: string
  isHome: boolean
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <button
        type="button"
        className={`dft-row${isHome ? ' home' : ''}`}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="st-rank">{rank}</span>
        <span className="dft-team">
          <span className="dft-manager">{manager}</span>
          <span className="dft-team-name">{name}</span>
        </span>
        <span className={`dft-grade grade-${draft.grade[0]!.toLowerCase()}`}>{draft.grade}</span>
        <span className="st-num">{draft.totalVar.toFixed(1)}</span>
        <span className="st-num dft-expected">{draft.totalExpected.toFixed(1)}</span>
        <span className={`st-num dft-surplus${surplusClass(draft.surplus)}`}>
          {signed(draft.surplus)}
        </span>
        <span className="st-num">{draft.picksUsed}</span>
      </button>

      {expanded && (
        <div className="dft-expansion">
          <div className="dft-buckets">
            {ROUND_BUCKETS.map((bucket, i) => (
              <span key={bucket.label} className="dft-bucket">
                <span className="dft-bucket-label">R{bucket.label}</span>
                <span className={`dft-bucket-value${surplusClass(draft.byBucket[i] ?? 0)}`}>
                  {signed(draft.byBucket[i] ?? 0)}
                </span>
              </span>
            ))}
          </div>

          {draft.best && draft.worst && (
            <p className="dft-extremes">
              Best <strong>{draft.best.pick.name}</strong> ({signed(draft.best.surplus ?? 0)})
              {' · '}
              Worst <strong>{draft.worst.pick.name}</strong> ({signed(draft.worst.surplus ?? 0)})
            </p>
          )}

          <div className="dft-picks head">
            <span className="dft-pick-slot">Rd</span>
            <span className="dft-pick-who">Pick</span>
            <span className="st-num">VAR</span>
            <span className="st-num">Surp</span>
          </div>
          {draft.picks.map(entry => (
            <PickRow key={entry.pick.overall} entry={entry} />
          ))}

          {draft.keepers.length > 0 && (
            <>
              <p className="dft-keeper-note">
                Keepers — slotted by Yahoo into the late rounds at no cost, so they carry
                no expected value and are left out of this team&rsquo;s totals.
              </p>
              {draft.keepers.map(entry => (
                <PickRow key={entry.pick.overall} entry={entry} />
              ))}
            </>
          )}
        </div>
      )}
    </>
  )
}

function Leaderboard({
  entries,
  managerOf,
}: {
  entries: PickValue[]
  managerOf: (teamKey: string) => string
}) {
  return (
    <div className="card">
      {entries.map(entry => (
        <div key={entry.pick.overall} className="dft-lead">
          <span className="dft-pick-slot">
            {entry.pick.round}
            <span className="dft-pick-overall">·{entry.pick.overall}</span>
          </span>
          <span className="dft-pick-who">
            <span className="dft-pick-name">
              {entry.pick.name}
              <span className="dft-pick-pos">{entry.pick.position}</span>
            </span>
            <span className="dft-pick-line">{seasonLine(entry.pick)}</span>
          </span>
          <span className="dft-lead-mgr">{managerOf(entry.pick.teamKey)}</span>
          <span className={`st-num dft-surplus${surplusClass(entry.surplus)}`}>
            {signed(entry.surplus ?? 0)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function Draft({ league }: Props) {
  const draft = useJson<DraftShard>(`data/${league.id}/draft/${league.season}.json`)
  const live = useJson<LiveShard>(`data/${league.id}/live.json`)
  const [homeKey] = useHomeTeam(league.id, live.data?.standings)
  const [expanded, setExpanded] = useState<string | null>(null)

  const evaluation = useMemo(
    () => (draft.data ? evaluateDraft(draft.data) : null),
    [draft.data],
  )

  const teams = useMemo(() => {
    const rows = live.data?.standings ?? []
    return new Map(rows.map(row => [row.teamKey, row]))
  }, [live.data])

  const managerOf = (teamKey: string) =>
    managerName(teams.get(teamKey)?.manager ?? '') || teamKey

  if (draft.error) {
    return (
      <div className="empty-state">
        <p className="empty-title">No draft report for {league.season}</p>
        <p className="empty-desc">{draft.error}</p>
      </div>
    )
  }
  if (!evaluation) {
    return <div className="view"><div className="card skeleton tall" aria-hidden /></div>
  }

  const keeperRounds = draft.data!.picks.filter(p => p.keeper).map(p => p.round)
  const keeperFromRound = keeperRounds.length > 0 ? Math.min(...keeperRounds) : null

  return (
    <div className="view">
      <section>
        <h2 className="section-title">Draft report</h2>
        <p className="section-desc">
          Every pick scored on the league&rsquo;s 12 categories against the other drafted
          players, then measured against what that slot returned league wide. Surplus is
          the difference — it sums to zero across the twelve teams, so one team&rsquo;s gain
          is another&rsquo;s. Tap a team for its picks.
        </p>
        <div className="card standings-card">
          <div className="dft-row head">
            <span className="st-rank">#</span>
            <span className="dft-team">Manager</span>
            <span className="dft-grade">Gr</span>
            <span className="st-num" title="Total value over replacement">VAR</span>
            <span className="st-num dft-expected" title="What these slots typically returned">Exp</span>
            <span className="st-num" title="VAR minus expected">Surp</span>
            <span className="st-num" title="Picks actually used — teams traded picks">Pk</span>
          </div>
          {evaluation.teams.map((team, i) => (
            <TeamRow
              key={team.teamKey}
              draft={team}
              rank={i + 1}
              name={teams.get(team.teamKey)?.name ?? team.teamKey}
              manager={managerOf(team.teamKey)}
              isHome={team.teamKey === homeKey}
              expanded={expanded === team.teamKey}
              onToggle={() => setExpanded(prev => (prev === team.teamKey ? null : team.teamKey))}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-title">What each round was worth</h2>
        <p className="section-desc">
          Fitted value over replacement by round. Where the line crosses zero is the point
          after which the average pick stopped beating a replacement-level player
          {keeperFromRound !== null && ' — the shaded rounds are where keepers were slotted'}.
        </p>
        <div className="card pad">
          <DraftRoundChart byRound={evaluation.byRound} keeperFromRound={keeperFromRound} />
        </div>
      </section>

      <section>
        <h2 className="section-title">Best picks</h2>
        <p className="section-desc">Biggest surplus league wide, keepers excluded.</p>
        <Leaderboard entries={evaluation.bestPicks} managerOf={managerOf} />
      </section>

      <section>
        <h2 className="section-title">Worst picks</h2>
        <p className="section-desc">Biggest shortfall against the slot.</p>
        <Leaderboard entries={evaluation.worstPicks} managerOf={managerOf} />
      </section>

      {draft.data!.unmatched.length > 0 && (
        <p className="dft-footnote">
          No major-league season on record, so scored as a zero:{' '}
          {draft.data!.unmatched.join(', ')}.
        </p>
      )}
    </div>
  )
}
