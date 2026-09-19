/**
 * The style sample: every Trophy Room component, in both treatments, on one
 * page. It exists so the visual language can be approved before any real
 * section is built on top of it.
 *
 * The content is illustrative but the numbers are not invented — they are
 * read from the shards like everywhere else, because a sample built on
 * made-up figures would not show how real ones sit.
 */
import type { SeasonsShard } from '../../../src/domain/trophy'
import OwnerChip from '../../components/trophy/OwnerChip'
import Plaque from '../../components/trophy/Plaque'
import RecordTable from '../../components/trophy/RecordTable'
import SectionHeader from '../../components/trophy/SectionHeader'
import { finishedSeasons, ownerLookup } from '../../lib/trophy'

export default function StyleSample({ shard }: { shard: SeasonsShard }) {
  const lookup = ownerLookup(shard)
  const finished = finishedSeasons(shard)
  const latest = finished[0]!
  const oldest = finished[finished.length - 1]!

  const titles = new Map<string, number>()
  for (const season of finished) {
    if (!season.champion) continue
    titles.set(season.champion.ownerId, (titles.get(season.champion.ownerId) ?? 0) + 1)
  }
  const titleRows = [...titles.entries()]
    .sort((a, b) => b[1] - a[1] || lookup.name(a[0]).localeCompare(lookup.name(b[0])))
    .slice(0, 6)

  const lastPlaces = new Map<string, number[]>()
  for (const season of finished) {
    if (!season.lastPlace) continue
    lastPlaces.set(season.lastPlace.ownerId, [
      ...(lastPlaces.get(season.lastPlace.ownerId) ?? []),
      season.season,
    ])
  }
  const shameRows = [...lastPlaces.entries()]
    .sort((a, b) => b[1].length - a[1].length || b[1][0]! - a[1][0]!)
    .slice(0, 6)

  const championRecord = (seasonYear: number): string => {
    const season = shard.seasons.find(s => s.season === seasonYear)
    const row = season?.standings.find(r => r.ownerId === season.champion?.ownerId)
    return row ? `${row.wins}-${row.losses}-${row.ties}` : 'data unavailable'
  }
  /** Category wins between last place and the team immediately above. */
  const gapToEleventh = (seasonYear: number): string => {
    const season = shard.seasons.find(s => s.season === seasonYear)
    if (!season) return 'data unavailable'
    const rows = season.standings
    const last = rows[rows.length - 1]
    const above = rows[rows.length - 2]
    if (!last || !above) return 'data unavailable'
    return `${above.wins - last.wins} category wins`
  }
  const lastRecord = (seasonYear: number): string => {
    const season = shard.seasons.find(s => s.season === seasonYear)
    const row = season?.standings[season.standings.length - 1]
    return row ? `${row.wins}-${row.losses}-${row.ties}` : 'data unavailable'
  }

  return (
    <>
      <SectionHeader
        as="h1"
        eyebrow="Style sample"
        title="Components"
        note="Every Trophy Room component in both treatments. Praise is brass on warm stock; shame is tarnished and colder. Tables stay plain in both, because density beats atmosphere once there are numbers on the page."
      />

      <section>
        <SectionHeader eyebrow="Component" title="Plaque" />
        <p className="trophy-sample-note">
          The unit of record. Identical structure in both treatments, so a title and a
          last-place finish are laid out the same way and only the metal changes.
        </p>
        <div className="trophy-sample-grid">
          <Plaque
            season={String(latest.season)}
            title={lookup.name(latest.champion!.ownerId)}
            subtitle={latest.champion!.teamName}
            footnote={`Regular season ${championRecord(latest.season)}. Won the championship final in week ${Math.max(...latest.playoffWeeks)}.`}
          >
            <div className="trophy-line">
              <span className="trophy-line-label">Runner-up</span>
              <span className="trophy-line-value">
                <OwnerChip
                  name={lookup.name(latest.runnerUp!.ownerId)}
                  teamName={latest.runnerUp!.teamName}
                />
              </span>
            </div>
            <div className="trophy-line">
              <span className="trophy-line-label">Seed</span>
              <span className="trophy-line-value">
                {latest.standings.findIndex(r => r.ownerId === latest.champion!.ownerId) + 1} of {latest.numTeams}
              </span>
            </div>
          </Plaque>
          <Plaque
            tone="shame"
            season={String(latest.season)}
            title={lookup.name(latest.lastPlace!.ownerId)}
            subtitle={latest.lastPlace!.teamName}
            footnote={`Regular season ${lastRecord(latest.season)}. Last of ${latest.numTeams} on regular-season standings, which is what decides the following year's first pick.`}
          >
            <div className="trophy-line">
              <span className="trophy-line-label">Gap to 11th</span>
              <span className="trophy-line-value">{gapToEleventh(latest.season)}</span>
            </div>
            <div className="trophy-line">
              <span className="trophy-line-label">Reward</span>
              <span className="trophy-line-value">First pick of the {latest.season + 1} draft</span>
            </div>
          </Plaque>
        </div>
      </section>

      <section>
        <SectionHeader eyebrow="Component" title="Record table" />
        <p className="trophy-sample-note">
          Hairlines, tabular numerals, no fill except on the record-holding row. The
          first column of each row is a row header, so a screen reader reads the owner
          before the numbers.
        </p>
        <div className="trophy-sample-grid">
          <RecordTable
            caption="Titles by owner"
            ranked
            columns={[
              { key: 'owner', label: 'Owner' },
              { key: 'titles', label: 'Titles', numeric: true },
              { key: 'last', label: 'Most recent', numeric: true },
            ]}
            rows={titleRows.map(([ownerId, count], i) => ({
              key: ownerId,
              rank: i + 1,
              leader: i === 0,
              cells: [
                <OwnerChip name={lookup.name(ownerId)} />,
                count,
                Math.max(...finished.filter(s => s.champion?.ownerId === ownerId).map(s => s.season)),
              ],
            }))}
            note={`Championship-bracket finals only, ${oldest.season} to ${latest.season}. Consolation results are never counted.`}
          />
          <RecordTable
            tone="shame"
            caption="Last place by owner"
            ranked
            columns={[
              { key: 'owner', label: 'Owner' },
              { key: 'n', label: 'Finishes', numeric: true },
              { key: 'seasons', label: 'Seasons', wrap: true },
            ]}
            rows={shameRows.map(([ownerId, years], i) => ({
              key: ownerId,
              rank: i + 1,
              leader: i === 0,
              cells: [
                <OwnerChip name={lookup.name(ownerId)} />,
                years.length,
                years.slice().sort((a, b) => a - b).join(', '),
              ],
            }))}
            note="Regular-season standings only. Playoff and consolation results never count toward last place."
          />
        </div>
      </section>

      <section>
        <SectionHeader eyebrow="Component" title="Owner chip" />
        <p className="trophy-sample-note">
          The owner is the subject and the team name is context, never the other way
          round. Stacked for narrow table cells.
        </p>
        <div className="trophy-sample-grid">
          <Plaque title="Inline" season="Both treatments">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {latest.standings.slice(0, 4).map(row => (
                <OwnerChip key={row.ownerId} name={lookup.name(row.ownerId)} teamName={row.teamName} />
              ))}
            </div>
          </Plaque>
          <Plaque title="Stacked" season="For table cells" tone="shame">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {latest.standings.slice(-4).map(row => (
                <OwnerChip key={row.ownerId} name={lookup.name(row.ownerId)} teamName={row.teamName} stacked />
              ))}
            </div>
          </Plaque>
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Component"
          title="Section header"
          note="This is a section header with a note. The note carries whatever bounds the numbers below it: a qualifier, a season span, a gap in the data."
        />
        <SectionHeader
          tone="shame"
          eyebrow="Shame treatment"
          title="Section header"
          note="The same component, tarnished."
        />
      </section>

      <section>
        <SectionHeader eyebrow="Component" title="Unavailable data" />
        <p className="trophy-sample-note">
          Where a season or week has no data, the Trophy Room says so. It never
          interpolates and never shows a zero it did not measure.
        </p>
        <RecordTable
          caption="A table with nothing to show"
          columns={[{ key: 'a', label: 'Owner' }, { key: 'b', label: 'Value', numeric: true }]}
          rows={[]}
          empty="Data unavailable for this season"
        />
      </section>
    </>
  )
}
