/**
 * The Trophy Room: the league's permanent record book.
 *
 * One route per wing (#/kp/trophy/champions and so on) so a single section
 * can be linked straight from a league email, which is how most people will
 * arrive. Wings are anchors rather than buttons for the same reason — they
 * are real links, and they work with a keyboard and a long-press.
 *
 * Every figure on this page is computed from the trophy shards. Nothing is
 * written into copy by hand.
 */
import { useEffect } from 'react'
import type { Manifest } from '../../src/domain/matchups'
import SectionHeader from '../components/trophy/SectionHeader'
import {
  heroSummary, useTrophyCopy, useTrophyDrafts, useTrophyMatchups, useTrophySeasons,
  useTrophyTransactions, useTrophyWeekly, WINGS, wingBySlug, type HeroTile,
} from '../lib/trophy'
import Archive from './trophy/Archive'
import Champions from './trophy/Champions'
import Owners from './trophy/Owners'
import Records from './trophy/Records'
import Rivalries from './trophy/Rivalries'
import Shame from './trophy/Shame'
import StyleSample from './trophy/StyleSample'

interface Props {
  league: Manifest['leagues'][number]
  slug: string | null
  /** A fourth path segment, e.g. the owner on #/kp/trophy/owners/kc. */
  sub: string | null
}

function Tile({ tile }: { tile: HeroTile }) {
  return (
    <div className={`trophy-tile${tile.tone === 'shame' ? ' shame' : ''}`}>
      <span className="trophy-tile-label">{tile.label}</span>
      <span className="trophy-tile-name">{tile.names.join(' & ')}</span>
      <span className="trophy-tile-value">{tile.value}</span>
      <span className="trophy-tile-detail">{tile.detail}</span>
    </div>
  )
}

export default function Trophy({ league, slug, sub }: Props) {
  const shard = useTrophySeasons(league.id)
  // The wings that need them fetch their own shards; useJson only requests a
  // path when it is asked for, so the landing page still loads one file.
  const wantsMatchups =
    slug === 'champions' || slug === 'rivalries' || slug === 'owners' || slug === 'archive'
  const wantsDraftsAndCopy = slug === 'champions' || slug === 'shame'
  const matchups = useTrophyMatchups(wantsMatchups ? league.id : '')
  const weekly = useTrophyWeekly(slug === 'records' || slug === 'owners' ? league.id : '')
  // The heaviest shard, and only the archive needs it.
  const transactions = useTrophyTransactions(slug === 'archive' ? league.id : '')
  const drafts = useTrophyDrafts(wantsDraftsAndCopy ? league.id : '')
  const copy = useTrophyCopy(wantsDraftsAndCopy ? league.id : '')
  const data = shard.data
  const wing = wingBySlug(slug)
  // A build-time constant: on the deployed site this branch is gone, so
  // unapproved copy cannot render however the page is loaded.
  const allowDrafts = import.meta.env.DEV

  // The wings are long; arriving at one from an email should start at the top.
  useEffect(() => { window.scrollTo({ top: 0 }) }, [slug, sub])

  if (shard.error) {
    return (
      <div className="empty-state">
        <p className="empty-title">No record book yet</p>
        <p className="empty-desc">
          The Trophy Room data has not been published for this league.
        </p>
      </div>
    )
  }
  if (!data) {
    return <div className="empty-state"><p className="empty-desc">Loading…</p></div>
  }

  const base = `#/${league.id}/trophy`

  if (slug === 'style') {
    return (
      <div className="view trophy">
        <a className="trophy-back" href={base}>Trophy Room</a>
        <StyleSample shard={data} />
      </div>
    )
  }

  if (wing) {
    return (
      <div className="view trophy">
        <a className="trophy-back" href={base}>Trophy Room</a>
        {wing.slug === 'champions' ? (
          <Champions
            leagueId={league.id}
            shard={data}
            matchups={matchups.data}
            drafts={drafts.data}
            copy={copy.data}
            allowDrafts={allowDrafts}
          />
        ) : wing.slug === 'records' ? (
          <Records shard={data} weekly={weekly.data} />
        ) : wing.slug === 'owners' ? (
          <Owners
            leagueId={league.id}
            shard={data}
            weekly={weekly.data}
            matchups={matchups.data}
            ownerId={sub}
          />
        ) : wing.slug === 'rivalries' ? (
          <Rivalries leagueId={league.id} shard={data} matchups={matchups.data} />
        ) : wing.slug === 'archive' ? (
          <Archive
            leagueId={league.id}
            shard={data}
            matchups={matchups.data}
            transactions={transactions.data}
          />
        ) : wing.slug === 'shame' ? (
          <Shame
            shard={data}
            drafts={drafts.data}
            copy={copy.data}
            allowDrafts={allowDrafts}
          />
        ) : (
          <>
            <SectionHeader as="h1" eyebrow="Trophy Room" title={wing.title} note={wing.blurb} tone={wing.tone} />
            <p className="trophy-pending">This wing is not built yet.</p>
          </>
        )}
      </div>
    )
  }

  const tiles = heroSummary(data)
  const first = data.seasons[0]?.season
  const last = data.seasons[data.seasons.length - 1]?.season

  return (
    <div className="view trophy">
      <header className="trophy-masthead">
        <p className="trophy-eyebrow">Keeping Pattycakes</p>
        <h1 className="trophy-masthead-title">The Trophy Room</h1>
        <p className="trophy-masthead-sub">
          The permanent record, {first} to {last}. Every figure here is computed from
          stored league data and checked against Yahoo before it is published.
        </p>
      </header>

      {tiles.length > 0 && (
        <section aria-label="Summary">
          <div className="trophy-hero">
            {tiles.map(tile => <Tile key={tile.label} tile={tile} />)}
          </div>
        </section>
      )}

      <section>
        <SectionHeader eyebrow="Wings" title="The collection" />
        <nav className="trophy-wings" aria-label="Trophy Room wings">
          {WINGS.map(w => (
            <a
              key={w.slug}
              className={`trophy-wing${w.tone === 'shame' ? ' shame' : ''}`}
              href={`${base}/${w.slug}`}
            >
              <p className="trophy-eyebrow">{w.tone === 'shame' ? 'Shame' : 'Record'}</p>
              <h2 className="trophy-wing-title">{w.title}</h2>
              <p className="trophy-wing-blurb">{w.blurb}</p>
              <span className="trophy-wing-go">Enter</span>
            </a>
          ))}
        </nav>
      </section>

      <section>
        <SectionHeader
          eyebrow="Reference"
          title="Style sample"
          note="Every component in both treatments, for checking the look before a wing is built on it."
        />
        <nav className="trophy-wings" aria-label="Reference">
          <a className="trophy-wing" href={`${base}/style`}>
            <p className="trophy-eyebrow">Reference</p>
            <h2 className="trophy-wing-title">Components</h2>
            <p className="trophy-wing-blurb">Plaques, tables, chips and headers, praise and shame.</p>
            <span className="trophy-wing-go">Enter</span>
          </a>
        </nav>
      </section>
    </div>
  )
}
