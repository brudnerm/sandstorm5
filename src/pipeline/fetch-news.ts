/**
 * Scrape fantasy player news → data/mlb/news.json
 *
 * Sources, in display priority order:
 *   1. CBS Sports fantasy baseball player news (syndicated RotoWire wire)
 *   2. RotoWire's own news feed
 *
 * Both are plain HTML pages with stable, class-named markup; there is no
 * public JSON feed. Parsing is regex-based and deliberately forgiving —
 * a source that fails or changes shape is skipped with a warning, never
 * fatal, so the rest of the refresh pipeline keeps working. The client
 * matches stories to players by normalized name.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NewsShard, NewsStory } from '../domain/mlb.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Both sites serve the full page to a browser UA; the default fetch UA
// gets bot-walled.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function getHtml(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`)
  return resp.text()
}

/** Drop tags, collapse whitespace, decode the entities these feeds use. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCbs(html: string): NewsStory[] {
  const stories: NewsStory[] = []
  // Items are <li> blocks inside <ul id="playerNewsContent">.
  const list = html.split('id="playerNewsContent"')[1]
  if (!list) return stories
  for (const chunk of list.split(/<li>/).slice(1)) {
    const player = /\/mlb\/players\/\d+\/[^"]+\/fantasy\/">([^<]+)<\/a>\s*<span>([^<]*)<\/span>/.exec(chunk)
    const headline = /<h4><a href="([^"]*)">([^<]+)<\/a><\/h4>/.exec(chunk)
    const time = /<time class="eyebrow">([^<]*)<\/time>/.exec(chunk)
    const detail = /<div class="latest-updates">([\s\S]*?)<\/div>/.exec(chunk)
    if (!player || !headline) continue
    stories.push({
      source: 'CBS',
      playerName: textOf(player[1]!),
      context: textOf(player[2]!) || null,
      headline: textOf(headline[2]!),
      detail: detail ? textOf(detail[1]!) : '',
      time: time ? textOf(time[1]!) : '',
      url: headline[1] ? new URL(headline[1], 'https://www.cbssports.com').href : null,
    })
  }
  return stories
}

function parseRotowire(html: string): NewsStory[] {
  const stories: NewsStory[] = []
  for (const chunk of html.split(/<div class="news-update[" ]/).slice(1)) {
    const player = /class="news-update__player-link" href="([^"]*)">([^<]+)</.exec(chunk)
    const headline = /class="news-update__headline" href="([^"]*)">([^<]+)</.exec(chunk)
    const meta = /<b class="news-update__pos">([^<]*)<\/b>([^<]*)</.exec(chunk)
    const time = /class="news-update__timestamp">([^<]*)</.exec(chunk)
    const news = /class="news-update__news">([\s\S]*?)<\/div>/.exec(chunk)
    if (!player || !headline) continue
    stories.push({
      source: 'RotoWire',
      playerName: textOf(player[2]!),
      context: meta ? textOf(`${meta[1]} | ${meta[2]}`) : null,
      headline: textOf(headline[2]!),
      detail: news ? textOf(news[1]!) : '',
      time: time ? textOf(time[1]!) : '',
      url: headline[1] ? new URL(headline[1], 'https://www.rotowire.com').href : null,
    })
  }
  return stories
}

const SOURCES: Array<{ url: string; parse: (html: string) => NewsStory[] }> = [
  { url: 'https://www.cbssports.com/fantasy/baseball/players/news/all/both/', parse: parseCbs },
  { url: 'https://www.rotowire.com/baseball/news.php', parse: parseRotowire },
]

const stories: NewsStory[] = []
for (const source of SOURCES) {
  try {
    const parsed = source.parse(await getHtml(source.url))
    if (parsed.length === 0) console.warn(`  WARNING: no stories parsed from ${source.url} — markup change?`)
    stories.push(...parsed)
    console.log(`  ${new URL(source.url).hostname}: ${parsed.length} stories`)
  } catch (err) {
    console.warn(`  WARNING: skipping ${source.url}: ${err instanceof Error ? err.message : err}`)
  }
}

const outPath = path.join(ROOT, 'data', 'mlb', 'news.json')
mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), stories } satisfies NewsShard, null, 1))
console.log(`  wrote ${stories.length} stories → ${path.relative(ROOT, outPath)}`)
