/**
 * What a pick in each round returned this season: the fitted expected-VAR
 * curve, one point per round. Monotone by construction, so it reads as a
 * simple decline — the useful part is where it crosses zero (replacement
 * level), which is the round after which picks stopped paying for themselves.
 */
interface Props {
  byRound: Array<{ round: number; expected: number }>
  /** Rounds at or above this are where keepers were slotted; drawn as a hint. */
  keeperFromRound: number | null
}

const PAD = { top: 12, right: 12, bottom: 20, left: 30 }

export default function DraftRoundChart({ byRound, keeperFromRound }: Props) {
  if (byRound.length < 2) return null

  const W = 640
  const H = 168
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const rounds = byRound.map(p => p.round)
  const minRound = Math.min(...rounds)
  const maxRound = Math.max(...rounds)
  const values = byRound.map(p => p.expected)
  const top = Math.max(...values, 0)
  const bottom = Math.min(...values, 0)
  const span = top - bottom || 1

  const x = (round: number) =>
    PAD.left + ((round - minRound) / Math.max(1, maxRound - minRound)) * innerW
  const y = (value: number) => PAD.top + ((top - value) / span) * innerH

  const path = byRound
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.round).toFixed(1)},${y(p.expected).toFixed(1)}`)
    .join('')
  // Fill down to the zero line so "above replacement" reads as area.
  const area =
    `${path}L${x(maxRound).toFixed(1)},${y(0).toFixed(1)}` +
    `L${x(minRound).toFixed(1)},${y(0).toFixed(1)}Z`

  const ticks = byRound.filter(p => p.round % 3 === 0 || p.round === minRound || p.round === maxRound)

  return (
    <svg
      className="dft-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Expected value over replacement by draft round"
    >
      {keeperFromRound !== null && keeperFromRound <= maxRound && (
        <rect
          x={x(keeperFromRound)}
          y={PAD.top}
          width={Math.max(0, x(maxRound) - x(keeperFromRound))}
          height={innerH}
          className="dft-chart-keeper"
        />
      )}
      <path d={area} className="dft-chart-area" />
      <line x1={PAD.left} y1={y(0)} x2={W - PAD.right} y2={y(0)} className="dft-chart-zero" />
      <text x={PAD.left - 5} y={y(0) + 3} className="dft-chart-axis" textAnchor="end">0</text>
      <text x={PAD.left - 5} y={y(top) + 3} className="dft-chart-axis" textAnchor="end">
        {top.toFixed(1)}
      </text>
      <path d={path} className="dft-chart-line" />
      {byRound.map(p => (
        <circle key={p.round} cx={x(p.round)} cy={y(p.expected)} r={2.4} className="dft-chart-dot" />
      ))}
      {ticks.map(p => (
        <text key={p.round} x={x(p.round)} y={H - 6} className="dft-chart-axis" textAnchor="middle">
          {p.round}
        </text>
      ))}
    </svg>
  )
}
