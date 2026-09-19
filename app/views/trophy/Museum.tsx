/**
 * The curated wings: the Veto Museum, keeper longevity, and one-off plaques.
 *
 * Everything else in the Trophy Room is computed and traceable to a stored
 * row. These are not — they record things Yahoo never kept — so every entry
 * is marked as curated, carries how well attested it is, and says plainly
 * that it was entered by hand. Where an entry cites a statistic, the figure
 * is checked against the stored record at build time and the build fails if
 * it disagrees, so a hand-written plaque cannot carry a wrong number.
 */
import {
  visibleCurated, yearsKept,
  type CuratedBase, type CuratedShard, type KeeperEntry, type PlaqueEntry, type VetoEntry,
} from '../../../src/domain/curated'
import type { SeasonsShard } from '../../../src/domain/trophy'
import OwnerChip from '../../components/trophy/OwnerChip'
import Plaque from '../../components/trophy/Plaque'
import SectionHeader from '../../components/trophy/SectionHeader'
import { ownerLookup } from '../../lib/trophy'

interface Props {
  leagueId: string
  shard: SeasonsShard
  curated: CuratedShard | null
  /** Which section to show. Null shows all three. */
  section: string | null
  allowDrafts: boolean
}

type Tone = 'praise' | 'shame'

const SECTIONS: Array<{ slug: string; title: string; tone: Tone; note: string }> = [
  {
    slug: 'vetoes',
    title: 'The Veto Museum',
    tone: 'shame',
    note: 'Trades that were agreed and then stopped. Yahoo keeps no record of a rejected trade, so every entry here is hand-entered, and none of them quotes the league email.',
  },
  {
    slug: 'keepers',
    title: 'Keeper longevity',
    tone: 'praise',
    note: 'The longest-held keepers. Keepers can only be derived from the draft data from 2015 on, so anything earlier has to be recorded by hand; an entry covering a season the data does know about is cross-checked against it.',
  },
  {
    slug: 'plaques',
    title: 'Plaques',
    tone: 'praise',
    note: 'One-off honours. Where a plaque cites a statistic it carries a pointer to the team-week behind it, and the build refuses to publish if the number ever stops matching.',
  },
]

/**
 * The mark that separates a hand-entered entry from a computed one. It
 * appears on every curated entry without exception.
 */
function CuratedMark({ entry }: { entry: CuratedBase }) {
  return (
    <span className="trophy-curated-marks">
      <span className="trophy-tag curated">Curated</span>
      <span className={`trophy-tag source-${entry.source}`}>
        {entry.source === 'confirmed' ? 'Confirmed' : 'Reported'}
      </span>
      {entry.status === 'draft' && <span className="trophy-tag warn">Draft</span>}
    </span>
  )
}

function Empty({ what }: { what: string }) {
  return (
    <p className="trophy-pending">
      Nothing in {what} yet. Entries are added by hand and appear here once approved.
    </p>
  )
}

function VetoCard({ entry, lookup }: { entry: VetoEntry; lookup: ReturnType<typeof ownerLookup> }) {
  const names = entry.proposedBy.map(id => lookup.name(id))
  return (
    <Plaque
      tone="shame"
      season={String(entry.season)}
      title={names.join(' and ')}
      subtitle={
        entry.outcome === 'vetoed' ? 'Trade vetoed'
          : entry.outcome === 'withdrawn' ? 'Trade withdrawn'
          : 'Trade upheld'
      }
      footnote={
        <>
          <CuratedMark entry={entry} />
          {entry.sourceNote && <span className="trophy-curated-note">{entry.sourceNote}</span>}
        </>
      }
    >
      <div className="trophy-line">
        <span className="trophy-line-label">Players</span>
        <span className="trophy-line-value">
          {entry.players.map((p, i) => (
            <span key={`${p.name}-${i}`} className="trophy-veto-player">
              {p.name}, {lookup.name(p.from)} to {lookup.name(p.to)}
            </span>
          ))}
        </span>
      </div>
      <div className="trophy-line">
        <span className="trophy-line-label">Vote</span>
        <span className="trophy-line-value">
          {entry.vote
            ? `${entry.vote.against} against, ${entry.vote.inFavour} in favour, ${entry.vote.abstained} abstained`
            : 'No vote is recorded'}
        </span>
      </div>
      <p className="trophy-curated-body">{entry.description}</p>
    </Plaque>
  )
}

function KeeperCard({ entry, lookup }: { entry: KeeperEntry; lookup: ReturnType<typeof ownerLookup> }) {
  const years = yearsKept(entry)
  return (
    <Plaque
      season={`${entry.fromSeason}–${entry.toSeason}`}
      title={entry.playerName}
      subtitle={`${years} ${years === 1 ? 'season' : 'seasons'} with ${lookup.name(entry.ownerId)}`}
      footnote={
        <>
          <CuratedMark entry={entry} />
          {entry.sourceNote && <span className="trophy-curated-note">{entry.sourceNote}</span>}
        </>
      }
    >
      <div className="trophy-line">
        <span className="trophy-line-label">Owner</span>
        <span className="trophy-line-value"><OwnerChip name={lookup.name(entry.ownerId)} /></span>
      </div>
      {entry.description && <p className="trophy-curated-body">{entry.description}</p>}
    </Plaque>
  )
}

function PlaqueCard({ entry, lookup, leagueId }: {
  entry: PlaqueEntry
  lookup: ReturnType<typeof ownerLookup>
  leagueId: string
}) {
  return (
    <Plaque
      season={entry.week ? `${entry.season}, week ${entry.week}` : String(entry.season)}
      title={entry.title}
      subtitle={lookup.name(entry.ownerId)}
      footnote={
        <>
          <CuratedMark entry={entry} />
          {entry.evidence && (
            <span className="trophy-curated-note">
              Checked against the record: {entry.evidence.category} {entry.evidence.value} in{' '}
              {entry.evidence.season} week {entry.evidence.week}. The build fails if that stops
              being true.{' '}
              <a className="trophy-inline-link" href={`#/${leagueId}/trophy/records`}>
                Weekly records
              </a>
            </span>
          )}
          {!entry.evidence && entry.sourceNote && (
            <span className="trophy-curated-note">{entry.sourceNote}</span>
          )}
        </>
      }
    >
      <p className="trophy-curated-body">{entry.description}</p>
    </Plaque>
  )
}

export default function Museum({ leagueId, shard, curated, section, allowDrafts }: Props) {
  const lookup = ownerLookup(shard)

  if (!curated) {
    return (
      <>
        <SectionHeader as="h1" eyebrow="Trophy Room" title="The Museum" />
        <p className="trophy-pending">Loading the curated record…</p>
      </>
    )
  }

  const visible = visibleCurated(curated, allowDrafts)
  const only = SECTIONS.find(s => s.slug === section) ?? null
  const base = `#/${leagueId}/trophy/museum`
  const show = (slug: string) => !only || only.slug === slug
  const sectionHeader = (slug: string) => {
    const s = SECTIONS.find(x => x.slug === slug)!
    return { title: s.title, tone: s.tone, note: s.note }
  }

  return (
    <>
      <SectionHeader
        as="h1"
        eyebrow="Trophy Room"
        title={only ? only.title : 'The Museum'}
        tone={only?.tone ?? 'praise'}
        note={only
          ? only.note
          : 'Everything in here was entered by hand. The rest of the Trophy Room is computed from stored data and can be traced to a row; these record things the league remembers and Yahoo never kept. Each entry says whether it is confirmed or reported, and any figure an entry cites is checked against the record when the site is built.'}
      />

      {!only && (
        <nav className="trophy-jump" aria-label="Curated sections">
          {SECTIONS.map(s => (
            <a key={s.slug} className="trophy-jump-link" href={`${base}/${s.slug}`}>{s.title}</a>
          ))}
        </nav>
      )}
      {only && <a className="trophy-back" href={base}>The Museum</a>}

      {show('vetoes') && (
        <section>
          {!only && <SectionHeader eyebrow="Curated" {...sectionHeader('vetoes')} />}
          {visible.vetoes.length === 0
            ? <Empty what="the Veto Museum" />
            : (
              <div className="trophy-curated-grid">
                {visible.vetoes.map(v => <VetoCard key={v.id} entry={v} lookup={lookup} />)}
              </div>
            )}
        </section>
      )}

      {show('keepers') && (
        <section>
          {!only && <SectionHeader eyebrow="Curated" {...sectionHeader('keepers')} />}
          {visible.keepers.length === 0
            ? <Empty what="keeper longevity" />
            : (
              <div className="trophy-curated-grid">
                {visible.keepers.map(k => <KeeperCard key={k.id} entry={k} lookup={lookup} />)}
              </div>
            )}
        </section>
      )}

      {show('plaques') && (
        <section>
          {!only && <SectionHeader eyebrow="Curated" {...sectionHeader('plaques')} />}
          {visible.plaques.length === 0
            ? <Empty what="the plaques" />
            : (
              <div className="trophy-curated-grid">
                {visible.plaques.map(p => (
                  <PlaqueCard key={p.id} entry={p} lookup={lookup} leagueId={leagueId} />
                ))}
              </div>
            )}
        </section>
      )}
    </>
  )
}
