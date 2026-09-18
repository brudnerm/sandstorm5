/**
 * An owner, with the team name they were using that season.
 *
 * Owners are the league's stable identity and team names change constantly
 * — seven of twelve changed during 2026 alone — so the name is the subject
 * and the team is context. Never the other way round.
 */
interface Props {
  name: string
  /** That season's team name. Omitted where the row is already per-season. */
  teamName?: string | null
  /** Stack the team under the name, for narrow table cells. */
  stacked?: boolean
}

export default function OwnerChip({ name, teamName, stacked = false }: Props) {
  return (
    <span className={`trophy-owner${stacked ? ' stacked' : ''}`}>
      <span className="trophy-owner-name">{name}</span>
      {teamName && <span className="trophy-owner-team">{teamName}</span>}
    </span>
  )
}
