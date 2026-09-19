/**
 * Extremes, streaks and archives: the rest of the record.
 *
 * Consolation games are excluded here as everywhere else. Streaks and
 * matchup extremes therefore run across regular-season, championship and
 * placement games, in date order, and carry across seasons — a run does not
 * reset in March just because the calendar did.
 *
 * A matchup where both sides won the same number of categories is a draw. It
 * is neither a win nor a loss, so it ends a streak of either. There are 212
 * of them, so the distinction matters.
 */
import { BRACKET_BY_CODE, type MatchupShard, type SeasonsShard, type TransactionsShard } from './trophy.js'

export interface MatchupResult {
  season: number
  week: number
  bracket: string
  ownerA: string
  ownerB: string
  wins: number
  losses: number
  ties: number
}

/** Every non-consolation matchup, oldest first, from A's point of view. */
export function matchupResults(shard: SeasonsShard, matchups: MatchupShard): MatchupResult[] {
  const c = matchups.columns
  const idx = {
    season: c.indexOf('season'), week: c.indexOf('week'),
    a: c.indexOf('ownerA'), b: c.indexOf('ownerB'),
    bracket: c.indexOf('bracket'), results: c.indexOf('results'),
  }
  const out: MatchupResult[] = []
  for (const row of matchups.rows) {
    const bracket = BRACKET_BY_CODE[row[idx.bracket] as number] ?? 'regular'
    if (bracket === 'consolation') continue
    const ownerA = shard.owners[row[idx.a] as number]?.id
    const ownerB = shard.owners[row[idx.b] as number]?.id
    if (!ownerA || !ownerB) continue
    const results = String(row[idx.results])
    out.push({
      season: row[idx.season] as number,
      week: row[idx.week] as number,
      bracket,
      ownerA, ownerB,
      wins: [...results].filter(ch => ch === 'W').length,
      losses: [...results].filter(ch => ch === 'L').length,
      ties: [...results].filter(ch => ch === 'T').length,
    })
  }
  return out.sort((a, b) => a.season - b.season || a.week - b.week)
}

/** Matchups ranked by margin, widest first. */
export function mostLopsidedMatchups(results: MatchupResult[], limit: number): MatchupResult[] {
  return [...results]
    // Orient each to the winner's point of view before ranking.
    .map(r => (r.wins >= r.losses ? r : { ...r, ownerA: r.ownerB, ownerB: r.ownerA, wins: r.losses, losses: r.wins }))
    .sort((a, b) =>
      (b.wins - b.losses) - (a.wins - a.losses) || a.season - b.season || a.week - b.week)
    .slice(0, limit)
}

/** Matchups with the most tied categories. */
export function mostTiedMatchups(results: MatchupResult[], limit: number): MatchupResult[] {
  return [...results]
    .sort((a, b) => b.ties - a.ties || a.season - b.season || a.week - b.week)
    .slice(0, limit)
}

export interface FinalResult extends MatchupResult {
  championId: string
  margin: number
}

/** Championship finals, closest first. */
export function closestFinals(
  shard: SeasonsShard,
  results: MatchupResult[],
  limit: number,
): FinalResult[] {
  const out: FinalResult[] = []
  for (const season of shard.seasons) {
    if (!season.isFinished || !season.champion || season.playoffWeeks.length === 0) continue
    const finalWeek = Math.max(...season.playoffWeeks)
    const match = results.find(
      r => r.season === season.season && r.week === finalWeek && r.bracket === 'championship',
    )
    if (!match) continue
    out.push({ ...match, championId: season.champion.ownerId, margin: Math.abs(match.wins - match.losses) })
  }
  return out.sort((a, b) => a.margin - b.margin || b.season - a.season).slice(0, limit)
}

// -------------------------------------------------------------- heartbreak

export interface NearMiss {
  season: number
  ownerId: string
  teamName: string
  wins: number
  losses: number
  ties: number
  percentage: string
  seed: number
  wasRunnerUp: boolean
}

/** The best regular seasons that did not end in a title. */
export function bestWithoutTitle(shard: SeasonsShard, limit: number): NearMiss[] {
  const out: NearMiss[] = []
  for (const season of shard.seasons) {
    if (!season.isFinished) continue
    for (const row of season.standings) {
      if (season.champion?.ownerId === row.ownerId) continue
      out.push({
        season: season.season,
        ownerId: row.ownerId,
        teamName: row.teamName,
        wins: row.wins, losses: row.losses, ties: row.ties,
        percentage: row.percentage,
        seed: row.seed,
        wasRunnerUp: season.runnerUp?.ownerId === row.ownerId,
      })
    }
  }
  return out.sort((a, b) => Number(b.percentage) - Number(a.percentage)).slice(0, limit)
}

export interface FallenChampion {
  titleSeason: number
  nextSeason: number
  ownerId: string
  seed: number
  numTeams: number
  numPlayoffTeams: number | null
  wins: number
  losses: number
  ties: number
  wasLast: boolean
}

/** Champions who missed the playoffs the very next season. */
export function fallenChampions(shard: SeasonsShard): FallenChampion[] {
  const bySeason = new Map(shard.seasons.map(s => [s.season, s]))
  const out: FallenChampion[] = []
  for (const season of shard.seasons) {
    if (!season.isFinished || !season.champion) continue
    const next = bySeason.get(season.season + 1)
    if (!next) continue
    const row = next.standings.find(r => r.ownerId === season.champion!.ownerId)
    if (!row || next.numPlayoffTeams === null) continue
    if (row.seed <= next.numPlayoffTeams) continue
    out.push({
      titleSeason: season.season,
      nextSeason: next.season,
      ownerId: season.champion.ownerId,
      seed: row.seed,
      numTeams: next.numTeams,
      numPlayoffTeams: next.numPlayoffTeams,
      wins: row.wins, losses: row.losses, ties: row.ties,
      // Against the league's size, not the number of rows that happen to be
      // present, so a short standings array cannot quietly redefine "last".
      wasLast: row.seed === next.numTeams,
    })
  }
  return out.sort((a, b) => b.seed - a.seed || a.titleSeason - b.titleSeason)
}

// ----------------------------------------------------------------- streaks

export type Outcome = 'W' | 'L' | 'D'

export interface Streak {
  ownerId: string
  length: number
  outcome: Exclude<Outcome, 'D'>
  from: { season: number; week: number }
  to: { season: number; week: number }
}

/**
 * Longest runs of won or lost matchups, per owner, across seasons.
 *
 * A drawn matchup ends a run of either kind rather than extending it, which
 * is the only honest reading: the team did not win and did not lose.
 */
export function longestStreaks(
  results: MatchupResult[],
  outcome: Exclude<Outcome, 'D'>,
  limit: number,
): Streak[] {
  const perOwner = new Map<string, Array<{ season: number; week: number; outcome: Outcome }>>()
  const push = (ownerId: string, season: number, week: number, o: Outcome) => {
    const list = perOwner.get(ownerId) ?? []
    list.push({ season, week, outcome: o })
    perOwner.set(ownerId, list)
  }
  for (const r of results) {
    const forA: Outcome = r.wins > r.losses ? 'W' : r.wins < r.losses ? 'L' : 'D'
    const forB: Outcome = forA === 'W' ? 'L' : forA === 'L' ? 'W' : 'D'
    push(r.ownerA, r.season, r.week, forA)
    push(r.ownerB, r.season, r.week, forB)
  }

  const best: Streak[] = []
  for (const [ownerId, games] of perOwner) {
    let run = 0
    let startIndex = 0
    let bestRun = 0
    let bestRange: [number, number] | null = null
    games.forEach((game, i) => {
      if (game.outcome === outcome) {
        if (run === 0) startIndex = i
        run++
        if (run > bestRun) { bestRun = run; bestRange = [startIndex, i] }
      } else {
        run = 0
      }
    })
    if (bestRun > 0 && bestRange) {
      const [from, to] = bestRange as [number, number]
      best.push({
        ownerId, length: bestRun, outcome,
        from: { season: games[from]!.season, week: games[from]!.week },
        to: { season: games[to]!.season, week: games[to]!.week },
      })
    }
  }
  return best.sort((a, b) => b.length - a.length || a.from.season - b.from.season).slice(0, limit)
}

// ----------------------------------------------------------- name archive

export interface NameRun {
  name: string
  from: number
  to: number
}

/**
 * An owner's team names, with consecutive repeats collapsed into a run. Some
 * owners have used one name for eighteen years and some change every March;
 * a flat list of eighteen rows hides which is which.
 */
export function nameRuns(teamNames: Record<string, string>): NameRun[] {
  const seasons = Object.keys(teamNames).map(Number).sort((a, b) => a - b)
  const runs: NameRun[] = []
  for (const season of seasons) {
    const name = teamNames[String(season)]!
    const last = runs[runs.length - 1]
    if (last && last.name === name && last.to === season - 1) last.to = season
    else runs.push({ name, from: season, to: season })
  }
  return runs
}

// ------------------------------------------------------------ transactions

export interface TransactionRecords {
  /** Busiest single seasons, by owner. */
  busiestSeasons: Array<{ ownerId: string; season: number; count: number }>
  /** Most trades entered into, all time. */
  mostTrades: Array<{ ownerId: string; count: number }>
  /** Players who changed hands by trade most often. */
  mostTradedPlayers: Array<{ name: string; trades: number }>
  /** Players acquired by the most different owners. */
  mostPassedAround: Array<{ name: string; owners: number }>
  totals: {
    transactions: number
    /** Every trade on file, including those that name no players. */
    tradesOnFile: number
    /** Trades that name no players, so no owner can be credited with them. */
    tradesWithoutPlayers: number
    /** Records Yahoo will not serve, so counts are a known undercount. */
    unavailable: number
    /** Transactions with no team on either side, which cannot be attributed. */
    unattributed: number
  }
}

export function transactionRecords(
  shard: SeasonsShard,
  transactions: TransactionsShard,
  limit: number,
): TransactionRecords {
  const tradeType = transactions.types.indexOf('trade')
  const perOwnerSeason = new Map<string, number>()
  const tradesByOwner = new Map<string, number>()
  const tradesByPlayer = new Map<number, number>()
  const ownersByPlayer = new Map<number, Set<number>>()
  let unattributed = 0
  let tradesOnFile = 0
  let tradesWithoutPlayers = 0

  for (const [season, , typeIndex, moves] of transactions.rows) {
    if (typeIndex === tradeType) tradesOnFile++
    const parties = new Set<number>()
    for (const [playerIndex, from, to] of moves) {
      if (typeof from === 'number') parties.add(from)
      if (typeof to === 'number') {
        parties.add(to)
        const seen = ownersByPlayer.get(playerIndex) ?? new Set<number>()
        seen.add(to)
        ownersByPlayer.set(playerIndex, seen)
      }
      if (typeIndex === tradeType) {
        tradesByPlayer.set(playerIndex, (tradesByPlayer.get(playerIndex) ?? 0) + 1)
      }
    }
    if (parties.size === 0) {
      unattributed++
      // Yahoo records a handful of trades with no players attached. They
      // happened, but nothing in the payload says who was involved.
      if (typeIndex === tradeType) tradesWithoutPlayers++
      continue
    }
    for (const index of parties) {
      const ownerId = shard.owners[index]?.id
      if (!ownerId) continue
      const key = `${ownerId}|${season}`
      perOwnerSeason.set(key, (perOwnerSeason.get(key) ?? 0) + 1)
      if (typeIndex === tradeType) {
        tradesByOwner.set(ownerId, (tradesByOwner.get(ownerId) ?? 0) + 1)
      }
    }
  }

  const name = (index: number) => transactions.playerNames[index] ?? 'Unknown player'

  return {
    busiestSeasons: [...perOwnerSeason.entries()]
      .map(([key, count]) => {
        const [ownerId, season] = key.split('|')
        return { ownerId: ownerId!, season: Number(season), count }
      })
      .sort((a, b) => b.count - a.count || a.season - b.season)
      .slice(0, limit),
    mostTrades: [...tradesByOwner.entries()]
      .map(([ownerId, count]) => ({ ownerId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit),
    mostTradedPlayers: [...tradesByPlayer.entries()]
      .map(([index, count]) => ({ name: name(index), trades: count }))
      .sort((a, b) => b.trades - a.trades || a.name.localeCompare(b.name))
      .slice(0, limit),
    mostPassedAround: [...ownersByPlayer.entries()]
      .map(([index, owners]) => ({ name: name(index), owners: owners.size }))
      .sort((a, b) => b.owners - a.owners || a.name.localeCompare(b.name))
      .slice(0, limit),
    totals: {
      transactions: transactions.rows.length,
      tradesOnFile,
      tradesWithoutPlayers,
      unavailable: transactions.unavailable.length,
      unattributed,
    },
  }
}
