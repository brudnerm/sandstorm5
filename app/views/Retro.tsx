/**
 * Season retrospective: one article per team, published one at a time.
 * Content comes from data/{leagueId}/retro/{season}.json (hand-written
 * prose, not derived from Yahoo). The navigator lists every team in
 * regular-season order; unpublished teams stay visible so the league can
 * see who's next.
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

function Ladder({ shard, current, onSelect }: { shard: RetroShard; current: string | null; onSelect: (s: string) => void }) {
  const ordered = [...shard.teams].sort((a, b) => b.rank - a.rank)
  return (
    <ol className="retro-ladder" aria-label="Teams">
      {ordered.map(t => {
        const published = !!t.slug
        const status = published ? 'read' : t.playoffs ? 'after the championship' : 'coming soon'
        const inner = (
          <>
            <span className="retro-rank">{t.rank}</span>
            <span className="retro-ladder-main">
              <span className="retro-ladder-team">{t.teamName}</span>
              <span className="retro-ladder-meta">{t.manager} · {t.record}</span>
            </span>
            <span className="retro-ladder-status">{status}</span>
          </>
        )
        return (
          <li key={t.teamKey} className={`retro-ladder-row${published ? '' : ' held'}${current === t.slug ? ' current' : ''}`}>
            {published ? (
              <button className="retro-ladder-btn" onClick={() => onSelect(t.slug!)} aria-current={current === t.slug ? 'page' : undefined}>
                {inner}
              </button>
            ) : (
              <div className="retro-ladder-btn">{inner}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function ArticleBody({ article }: { article: Article }) {
  return (
    <article className="retro-article">
      <header className="retro-article-head">
        <span className="retro-rank big">{article.rank}</span>
        <div>
          <p className="retro-kicker">{ORDINAL(article.rank)} place · {article.record}</p>
          <h1 className="retro-title">{article.teamName}</h1>
          <p className="retro-byline">{article.manager}'s team · published {fmtDate(article.publishedAt)}</p>
        </div>
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
    const published = data.articles.slice().sort((a, b) => b.rank - a.rank)
    const idx = published.findIndex(a => a.slug === article.slug)
    const prev = published[idx - 1] ?? null
    const next = published[idx + 1] ?? null
    return (
      <div className="view retro">
        <button className="retro-back" onClick={() => onSelect(null)}>All teams</button>
        <ArticleBody article={article} />
        <nav className="retro-pager" aria-label="More reviews">
          {prev ? (
            <button className="retro-pager-btn" onClick={() => onSelect(prev.slug)}>
              <span className="retro-pager-label">Previous</span>
              <span>{prev.rank}. {prev.teamName}</span>
            </button>
          ) : <span />}
          {next ? (
            <button className="retro-pager-btn right" onClick={() => onSelect(next.slug)}>
              <span className="retro-pager-label">Next</span>
              <span>{next.rank}. {next.teamName}</span>
            </button>
          ) : (
            <span className="retro-pager-btn right muted">
              <span className="retro-pager-label">Next</span>
              <span>Not published yet</span>
            </span>
          )}
        </nav>
      </div>
    )
  }

  const latest = data.articles.slice().sort((a, b) => a.publishedAt < b.publishedAt ? 1 : -1)[0]
  return (
    <div className="view retro">
      <header className="retro-intro">
        <h1 className="retro-title">{data.title}</h1>
        <p className="retro-p">{data.intro}</p>
      </header>
      {latest && (
        <button className="retro-latest" onClick={() => onSelect(latest.slug)}>
          <span className="retro-kicker">Latest</span>
          <span className="retro-latest-team"><span className="retro-rank">{latest.rank}</span>{latest.teamName}</span>
          <span className="retro-ladder-meta">{latest.manager} · {latest.record} · {fmtDate(latest.publishedAt)}</span>
        </button>
      )}
      <Ladder shard={data} current={null} onSelect={onSelect} />
    </div>
  )
}
