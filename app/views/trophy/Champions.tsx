/**
 * The Hall of Champions: every title since 2009, newest first.
 *
 * Each plaque carries the facts that make the title checkable — the seed it
 * came from, the regular-season record behind it, and the final that decided
 * it, category by category. A final that finished level on categories says
 * so rather than being dressed up as a win; three of them did.
 */
import type { MatchupShard, SeasonsShard } from '../../../src/domain/trophy'
import type { CopyShard } from '../../../src/trophy/copy'
import type { DraftsShard } from '../../../src/trophy/drafts'
import OwnerChip from '../../components/trophy/OwnerChip'
import Plaque from '../../components/trophy/Plaque'
import RecordTable from '../../components/trophy/RecordTable'
import SectionHeader from '../../components/trophy/SectionHeader'
import {
  championRecords,
  finalDetail,
  finishedSeasons,
  ownerLookup,
  titleCounts,
  usableCopy,
} from '../../lib/trophy'

interface Props {
  leagueId: string
  shard: SeasonsShard
  matchups: MatchupShard | null
  drafts: DraftsShard | null
  copy: CopyShard | null
  allowDrafts: boolean
}

/** "2025-09-15" to "2025-09-21" -> "15-21 September 2025". */
function weekDates(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`)
  const e = new Date(`${end}T00:00:00Z`)
  const month = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })
  const day = (d: Date) => d.getUTCDate()
  return month(s) === month(e)
    ? `${day(s)}-${day(e)} ${month(e)} ${e.getUTCFullYear()}`
    : `${day(s)} ${month(s)} - ${day(e)} ${month(e)} ${e.getUTCFullYear()}`
}

function CategoryStrip({
  categories,
}: { categories: Array<{ abbr: string; outcome: 'W' | 'L' | 'T' | '.' }> }) {
  return (
    <ul className="trophy-cats" aria-label="Category results in the final">
      {categories.map(c => (
        <li key={c.abbr} className={`trophy-cat ${c.outcome}`}>
          <span className="trophy-cat-abbr">{c.abbr}</span>
          <span className="trophy-cat-outcome">
            {c.outcome === 'W' ? 'won' : c.outcome === 'L' ? 'lost' : 'tied'}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function Champions({ leagueId, shard, matchups, drafts, copy, allowDrafts }: Props) {
  const lookup = ownerLookup(shard)
  const finished = finishedSeasons(shard)
  const counts = titleCounts(shard)
  const records = championRecords(shard)
  const firstKeeperSeason = drafts?.firstKeeperSeason ?? null

  return (
    <>
      <SectionHeader
        as="h1"
        eyebrow="Trophy Room"
        title="Hall of Champions"
        note={`Every title from ${finished[finished.length - 1]?.season} to ${finished[0]?.season}. The champion is the winner of the championship-bracket final; consolation results are never counted.`}
      />

      <section>
        <SectionHeader eyebrow="The count" title="Titles by owner" />
        <RecordTable
          caption="Titles by owner"
          ranked
          columns={[
            { key: 'owner', label: 'Owner' },
            { key: 'titles', label: 'Titles', numeric: true },
            { key: 'seasons', label: 'Seasons', wrap: true },
          ]}
          rows={counts.map((t, i) => ({
            key: t.ownerId,
            rank: i + 1,
            leader: t.titles === counts[0]?.titles,
            cells: [
              <OwnerChip name={lookup.name(t.ownerId)} />,
              t.titles,
              t.seasons.join(', '),
            ],
          }))}
          note="Owners with no title are not listed here. They appear in the all-time standings."
        />
      </section>

      {records.length > 0 && (
        <section>
          <SectionHeader eyebrow="Extremes" title="Championship records" />
          <RecordTable
            caption="Championship records"
            columns={[
              { key: 'label', label: 'Record', wrap: true },
              { key: 'who', label: 'Owner', wrap: true },
              { key: 'value', label: 'Value', numeric: true },
              { key: 'detail', label: 'Seasons', wrap: true },
            ]}
            rows={records.map(r => ({
              key: r.label,
              cells: [
                r.label,
                r.ownerIds.map(id => lookup.name(id)).join(', '),
                r.value,
                r.detail,
              ],
            }))}
          />
        </section>
      )}

      <section>
        <SectionHeader
          eyebrow="Season by season"
          title="The champions"
          note={
            firstKeeperSeason
              ? `Keepers are listed from ${firstKeeperSeason}, the first season the draft data shows players being carried over. Earlier seasons are not reported rather than guessed.`
              : undefined
          }
        />
        <div className="trophy-plaques">
          {finished.map(season => {
            if (!season.champion) return null
            const seedRow = season.standings.find(r => r.ownerId === season.champion!.ownerId)
            const final = matchups ? finalDetail(shard, matchups, season) : null
            const kept = drafts?.seasons
              .find(d => d.season === season.season)?.keepers
              .filter(k => k.ownerId === season.champion!.ownerId) ?? []
            const blurb = usableCopy(copy, `champion-${season.season}`, allowDrafts)
            const retroSlug = season.retroSlugs[season.champion.ownerId]

            return (
              <Plaque
                key={season.season}
                season={String(season.season)}
                title={lookup.name(season.champion.ownerId)}
                subtitle={season.champion.teamName}
                footnote={
                  <>
                    {blurb && (
                      <span className={blurb.isDraft ? 'trophy-draft' : undefined}>
                        {blurb.isDraft && <span className="trophy-draft-tag">Draft copy</span>}
                        {blurb.text}
                      </span>
                    )}
                    {retroSlug && (
                      <>
                        {blurb ? ' ' : null}
                        <a className="trophy-inline-link" href={`#/${leagueId}/retro/${retroSlug}`}>
                          Read the season review
                        </a>
                      </>
                    )}
                  </>
                }
              >
                <div className="trophy-line">
                  <span className="trophy-line-label">Regular season</span>
                  <span className="trophy-line-value">
                    {seedRow
                      ? `${seedRow.wins}-${seedRow.losses}-${seedRow.ties}, ${seedRow.seed} of ${season.numTeams}`
                      : 'data unavailable'}
                  </span>
                </div>

                {final ? (
                  <>
                    <div className="trophy-line">
                      <span className="trophy-line-label">Final</span>
                      <span className="trophy-line-value">
                        {final.w}-{final.l}-{final.t}
                        {final.w === final.l ? ' (level)' : ''} against{' '}
                        <OwnerChip
                          name={lookup.name(final.opponentId)}
                          teamName={final.opponentTeamName}
                        />
                      </span>
                    </div>
                    {final.week && (
                      <div className="trophy-line">
                        <span className="trophy-line-label">Week</span>
                        <span className="trophy-line-value">
                          Week {final.week.week}, {weekDates(final.week.start, final.week.end)}
                        </span>
                      </div>
                    )}
                    <CategoryStrip categories={final.categories} />
                  </>
                ) : (
                  <div className="trophy-line">
                    <span className="trophy-line-label">Final</span>
                    <span className="trophy-line-value">Data unavailable</span>
                  </div>
                )}

                {kept.length > 0 && (
                  <div className="trophy-line">
                    <span className="trophy-line-label">Keepers</span>
                    <span className="trophy-line-value">
                      {kept.map(k => k.playerName.replace(/\s*\((?:Batter|Pitcher)\)$/, '')).join(', ')}
                    </span>
                  </div>
                )}
              </Plaque>
            )
          })}
        </div>
      </section>
    </>
  )
}
