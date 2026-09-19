/**
 * The Hall of Shame: last place, season by season.
 *
 * Last place is read from the regular-season standings only. Playoff and
 * consolation results never decide it, which matters because the consolation
 * bracket regularly reorders the bottom of the table.
 *
 * The gap to eleventh is stated in the terms it is true in. A team can
 * out-win the team above it on categories and still finish below it once
 * ties are counted, and two teams can share a record entirely, so the line
 * says which of those happened rather than printing a misleading number.
 */
import type { SeasonsShard } from '../../../src/domain/trophy'
import type { CopyShard } from '../../../src/trophy/copy'
import type { DraftsShard } from '../../../src/trophy/drafts'
import OwnerChip from '../../components/trophy/OwnerChip'
import Plaque from '../../components/trophy/Plaque'
import RecordTable from '../../components/trophy/RecordTable'
import SectionHeader from '../../components/trophy/SectionHeader'
import {
  finishedSeasons,
  gapToPenultimate,
  lastPlaceCounts,
  ownerLookup,
  usableCopy,
  worstSeasonRecords,
} from '../../lib/trophy'

interface Props {
  shard: SeasonsShard
  drafts: DraftsShard | null
  copy: CopyShard | null
  allowDrafts: boolean
}

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']
const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`

export default function Shame({ shard, drafts, copy, allowDrafts }: Props) {
  const lookup = ownerLookup(shard)
  const finished = finishedSeasons(shard)
  const offenders = lastPlaceCounts(shard)
  const worst = worstSeasonRecords(shard, 10)
  const reverseFrom = drafts?.firstReverseOrderSeason ?? null

  return (
    <>
      <SectionHeader
        as="h1"
        eyebrow="Trophy Room"
        title="Hall of Shame"
        tone="shame"
        note="Last place is decided by the regular-season standings alone. The consolation bracket reshuffles the bottom of the table every year and none of it counts here."
      />

      <section>
        <SectionHeader eyebrow="The count" title="Repeat offenders" tone="shame" />
        <RecordTable
          tone="shame"
          caption="Last place by owner"
          ranked
          columns={[
            { key: 'owner', label: 'Owner' },
            { key: 'n', label: 'Finishes', numeric: true },
            { key: 'seasons', label: 'Seasons', wrap: true },
          ]}
          rows={offenders.map((o, i) => ({
            key: o.ownerId,
            rank: i + 1,
            leader: o.finishes === offenders[0]?.finishes,
            cells: [
              <OwnerChip name={lookup.name(o.ownerId)} />,
              o.finishes,
              o.seasons.join(', '),
            ],
          }))}
          note="Owners who have never finished last are not listed."
        />
      </section>

      <section>
        <SectionHeader
          eyebrow="Extremes"
          title="Worst regular seasons on record"
          tone="shame"
          note="Ranked on winning percentage rather than raw category wins, so the shortened 2020 season sits on the same scale as a full one."
        />
        <RecordTable
          tone="shame"
          caption="Worst regular-season records, all time"
          ranked
          columns={[
            { key: 'owner', label: 'Owner' },
            { key: 'season', label: 'Season', numeric: true },
            { key: 'record', label: 'Record', numeric: true },
            { key: 'pct', label: 'Pct', numeric: true },
            { key: 'seed', label: 'Finish', numeric: true },
          ]}
          rows={worst.map((r, i) => ({
            key: `${r.season}-${r.ownerId}`,
            rank: i + 1,
            leader: i === 0,
            cells: [
              <OwnerChip name={lookup.name(r.ownerId)} teamName={r.teamName} stacked />,
              r.season,
              `${r.wins}-${r.losses}-${r.ties}`,
              r.percentage,
              ordinal(r.seed),
            ],
          }))}
        />
      </section>

      <section>
        <SectionHeader
          eyebrow="Season by season"
          title="Last place"
          tone="shame"
          note={
            reverseFrom
              ? `The first pick is shown from ${reverseFrom}, the first season the draft order followed reverse standings. Before that the first pick did not go to last place, so it is not claimed.`
              : undefined
          }
        />
        <div className="trophy-plaques">
          {finished.map(season => {
            if (!season.lastPlace) return null
            const row = season.standings[season.standings.length - 1]
            const gap = gapToPenultimate(season)
            const blurb = usableCopy(copy, `shame-${season.season}`, allowDrafts)
            const nextDraft = drafts?.seasons.find(d => d.season === season.season + 1)
            const reward =
              nextDraft?.firstPick && nextDraft.firstPickWentToLastPlace === true
                ? nextDraft
                : null

            return (
              <Plaque
                key={season.season}
                tone="shame"
                season={String(season.season)}
                title={lookup.name(season.lastPlace.ownerId)}
                subtitle={season.lastPlace.teamName}
                footnote={
                  blurb ? (
                    <span className={blurb.isDraft ? 'trophy-draft' : undefined}>
                      {blurb.isDraft && <span className="trophy-draft-tag">Draft copy</span>}
                      {blurb.text}
                    </span>
                  ) : undefined
                }
              >
                <div className="trophy-line">
                  <span className="trophy-line-label">Record</span>
                  <span className="trophy-line-value">
                    {row ? `${row.wins}-${row.losses}-${row.ties}, ${row.percentage}` : 'data unavailable'}
                  </span>
                </div>
                <div className="trophy-line">
                  <span className="trophy-line-label">Gap to {ordinal(gap?.place ?? 11)}</span>
                  <span className="trophy-line-value">
                    {!gap
                      ? 'data unavailable'
                      : gap.levelOnRecord
                        ? 'Level on record, below in the standings'
                        : gap.wins > 0
                          ? `${gap.wins} category ${gap.wins === 1 ? 'win' : 'wins'}`
                          : gap.wins === 0
                            ? 'Level on category wins, behind on ties'
                            : `${-gap.wins} category ${-gap.wins === 1 ? 'win' : 'wins'} ahead, behind on ties`}
                  </span>
                </div>
                <div className="trophy-line">
                  <span className="trophy-line-label">First pick</span>
                  <span className="trophy-line-value">
                    {reward?.firstPick
                      ? `${reward.firstPick.playerName.replace(/\s*\((?:Batter|Pitcher)\)$/, '')}, first overall in ${reward.season}`
                      : nextDraft
                        ? 'The draft did not run in reverse standings order this year'
                        : 'Data unavailable'}
                  </span>
                </div>
              </Plaque>
            )
          })}
        </div>
      </section>
    </>
  )
}
