/**
 * Draft blurbs for the Hall of Champions and the Hall of Shame.
 *
 * Every sentence is assembled from computed facts. There are no adjectives
 * the data cannot support, no motives, no injuries, no trades that are not in
 * the transaction log. The humour is meant to come from the facts and the
 * framing, so the templates state what happened and stop.
 *
 * Nothing here is published on its own authority: entries are written with
 * `status: "draft"` and only render on the live page once a human changes
 * that to `"approved"`. A regeneration never touches an approved entry, so
 * re-running the pipeline cannot quietly reword something already signed off.
 */
import { BRACKET_BY_CODE, type MatchupShard, type SeasonsShard, type TrophySeason } from '../domain/trophy.js'
import type { DraftsShard } from './drafts.js'

export interface CopyEntry {
  status: 'draft' | 'approved'
  text: string
  /** Regenerated drafts carry the date they were written. */
  generatedAt?: string
}

export interface CopyShard {
  leagueId: string
  entries: Record<string, CopyEntry>
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const ORDINAL_WORDS = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
]
const count = (n: number): string => COUNT_WORDS[n] ?? String(n)
const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${count(n)} times`)
/** Words read better than digits in prose, and every place here fits. */
const ordinal = (n: number): string => {
  if (ORDINAL_WORDS[n]) return ORDINAL_WORDS[n]!
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}
const list = (items: string[]): string =>
  items.length <= 1 ? items[0] ?? ''
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/**
 * "an 85-142-25" but "a 92-141-19" — the article follows how the leading
 * number is said, and eight, eleven, eighteen and the eighties take "an".
 */
function articleFor(n: number): string {
  const s = String(n)
  if (s.startsWith('8')) return 'an'
  if (s === '11' || s === '18' || s.startsWith('11') || s.startsWith('18')) return 'an'
  return 'a'
}

/** Yahoo carries two-way players twice; the parenthetical is not their name. */
const cleanPlayer = (name: string): string => name.replace(/\s*\((?:Batter|Pitcher)\)\s*$/, '').trim()

/** Join a sentence to its terminator without doubling a trailing period. */
const sentence = (body: string): string => (body.endsWith('.') ? body : `${body}.`)

/** "2025-09-15" -> "15 September". */
function dayMonth(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    month: 'long', timeZone: 'UTC',
  })
  return `${d} ${month}`
}

interface Context {
  seasonsShard: SeasonsShard
  matchupShard: MatchupShard
  draftsShard: DraftsShard
}

function ownerName(ctx: Context, id: string): string {
  return ctx.seasonsShard.owners.find(o => o.id === id)?.displayName ?? id
}

/** The championship final as stored, from the champion's point of view. */
function finalFor(ctx: Context, season: TrophySeason) {
  const { columns, rows } = ctx.matchupShard
  const i = {
    season: columns.indexOf('season'), week: columns.indexOf('week'),
    a: columns.indexOf('ownerA'), b: columns.indexOf('ownerB'),
    bracket: columns.indexOf('bracket'), results: columns.indexOf('results'),
  }
  const owners = ctx.seasonsShard.owners
  const finalWeek = Math.max(...season.playoffWeeks)
  const row = rows.find(
    r => r[i.season] === season.season && r[i.week] === finalWeek &&
      BRACKET_BY_CODE[r[i.bracket] as number] === 'championship',
  )
  if (!row || !season.champion) return null
  const aId = owners[row[i.a] as number]?.id
  const results = String(row[i.results])
  const fromChampion = aId === season.champion.ownerId
    ? results
    : [...results].map(c => (c === 'W' ? 'L' : c === 'L' ? 'W' : c)).join('')
  const w = [...fromChampion].filter(c => c === 'W').length
  const l = [...fromChampion].filter(c => c === 'L').length
  const t = [...fromChampion].filter(c => c === 'T').length
  const week = season.weeks.find(x => x.week === finalWeek)
  return { w, l, t, week, finalWeek }
}

function championBlurb(ctx: Context, season: TrophySeason): string | null {
  if (!season.champion) return null
  const name = ownerName(ctx, season.champion.ownerId)
  const seedRow = season.standings.find(r => r.ownerId === season.champion!.ownerId)
  const final = finalFor(ctx, season)
  const sentences: string[] = []

  // 1. What they won, from where.
  const seedPart = seedRow ? ` from the ${ordinal(seedRow.seed)} seed` : ''
  const recordPart = seedRow
    ? `, ${seedRow.wins}-${seedRow.losses}-${seedRow.ties} in the regular season`
    : ''
  sentences.push(sentence(`${name} won the ${season.season} title${seedPart}${recordPart}`))

  // 2. The final itself. A final can finish level on categories and still
  // have a recorded winner, so those are described as level rather than won.
  if (final && season.runnerUp) {
    const opponent = ownerName(ctx, season.runnerUp.ownerId)
    const dates = final.week ? ` in the week of ${dayMonth(final.week.start)}` : ''
    sentences.push(
      final.w === final.l
        ? sentence(
            `The final against ${opponent} finished level at ` +
            `${final.w}-${final.l}-${final.t}${dates}, and the title is recorded as ${name}'s`,
          )
        : sentence(`The final went ${final.w}-${final.l}-${final.t} against ${opponent}${dates}`),
    )
  }

  // 3. Where it sits in their record, and the league's.
  const finished = ctx.seasonsShard.seasons.filter(s => s.isFinished && s.season <= season.season)
  const theirTitles = finished.filter(s => s.champion?.ownerId === season.champion!.ownerId).length
  const allTitles = new Map<string, number>()
  for (const s of finished) {
    if (s.champion) allTitles.set(s.champion.ownerId, (allTitles.get(s.champion.ownerId) ?? 0) + 1)
  }
  const most = Math.max(...allTitles.values())
  const sharers = [...allTitles.entries()]
    .filter(([id, n]) => n === most && id !== season.champion!.ownerId)
    .map(([id]) => ownerName(ctx, id))

  if (theirTitles === 1) {
    sentences.push('It was a first.')
  } else if (theirTitles === most && sharers.length > 0) {
    sentences.push(
      `It was their ${ordinal(theirTitles)}, level with ${list(sharers)} at the top of the list.`,
    )
  } else if (theirTitles === most) {
    sentences.push(`It was their ${ordinal(theirTitles)}, more than anyone else had managed.`)
  } else {
    sentences.push(`It was their ${ordinal(theirTitles)}.`)
  }

  // 4. Keepers, only where the data supports naming them.
  const draft = ctx.draftsShard.seasons.find(d => d.season === season.season)
  const kept = draft?.keepers.filter(k => k.ownerId === season.champion!.ownerId) ?? []
  if (kept.length > 0) {
    sentences.push(sentence(`They went in having kept ${list(kept.map(k => cleanPlayer(k.playerName)))}`))
  }

  return sentences.join(' ')
}

function shameBlurb(ctx: Context, season: TrophySeason): string | null {
  if (!season.lastPlace) return null
  const name = ownerName(ctx, season.lastPlace.ownerId)
  const rows = season.standings
  const last = rows[rows.length - 1]
  const above = rows[rows.length - 2]
  const sentences: string[] = []

  // 1. The finish and the record.
  sentences.push(
    last
      ? `${name} finished last in ${season.season} with ${articleFor(last.wins)} ` +
        `${last.wins}-${last.losses}-${last.ties} category record.`
      : `${name} finished last in ${season.season}.`,
  )

  // 2. How far adrift. Category wins alone can mislead: a team can out-win
  // the team above and still finish below it once ties are counted, and two
  // teams can share a percentage and be separated only by the standings.
  if (last && above) {
    const gap = above.wins - last.wins
    const place = ordinal(rows.length - 1)
    sentences.push(
      last.percentage === above.percentage
        ? `That is level with ${place} place on record, and below it in the final standings.`
        : gap > 0
          ? `That is ${count(gap)} category ${gap === 1 ? 'win' : 'wins'} behind ${place} place.`
          : gap === 0
            ? `That is level with ${place} place on category wins, and behind once ties are counted.`
            : `That is ${count(-gap)} more category ${-gap === 1 ? 'win' : 'wins'} than ${place} place, ` +
              `and a worse record once ties are counted.`,
    )
  }

  // 3. How often he has done it.
  const finished = ctx.seasonsShard.seasons.filter(s => s.isFinished && s.season <= season.season)
  const theirs = finished.filter(s => s.lastPlace?.ownerId === season.lastPlace!.ownerId).length
  sentences.push(
    theirs === 1
      ? 'It was their first time at the bottom.'
      : `They have now finished last ${times(theirs)}.`,
  )

  // 4. What it bought, where the league drafted in reverse order.
  const nextDraft = ctx.draftsShard.seasons.find(d => d.season === season.season + 1)
  if (nextDraft?.firstPick && nextDraft.firstPickWentToLastPlace === true) {
    sentences.push(sentence(
      `The reward was the first pick of the ${nextDraft.season} draft, which they spent on ` +
      `${cleanPlayer(nextDraft.firstPick.playerName)}`,
    ))
  }

  return sentences.join(' ')
}

/**
 * Regenerate the draft blurbs, leaving anything already approved alone.
 */
export function buildCopy(ctx: Context, existing: CopyShard | null): CopyShard {
  const generatedAt = new Date().toISOString().slice(0, 10)
  const entries: Record<string, CopyEntry> = {}

  for (const season of ctx.seasonsShard.seasons) {
    if (!season.isFinished) continue
    for (const [prefix, text] of [
      ['champion', championBlurb(ctx, season)],
      ['shame', shameBlurb(ctx, season)],
    ] as const) {
      if (!text) continue
      const key = `${prefix}-${season.season}`
      const prior = existing?.entries[key]
      // An approved blurb is a human's words now, whatever the template says.
      entries[key] = prior?.status === 'approved'
        ? prior
        : { status: 'draft', text, generatedAt }
    }
  }

  // Keep approved entries whose season no longer generates one, rather than
  // silently dropping copy someone signed off.
  for (const [key, entry] of Object.entries(existing?.entries ?? {})) {
    if (!entries[key] && entry.status === 'approved') entries[key] = entry
  }

  return { leagueId: ctx.seasonsShard.leagueId, entries }
}
