/**
 * Season retrospective: one article per team, published one at a time.
 * Content comes from data/{leagueId}/retro/{season}.json (hand-written
 * prose, not derived from Yahoo). The front page leads with the newest
 * review and lists the rest by headline; teams still awaiting a review
 * stay visible so the league can see who's left.
 */
import { useEffect } from 'react'
import type { Manifest } from '../../src/domain/matchups'
import { useJson } from '../lib/useJson'

interface Block {
  type: 'p' | 'h' | 'ul'
  text?: string
  items?: string[]
}
interface Article {
  slug: string
  rank: number
  teamName: string
  manager: string
  record: string
  publishedAt: string
  /** Optional so a half-edited shard still renders; falls back to the team name. */
  headline?: string
  leader?: string
  blocks: Block[]
}
interface TeamEntry {
  rank: number
  teamName: string
  manager: string
  record: string
  teamKey: string
  playoffs: boolean
  slug: string | null
}
interface RetroShard {
  leagueId: string
  season: number
  title: string
  intro: string
  teams: TeamEntry[]
  articles: Article[]
}

interface Props {
  league: Manifest['leagues'][number]
  slug: string | null
  onSelect: (slug: string | null) => void
}

const ORDINAL = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const headlineOf = (a: Article) => a.headline ?? a.teamName

/** Worst rank first, matching the publishing order. */
const byRankDesc = (a: { rank: number }, b: { rank: number }) => b.rank - a.rank

function StoryRow({ article, onSelect }: { article: Article; onSelect: (s: string) => void }) {
  return (
    <li className="retro-story">
      <button className="retro-story-btn" onClick={() => onSelect(article.slug)}>
        <span className="retro-dateline">
          <span className="retro-rank-tag">No. {article.rank}</span>
          {article.teamName} · {article.manager} · {article.record}
        </span>
        <span className="retro-story-headline">{headlineOf(article)}</span>
        {article.leader && <span className="retro-story-leader">{article.leader}</span>}
      </button>
    </li>
  )
}

function UpcomingRow({ team }: { team: TeamEntry }) {
  return (
    <li className="retro-upcoming">
      <span className="retro-upcoming-rank">{team.rank}</span>
      <span className="retro-upcoming-main">
        <span className="retro-upcoming-team">{team.teamName}</span>
        <span className="retro-upcoming-meta">{team.manager} · {team.record}</span>
      </span>
      <span className="retro-upcoming-status">Coming soon</span>
    </li>
  )
}

function ArticleBody({ article }: { article: Article }) {
  return (
    <article className="retro-article">
      <header className="retro-article-head">
        <p className="retro-eyebrow">No. {article.rank} · {ORDINAL(article.rank)} place</p>
        <h1 className="retro-headline">{headlineOf(article)}</h1>
        {article.leader && <p className="retro-leader">{article.leader}</p>}
        <p className="retro-byline">
          {article.teamName} · {article.manager} · {article.record}
          <span className="retro-byline-sep">Published {fmtDate(article.publishedAt)}</span>
        </p>
      </header>
      {article.blocks.map((b, i) => {
        if (b.type === 'h') return <h2 key={i} className="retro-h2">{b.text}</h2>
        if (b.type === 'ul') return (
          <ul key={i} className="retro-ul">
            {b.items!.map((it, j) => <li key={j}>{it}</li>)}
          </ul>
        )
        return <p key={i} className="retro-p">{b.text}</p>
      })}
    </article>
  )
}

export default function Retro({ league, slug, onSelect }: Props) {
  const shard = useJson<RetroShard>(`data/${league.id}/retro/${league.season}.json`)
  const data = shard.data
  const article = data?.articles.find(a => a.slug === slug) ?? null

  // Scroll to top when switching articles; the page is long.
  useEffect(() => { window.scrollTo({ top: 0 }) }, [slug])

  if (shard.error || (data && data.articles.length === 0)) {
    return (
      <div className="empty-state">
        <p className="empty-title">No season review yet</p>
        <p className="empty-desc">Reviews are published after the regular season ends.</p>
      </div>
    )
  }
  if (!data) return <div className="empty-state"><p className="empty-desc">Loading…</p></div>

  if (article) {
    const published = data.articles.slice().sort(byRankDesc)
    const idx = published.findIndex(a => a.slug === article.slug)
    const prev = published[idx - 1] ?? null
    const next = published[idx + 1] ?? null
    return (
      <div className="view retro">
        <button className="retro-back" onClick={() => onSelect(null)}>All reviews</button>
        <ArticleBody article={article} />
        <nav className="retro-pager" aria-label="More reviews">
          {prev ? (
            <button className="retro-pager-btn" onClick={() => onSelect(prev.slug)}>
              <span className="retro-pager-label">Previous</span>
              <span className="retro-pager-headline">{headlineOf(prev)}</span>
            </button>
          ) : <span />}
          {next ? (
            <button className="retro-pager-btn right" onClick={() => onSelect(next.slug)}>
              <span className="retro-pager-label">Next</span>
              <span className="retro-pager-headline">{headlineOf(next)}</span>
            </button>
          ) : (
            <span className="retro-pager-btn right muted">
              <span className="retro-pager-label">Next</span>
              <span className="retro-pager-headline">Not published yet</span>
            </span>
          )}
        </nav>
      </div>
    )
  }

  // One continuous countdown: published reviews worst-first, then the teams
  // whose reviews have not run, picking up where the published run left off.
  const published = data.articles.slice().sort(byRankDesc)
  const upcoming = data.teams.filter(t => !t.slug).sort(byRankDesc)

  return (
    <div className="view retro">
      <header className="retro-masthead">
        <p className="retro-eyebrow">Season review</p>
        <h1 className="retro-masthead-title">{data.title}</h1>
      </header>

      <ol className="retro-stories">
        {published.map(a => <StoryRow key={a.slug} article={a} onSelect={onSelect} />)}
      </ol>

      {upcoming.length > 0 && (
        <section className="retro-section">
          <h2 className="retro-section-head">Still to come</h2>
          <ol className="retro-upcoming-list">
            {upcoming.map(t => <UpcomingRow key={t.teamKey} team={t} />)}
          </ol>
        </section>
      )}
    </div>
  )
}
