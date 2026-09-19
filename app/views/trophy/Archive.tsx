/**
 * The archive: extremes, heartbreak, streaks, team names and transactions.
 *
 * Everything here obeys the same rules as the rest of the record book.
 * Consolation games never count. Streaks run across regular-season,
 * championship and placement games in date order and carry across seasons.
 * A matchup where both sides took the same number of categories is a draw,
 * so it ends a run of either kind rather than extending one.
 */
import { useMemo, useState } from 'react'
import {
  bestWithoutTitle, closestFinals, fallenChampions, longestStreaks, matchupResults,
  mostLopsidedMatchups, mostTiedMatchups, nameRuns, transactionRecords,
} from '../../../src/domain/archive'
import { formatPct, winPct } from '../../../src/domain/ownerStats'
import type { MatchupShard, SeasonsShard, TransactionsShard } from '../../../src/domain/trophy'
import OwnerChip from '../../components/trophy/OwnerChip'
import Plaque from '../../components/trophy/Plaque'
import RecordTable from '../../components/trophy/RecordTable'
import SectionHeader from '../../components/trophy/SectionHeader'
import { ownerLookup } from '../../lib/trophy'

interface Props {
  leagueId: string
  shard: SeasonsShard
  matchups: MatchupShard | null
  transactions: TransactionsShard | null
}

const SECTIONS = [
  { id: 'extremes', label: 'Matchup extremes' },
  { id: 'heartbreak', label: 'Heartbreak' },
  { id: 'streaks', label: 'Streaks' },
  { id: 'names', label: 'Team names' },
  { id: 'transactions', label: 'Transactions' },
]

export default function Archive({ leagueId, shard, matchups, transactions }: Props) {
  const lookup = ownerLookup(shard)
  const [openOwner, setOpenOwner] = useState<string | null>(null)

  const results = useMemo(
    () => (matchups ? matchupResults(shard, matchups) : []),
    [shard, matchups],
  )
  const tx = useMemo(
    () => (transactions ? transactionRecords(shard, transactions, 8) : null),
    [shard, transactions],
  )

  if (!matchups) {
    return (
      <>
        <SectionHeader as="h1" eyebrow="Trophy Room" title="Archive" />
        <p className="trophy-pending">Loading the matchup record…</p>
      </>
    )
  }

  const lopsided = mostLopsidedMatchups(results, 8)
  const tied = mostTiedMatchups(results, 6)
  const finals = closestFinals(shard, results, 6)
  const nearMisses = bestWithoutTitle(shard, 8)
  const fallen = fallenChampions(shard)
  const winStreaks = longestStreaks(results, 'W', 6)
  const lossStreaks = longestStreaks(results, 'L', 6)
  const owner = (id: string) => <OwnerChip name={lookup.name(id)} />
  const when = (season: number, week: number, bracket?: string) => (
    <>
      {season} wk {week}
      {bracket && bracket !== 'regular' && <span className="trophy-tag">{bracket}</span>}
    </>
  )

  return (
    <>
      <SectionHeader
        as="h1"
        eyebrow="Trophy Room"
        title="Archive"
        note="The rest of the record: the widest wins, the narrowest finals, the longest runs, every team name, and what the transaction log remembers."
      />

      <nav className="trophy-jump" aria-label="Sections">
        {SECTIONS.map(s => (
          <a key={s.id} className="trophy-jump-link" href={`#/${leagueId}/trophy/archive`} onClick={e => {
            e.preventDefault()
            document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}>{s.label}</a>
        ))}
      </nav>

      <section id="extremes">
        <SectionHeader eyebrow="Matchup extremes" title="The widest and the narrowest" />
        <div className="trophy-boards">
          <RecordTable
            caption="Most lopsided matchups"
            ranked
            columns={[
              { key: 'winner', label: 'Winner' },
              { key: 'loser', label: 'Opponent' },
              { key: 'score', label: 'Score', numeric: true },
              { key: 'when', label: 'When', wrap: true },
            ]}
            rows={lopsided.map((r, i) => ({
              key: `${r.season}-${r.week}-${r.ownerA}`,
              rank: i + 1,
              leader: r.wins - r.losses === lopsided[0]!.wins - lopsided[0]!.losses,
              cells: [owner(r.ownerA), owner(r.ownerB), `${r.wins}-${r.losses}-${r.ties}`, when(r.season, r.week, r.bracket)],
            }))}
            note="A clean sweep takes every scored category. Consolation games are excluded, so these all counted for something."
          />
          <RecordTable
            caption="Most tied categories in one matchup"
            ranked
            columns={[
              { key: 'a', label: 'Owner' },
              { key: 'b', label: 'Opponent' },
              { key: 'score', label: 'Score', numeric: true },
              { key: 'when', label: 'When', wrap: true },
            ]}
            rows={tied.map((r, i) => ({
              key: `${r.season}-${r.week}-${r.ownerA}`,
              rank: i + 1,
              leader: r.ties === tied[0]!.ties,
              cells: [owner(r.ownerA), owner(r.ownerB), `${r.wins}-${r.losses}-${r.ties}`, when(r.season, r.week, r.bracket)],
            }))}
            note="Score is from the first owner's point of view."
          />
        </div>
      </section>

      <section>
        <SectionHeader eyebrow="Finals" title="Closest championship finals" />
        <RecordTable
          caption="Championship finals by margin"
          ranked
          columns={[
            { key: 'season', label: 'Season', numeric: true },
            { key: 'champion', label: 'Champion' },
            { key: 'opponent', label: 'Runner-up' },
            { key: 'score', label: 'Score', numeric: true },
            { key: 'margin', label: 'Margin', numeric: true },
          ]}
          rows={finals.map((f, i) => {
            const championFirst = f.championId === f.ownerA
            const w = championFirst ? f.wins : f.losses
            const l = championFirst ? f.losses : f.wins
            return {
              key: String(f.season),
              rank: i + 1,
              leader: f.margin === 0,
              cells: [
                f.season,
                owner(f.championId),
                owner(championFirst ? f.ownerB : f.ownerA),
                `${w}-${l}-${f.ties}`,
                f.margin === 0 ? 'level' : f.margin,
              ],
            }
          })}
          note="Three finals finished level on categories. Yahoo recorded a winner in each, and the Trophy Room reports the score as level rather than as a win."
        />
      </section>

      <section id="heartbreak">
        <SectionHeader
          eyebrow="Heartbreak"
          title="The best seasons that won nothing"
          note="Regular-season records, ranked on percentage, excluding the team that went on to win the title that year."
        />
        <RecordTable
          tone="shame"
          caption="Best regular seasons without a title"
          ranked
          columns={[
            { key: 'owner', label: 'Owner' },
            { key: 'season', label: 'Season', numeric: true },
            { key: 'record', label: 'Record', numeric: true },
            { key: 'pct', label: 'Pct', numeric: true },
            { key: 'seed', label: 'Seed', numeric: true },
            { key: 'note', label: 'How it ended', wrap: true },
          ]}
          rows={nearMisses.map((n, i) => ({
            key: `${n.season}-${n.ownerId}`,
            rank: i + 1,
            leader: i === 0,
            cells: [
              owner(n.ownerId), n.season,
              `${n.wins}-${n.losses}-${n.ties}`, n.percentage, n.seed,
              n.wasRunnerUp ? 'Lost the final' : 'Did not reach the final',
            ],
          }))}
        />
      </section>

      <section>
        <SectionHeader
          eyebrow="Heartbreak"
          title="Defending champions who missed the playoffs"
          tone="shame"
        />
        <RecordTable
          tone="shame"
          caption="Title one year, no playoffs the next"
          ranked
          columns={[
            { key: 'owner', label: 'Owner' },
            { key: 'won', label: 'Won', numeric: true },
            { key: 'then', label: 'Next season', numeric: true },
            { key: 'finish', label: 'Finish', numeric: true },
            { key: 'record', label: 'Record', numeric: true },
          ]}
          rows={fallen.map((f, i) => ({
            key: `${f.titleSeason}-${f.ownerId}`,
            rank: i + 1,
            leader: f.wasLast,
            cells: [
              owner(f.ownerId), f.titleSeason, f.nextSeason,
              `${f.seed} of ${f.numTeams}${f.wasLast ? ', last' : ''}`,
              `${f.wins}-${f.losses}-${f.ties}`,
            ],
          }))}
          note={`The bracket was ${[...new Set(shard.seasons.map(s => s.numPlayoffTeams).filter(Boolean))].sort().join(' or ')} teams depending on the season, so a finish counts as missing the playoffs against that year's bracket rather than a fixed number.`}
        />
      </section>

      <section id="streaks">
        <SectionHeader
          eyebrow="Streaks"
          title="Longest runs"
          note="Consecutive matchups won or lost, in date order, carrying across seasons. A matchup that finished level on categories is a draw and ends a run of either kind."
        />
        <div className="trophy-boards">
          <RecordTable
            caption="Longest winning runs"
            ranked
            columns={[
              { key: 'owner', label: 'Owner' },
              { key: 'n', label: 'Matchups', numeric: true },
              { key: 'span', label: 'Span', wrap: true },
            ]}
            rows={winStreaks.map((s, i) => ({
              key: `${s.ownerId}-${s.from.season}`,
              rank: i + 1,
              leader: s.length === winStreaks[0]!.length,
              cells: [
                owner(s.ownerId), s.length,
                `${s.from.season} wk ${s.from.week} to ${s.to.season} wk ${s.to.week}`,
              ],
            }))}
          />
          <RecordTable
            tone="shame"
            caption="Longest losing runs"
            ranked
            columns={[
              { key: 'owner', label: 'Owner' },
              { key: 'n', label: 'Matchups', numeric: true },
              { key: 'span', label: 'Span', wrap: true },
            ]}
            rows={lossStreaks.map((s, i) => ({
              key: `${s.ownerId}-${s.from.season}`,
              rank: i + 1,
              leader: s.length === lossStreaks[0]!.length,
              cells: [
                owner(s.ownerId), s.length,
                `${s.from.season} wk ${s.from.week} to ${s.to.season} wk ${s.to.week}`,
              ],
            }))}
          />
        </div>
      </section>

      <section id="names">
        <SectionHeader
          eyebrow="Archive"
          title="Every team name"
          note="Consecutive seasons under the same name are collapsed into one line, which is the quickest way to see who renames every March and who has not bothered since 2009."
        />
        <div className="trophy-names">
          {shard.owners.map(o => {
            const runs = nameRuns(o.teamNames)
            if (runs.length === 0) return null
            const isOpen = openOwner === o.id
            const shown = isOpen ? runs : runs.slice(0, 4)
            return (
              <div key={o.id} className="trophy-names-owner">
                <h3 className="trophy-names-head">
                  <a className="trophy-owner-link" href={`#/${leagueId}/trophy/owners/${o.id}`}>
                    {lookup.name(o.id)}
                  </a>
                  <span className="trophy-names-count">
                    {runs.length} {runs.length === 1 ? 'name' : 'names'} in {Object.keys(o.teamNames).length} seasons
                  </span>
                </h3>
                <ul className="trophy-names-list">
                  {shown.slice().reverse().map(run => (
                    <li key={`${run.name}-${run.from}`}>
                      <span className="trophy-names-span">
                        {run.from === run.to ? run.from : `${run.from}–${run.to}`}
                      </span>
                      <span className="trophy-names-name">{run.name}</span>
                    </li>
                  ))}
                </ul>
                {runs.length > 4 && (
                  <button className="trophy-expander" onClick={() => setOpenOwner(isOpen ? null : o.id)} aria-expanded={isOpen}>
                    {isOpen ? 'Show fewer' : `Show all ${runs.length}`}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section id="transactions">
        <SectionHeader
          eyebrow="Archive"
          title="Transactions"
          note={tx
            ? `${tx.totals.transactions.toLocaleString()} transactions on file, including ` +
              `${tx.totals.tradesOnFile} trades. Three things are not counted below: ` +
              `${tx.totals.unavailable} records Yahoo will not serve at all, ` +
              `${tx.totals.unattributed - tx.totals.tradesWithoutPlayers} commissioner actions with no team on either side, and ` +
              `${tx.totals.tradesWithoutPlayers} trades that name no players, which are most likely draft-pick trades but say so nowhere in the payload.`
            : undefined}
        />
        {!transactions ? (
          <p className="trophy-pending">Loading the transaction log…</p>
        ) : tx && (
          <>
            <div className="trophy-boards">
              <RecordTable
                caption="Busiest single seasons"
                ranked
                columns={[
                  { key: 'owner', label: 'Owner' },
                  { key: 'season', label: 'Season', numeric: true },
                  { key: 'n', label: 'Moves', numeric: true },
                ]}
                rows={tx.busiestSeasons.map((r, i) => ({
                  key: `${r.ownerId}-${r.season}`,
                  rank: i + 1,
                  leader: r.count === tx.busiestSeasons[0]!.count,
                  cells: [owner(r.ownerId), r.season, r.count],
                }))}
                note="A move is one transaction the owner was party to, so an add and its matching drop count once."
              />
              <RecordTable
                caption="Most trades, all time"
                ranked
                columns={[
                  { key: 'owner', label: 'Owner' },
                  { key: 'n', label: 'Trades', numeric: true },
                ]}
                rows={tx.mostTrades.map((r, i) => ({
                  key: r.ownerId,
                  rank: i + 1,
                  leader: r.count === tx.mostTrades[0]!.count,
                  cells: [owner(r.ownerId), r.count],
                }))}
                note="Both sides of a trade are credited with it."
              />
            </div>
            <div className="trophy-boards">
              <RecordTable
                caption="Most-traded players"
                ranked
                columns={[
                  { key: 'player', label: 'Player', wrap: true },
                  { key: 'n', label: 'Trades', numeric: true },
                ]}
                rows={tx.mostTradedPlayers.map((r, i) => ({
                  key: r.name,
                  rank: i + 1,
                  leader: r.trades === tx.mostTradedPlayers[0]!.trades,
                  cells: [r.name, r.trades],
                }))}
              />
              <RecordTable
                caption="Passed around the most"
                ranked
                columns={[
                  { key: 'player', label: 'Player', wrap: true },
                  { key: 'n', label: 'Owners', numeric: true },
                ]}
                rows={tx.mostPassedAround.map((r, i) => ({
                  key: r.name,
                  rank: i + 1,
                  leader: r.owners === tx.mostPassedAround[0]!.owners,
                  cells: [r.name, r.owners],
                }))}
                note="Different owners who have acquired the player by trade, waiver or free agency. It does not count a player drafted and kept, so it is a floor rather than a full roster history."
              />
            </div>
          </>
        )}
      </section>
    </>
  )
}

export { winPct, formatPct }
