/**
 * Rank-by-week bump chart: one line per team, rank 1 at the top, with the
 * in-progress week drawn as a dashed provisional segment. One team is
 * highlighted at a time — the home team by default, or whichever line/label
 * the pointer touches.
 */
import { useState } from 'react'
import type { TeamTrajectory } from '../../lib/leagueTrends'

interface Props {
  trajectories: TeamTrajectory[]
  homeKey: string | null
}

const PAD = { top: 12, right: 116, bottom: 22, left: 26 }

export default function BumpChart({ trajectories, homeKey }: Props) {
  const [active, setActive] = useState<string | null>(null)

  const weeks = [...new Set(trajectories.flatMap(t => t.points.map(p => p.week)))].sort((a, b) => a - b)
  const teams = trajectories.length
  if (weeks.length === 0 || teams === 0) return null

  const W = 640
  const H = 28 * teams + PAD.top + PAD.bottom
  const innerW = W - PAD.left - PAD.right
  const x = (week: number) => PAD.left + (weeks.indexOf(week) / Math.max(1, weeks.length - 1)) * innerW
  const y = (rank: number) => PAD.top + ((rank - 1) / Math.max(1, teams - 1)) * (H - PAD.top - PAD.bottom)

  const hot = active ?? homeKey
  // Draw the highlighted line last so it sits on top.
  const ordered = [...trajectories].sort((a, b) =>
    Number(a.team.teamKey === hot) - Number(b.team.teamKey === hot))

  const segments = (t: TeamTrajectory) => {
    const solid = t.points.filter(p => !p.provisional)
    const provisional = t.points.find(p => p.provisional)
    const path = (pts: typeof solid) =>
      pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.week).toFixed(1)},${y(p.rank).toFixed(1)}`).join('')
    return {
      solid: solid.length >= 2 ? path(solid) : null,
      dashed: provisional && solid.length > 0
        ? path([solid[solid.length - 1]!, provisional])
        : null,
      last: t.points[t.points.length - 1] ?? null,
    }
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const py = ((e.clientY - rect.top) / rect.height) * H
    const week = weeks[Math.max(0, Math.min(weeks.length - 1,
      Math.round(((px - PAD.left) / Math.max(1, innerW)) * (weeks.length - 1))))]!
    let bestKey: string | null = null
    let bestDist = Infinity
    for (const t of trajectories) {
      const point = t.points.find(p => p.week === week)
      if (!point) continue
      const dist = Math.abs(y(point.rank) - py)
      if (dist < bestDist) {
        bestDist = dist
        bestKey = t.team.teamKey
      }
    }
    setActive(bestKey)
  }

  return (
    <svg
      className="bump-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Standings rank by week"
      onPointerMove={onMove}
      onPointerLeave={() => setActive(null)}
    >
      {weeks.filter((_, i) => i % 2 === 0 || weeks.length <= 8).map(week => (
        <text key={week} x={x(week)} y={H - 6} className="roll-tick" textAnchor="middle">
          {week}
        </text>
      ))}
      {ordered.map(t => {
        const { solid, dashed, last } = segments(t)
        const isHot = t.team.teamKey === hot
        const cls = `bump-line${isHot ? ' hot' : ''}`
        return (
          <g key={t.team.teamKey}>
            {solid && <path d={solid} className={cls} />}
            {dashed && <path d={dashed} className={`${cls} provisional`} />}
            {isHot && t.points.map(p => (
              <circle key={p.week} cx={x(p.week)} cy={y(p.rank)} r={2.6} className="bump-dot" />
            ))}
            {!solid && !dashed && last && (
              <circle cx={x(last.week)} cy={y(last.rank)} r={3} className={isHot ? 'bump-dot' : 'bump-dot muted'} />
            )}
            {last && (
              <text
                x={W - PAD.right + 8}
                y={y(last.rank) + 3}
                className={`bump-label${isHot ? ' hot' : ''}`}
                onPointerDown={() => setActive(prev => prev === t.team.teamKey ? null : t.team.teamKey)}
              >
                {last.rank} {t.team.name.length > 14 ? `${t.team.name.slice(0, 13)}…` : t.team.name}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
