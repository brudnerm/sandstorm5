/**
 * Trophy Room validation. Runs as part of the backfill and refuses to write
 * shards when anything fails, because a wrong number in a record book is
 * worse than a missing one.
 *
 * The load-bearing check is the first: every season's regular-season
 * standings are recomputed from the stored matchup results and compared to
 * Yahoo's own outcome totals, category by category. That proves the shards
 * actually reproduce the league's history rather than merely containing
 * plausible numbers.
 */
import type {
  MatchupShard,
  SeasonsShard,
  TransactionsShard,
  TrophyCategory,
  WeeklyShard,
} from '../domain/trophy.js'
import { BRACKET_BY_CODE } from '../domain/trophy.js'
import { statKey } from '../domain/stats.js'

export interface ValidationInput {
  seasonsShard: SeasonsShard
  weeklyShard: WeeklyShard
  matchupShard: MatchupShard
  transactionsShard: TransactionsShard
  globalCategories: TrophyCategory[]
}

export interface CheckResult {
  name: string
  passed: number
  failures: string[]
}

export interface ValidationReport {
  ok: boolean
  checks: CheckResult[]
  text: string
}

const RATE_STATS = new Set(['batting:3', 'batting:4', 'pitching:26', 'pitching:27'])

export function validate(input: ValidationInput): ValidationReport {
  const { seasonsShard, weeklyShard, matchupShard, transactionsShard, globalCategories } = input
  const { seasons, owners } = seasonsShard
  const checks: CheckResult[] = []
  const check = (name: string, run: (fail: (msg: string) => void) => number): void => {
    const failures: string[] = []
    const passed = run(msg => failures.push(msg))
    checks.push({ name, passed, failures })
  }

  const col = (columns: string[], name: string) => columns.indexOf(name)
  const wIdx = {
    season: col(weeklyShard.columns, 'season'),
    week: col(weeklyShard.columns, 'week'),
    owner: col(weeklyShard.columns, 'owner'),
    days: col(weeklyShard.columns, 'days'),
    bracket: col(weeklyShard.columns, 'bracket'),
    completedGames: col(weeklyShard.columns, 'completedGames'),
  }
  const mIdx = {
    season: col(matchupShard.columns, 'season'),
    week: col(matchupShard.columns, 'week'),
    a: col(matchupShard.columns, 'ownerA'),
    b: col(matchupShard.columns, 'ownerB'),
    bracket: col(matchupShard.columns, 'bracket'),
    results: col(matchupShard.columns, 'results'),
    winner: col(matchupShard.columns, 'winner'),
  }
  const ownerId = (i: number | null) => (i === null ? null : owners[i]?.id ?? `#${i}`)

  // ---------------------------------------------------------------- 1
  check("regular-season standings recompute from the stored matchups", fail => {
    let ok = 0
    for (const season of seasons) {
      const tally = new Map<string, { w: number; l: number; t: number }>()
      const add = (id: string, w: number, l: number, t: number) => {
        const cur = tally.get(id) ?? { w: 0, l: 0, t: 0 }
        cur.w += w; cur.l += l; cur.t += t
        tally.set(id, cur)
      }
      for (const row of matchupShard.rows) {
        if (row[mIdx.season] !== season.season) continue
        if (BRACKET_BY_CODE[row[mIdx.bracket] as number] !== 'regular') continue
        const results = String(row[mIdx.results])
        let w = 0, l = 0, t = 0
        for (const ch of results) {
          if (ch === 'W') w++
          else if (ch === 'L') l++
          else if (ch === 'T') t++
        }
        add(ownerId(row[mIdx.a] as number)!, w, l, t)
        add(ownerId(row[mIdx.b] as number)!, l, w, t)
      }
      for (const row of season.standings) {
        const got = tally.get(row.ownerId)
        if (!got) {
          fail(`${season.season} ${row.ownerId}: no regular-season matchups found`)
          continue
        }
        if (got.w !== row.wins || got.l !== row.losses || got.t !== row.ties) {
          fail(
            `${season.season} ${row.ownerId}: recomputed ${got.w}-${got.l}-${got.t} but Yahoo ` +
            `reports ${row.wins}-${row.losses}-${row.ties}`,
          )
        } else ok++
      }
    }
    return ok
  })

  // ---------------------------------------------------------------- 2
  check('every regular-season week is a full slate', fail => {
    let ok = 0
    for (const season of seasons) {
      const expected = season.numTeams / 2
      for (const week of season.regularSeasonWeeks) {
        const n = matchupShard.rows.filter(
          r => r[mIdx.season] === season.season && r[mIdx.week] === week &&
            BRACKET_BY_CODE[r[mIdx.bracket] as number] === 'regular',
        ).length
        if (n !== expected) fail(`${season.season} week ${week}: ${n} matchups, expected ${expected}`)
        else ok++
      }
    }
    return ok
  })

  // ---------------------------------------------------------------- 3
  check("each matchup's W+L+T equals the season's category count", fail => {
    let ok = 0
    for (const season of seasons) {
      const expected = season.categories.length
      for (const row of matchupShard.rows) {
        if (row[mIdx.season] !== season.season) continue
        const results = String(row[mIdx.results])
        const decided = [...results].filter(c => c === 'W' || c === 'L' || c === 'T').length
        if (decided !== expected) {
          fail(
            `${season.season} week ${row[mIdx.week]} ${ownerId(row[mIdx.a] as number)} vs ` +
            `${ownerId(row[mIdx.b] as number)}: ${decided} category results, expected ${expected}`,
          )
        } else ok++
      }
    }
    return ok
  })

  // ---------------------------------------------------------------- 4
  check("the computed champion won the championship final", fail => {
    let ok = 0
    for (const season of seasons) {
      if (!season.isFinished) continue
      if (!season.champion) {
        fail(`${season.season}: finished season has no champion`)
        continue
      }
      const finalWeek = Math.max(...season.playoffWeeks)
      const finals = matchupShard.rows.filter(
        r => r[mIdx.season] === season.season && r[mIdx.week] === finalWeek &&
          BRACKET_BY_CODE[r[mIdx.bracket] as number] === 'championship',
      )
      if (finals.length !== 1) {
        fail(`${season.season}: ${finals.length} championship games in week ${finalWeek}, expected 1`)
        continue
      }
      const final = finals[0]!
      const winner = ownerId(final[mIdx.winner] as number | null)
      if (winner !== season.champion.ownerId) {
        fail(`${season.season}: champion is ${season.champion.ownerId} but the final was won by ${winner}`)
        continue
      }
      const sides = [ownerId(final[mIdx.a] as number), ownerId(final[mIdx.b] as number)]
      if (season.runnerUp && !sides.includes(season.runnerUp.ownerId)) {
        fail(`${season.season}: runner-up ${season.runnerUp.ownerId} did not play in the final`)
        continue
      }
      ok++
    }
    return ok
  })

  // ---------------------------------------------------------------- 5
  check('no consolation result is ever tagged championship', fail => {
    let ok = 0
    for (const season of seasons) {
      const champWeeks = new Map<number, number>()
      for (const row of matchupShard.rows) {
        if (row[mIdx.season] !== season.season) continue
        const bracket = BRACKET_BY_CODE[row[mIdx.bracket] as number]
        if (bracket === 'championship') {
          champWeeks.set(row[mIdx.week] as number, (champWeeks.get(row[mIdx.week] as number) ?? 0) + 1)
          if (!season.playoffWeeks.includes(row[mIdx.week] as number)) {
            fail(`${season.season} week ${row[mIdx.week]}: championship game outside the playoff weeks`)
          } else ok++
        }
      }
      // The title path narrows: never more championship games in a later
      // round than in an earlier one.
      const ordered = [...champWeeks.entries()].sort((a, b) => a[0] - b[0])
      for (let i = 1; i < ordered.length; i++) {
        if (ordered[i]![1] > ordered[i - 1]![1]) {
          fail(
            `${season.season}: week ${ordered[i]![0]} has ${ordered[i]![1]} championship games, ` +
            `more than week ${ordered[i - 1]![0]}'s ${ordered[i - 1]![1]} — the bracket widens`,
          )
        }
      }
    }
    return ok
  })

  // ---------------------------------------------------------------- 6
  check('every weekly row is well formed and uniquely keyed', fail => {
    let ok = 0
    const seen = new Set<string>()
    const width = weeklyShard.columns.length
    for (const row of weeklyShard.rows) {
      if (row.length !== width) {
        fail(`row ${row[wIdx.season]}/${row[wIdx.week]}: ${row.length} values, expected ${width}`)
        continue
      }
      const key = `${row[wIdx.season]}|${row[wIdx.week]}|${row[wIdx.owner]}`
      if (seen.has(key)) {
        fail(`duplicate team-week ${row[wIdx.season]} week ${row[wIdx.week]} ${ownerId(row[wIdx.owner] as number)}`)
        continue
      }
      seen.add(key)
      if (ownerId(row[wIdx.owner] as number)!.startsWith('#')) {
        fail(`row ${row[wIdx.season]}/${row[wIdx.week]}: owner index ${row[wIdx.owner]} is out of range`)
        continue
      }
      ok++
    }
    return ok
  })

  // ---------------------------------------------------------------- 7
  check('team-weeks and matchups agree', fail => {
    let ok = 0
    for (const season of seasons) {
      const weekly = weeklyShard.rows.filter(r => r[wIdx.season] === season.season).length
      const matchups = matchupShard.rows.filter(r => r[mIdx.season] === season.season).length
      if (weekly !== matchups * 2) {
        fail(`${season.season}: ${weekly} team-weeks but ${matchups} matchups (expected ${matchups * 2})`)
      } else ok++
    }
    return ok
  })

  // ---------------------------------------------------------------- 8
  check('every scored category is classified as a rate or a counting stat', fail => {
    let ok = 0
    for (const c of globalCategories) {
      const key = statKey(c.role, c.statId)
      const isRate = RATE_STATS.has(key)
      // A counting stat must never be null where the team completed games.
      if (!isRate && !Number.isInteger(c.statId)) fail(`${c.abbr}: malformed stat id`)
      else ok++
    }
    for (const season of seasons) {
      for (const c of season.categories) {
        if (!globalCategories.some(g => g.statId === c.statId && g.role === c.role)) {
          fail(`${season.season}: category ${c.abbr} is missing from the global column order`)
        }
      }
    }
    return ok
  })

  // ---------------------------------------------------------------- 9
  check('week metadata is internally consistent', fail => {
    let ok = 0
    for (const season of seasons) {
      for (const week of season.weeks) {
        const days = week.days
        if (days < 1) { fail(`${season.season} week ${week.week}: ${days} days`); continue }
        if (week.isExtended !== days > 7 || week.isShort !== days < 7) {
          fail(`${season.season} week ${week.week}: ${days} days but flags say extended=${week.isExtended} short=${week.isShort}`)
          continue
        }
        const rows = weeklyShard.rows.filter(
          r => r[wIdx.season] === season.season && r[wIdx.week] === week.week,
        )
        if (rows.some(r => r[wIdx.days] !== days)) {
          fail(`${season.season} week ${week.week}: weekly rows disagree with the week's day count`)
          continue
        }
        ok++
      }
      const playoffOverlap = season.regularSeasonWeeks.filter(w => season.playoffWeeks.includes(w))
      if (playoffOverlap.length > 0) {
        fail(`${season.season}: weeks ${playoffOverlap.join(',')} are both regular season and playoff`)
      }
    }
    return ok
  })

  // --------------------------------------------------------------- 10
  check('transactions reference known owners, players and seasons', fail => {
    let ok = 0
    const seasonYears = new Set(seasons.map(s => s.season))
    const { types, playerNames, rows } = transactionsShard
    for (const [season, date, typeIndex, moves] of rows) {
      if (!seasonYears.has(season)) { fail(`transaction in unknown season ${season}`); continue }
      if (types[typeIndex] === undefined) { fail(`${season}: unknown type index ${typeIndex}`); continue }
      if (date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { fail(`${season}: malformed date "${date}"`); continue }
      let bad = false
      for (const [playerIndex, from, to] of moves) {
        if (playerNames[playerIndex] === undefined) {
          fail(`${season}: unknown player index ${playerIndex}`); bad = true; break
        }
        for (const sideValue of [from, to]) {
          if (typeof sideValue === 'number' && owners[sideValue] === undefined) {
            fail(`${season}: owner index ${sideValue} is out of range`); bad = true; break
          }
        }
        if (bad) break
      }
      if (!bad) ok++
    }
    return ok
  })

  const ok = checks.every(c => c.failures.length === 0)
  const lines: string[] = []
  lines.push('Validation')
  lines.push('='.repeat(60))
  for (const c of checks) {
    const status = c.failures.length === 0 ? 'PASS' : 'FAIL'
    lines.push(`${status}  ${c.name} (${c.passed} ok, ${c.failures.length} failed)`)
    for (const f of c.failures.slice(0, 10)) lines.push(`        ${f}`)
    if (c.failures.length > 10) lines.push(`        ... and ${c.failures.length - 10} more`)
  }
  lines.push('='.repeat(60))
  lines.push(ok ? 'All checks passed.' : 'FAILURES PRESENT — shards not written.')

  return { ok, checks, text: lines.join('\n') }
}
