/**
 * Owner identity — the stable key everything in the Trophy Room hangs on.
 *
 * Team names change constantly (seven of KP's twelve changed during 2026
 * alone), so a team name is per-season context and never an identity. The
 * obvious identity, Yahoo's manager GUID, is no longer available: as of
 * September 2026 every Yahoo endpoint returns the literal string
 * `--hidden--` in place of every `guid`, including for the authenticated
 * user's own teams. So owners carry a stable slug `id` instead, maintained
 * by hand in owners.json and never derived from anything Yahoo can change.
 *
 * Resolution order for a team-season:
 *   1. The Yahoo manager nickname, when Yahoo still exposes one.
 *   2. An explicit (season, team name) claim, for the three owners who left
 *      the league before Yahoo hid nicknames and for whom no other handle
 *      survives.
 *
 * A team-season that matches neither is a hard error, never a guess — an
 * unattributed record is worse than a missing one.
 */
import ownersJson from './owners.json' with { type: 'json' }

export interface Owner {
  /** Stable slug. The join key for every trophy shard. */
  id: string
  /** What the league calls this person. The only name ever rendered. */
  displayName: string
  /** Yahoo nicknames that resolve to this owner. Empty for hidden managers. */
  yahooNicknames: string[]
  /** season → exact Yahoo team name, for owners with no exposed nickname. */
  claimedTeamSeasons?: Record<string, string>
}

export const OWNERS: Owner[] = ownersJson.owners as Owner[]

const byNickname = new Map<string, Owner>()
const byTeamSeason = new Map<string, Owner>()
for (const owner of OWNERS) {
  for (const nick of owner.yahooNicknames) byNickname.set(nick, owner)
  for (const [season, teamName] of Object.entries(owner.claimedTeamSeasons ?? {})) {
    byTeamSeason.set(`${season}|${teamName}`, owner)
  }
}

export function ownerById(id: string): Owner {
  const owner = OWNERS.find(o => o.id === id)
  if (!owner) throw new Error(`Unknown owner id: ${id}`)
  return owner
}

/** True when Yahoo has withheld the manager's nickname for this team-season. */
export function isHiddenNickname(nickname: string | null | undefined): boolean {
  if (!nickname) return true
  return nickname.replaceAll('-', '') === 'hidden'
}

/**
 * Resolve one team-season to its owner. Throws rather than guessing, so a
 * new manager or a renamed team fails the backfill loudly instead of
 * silently attributing someone else's record.
 */
export function resolveOwner(
  season: string,
  teamName: string,
  nickname: string | null,
): Owner {
  if (!isHiddenNickname(nickname)) {
    const match = byNickname.get(nickname!)
    if (match) return match
    throw new Error(
      `No owner in owners.json claims Yahoo nickname "${nickname}" ` +
      `(${season}, team "${teamName}"). Add it to that manager's yahooNicknames.`,
    )
  }
  const claimed = byTeamSeason.get(`${season}|${teamName}`)
  if (claimed) return claimed
  throw new Error(
    `Yahoo hides the manager nickname for ${season} team "${teamName}", and no owner ` +
    `claims that (season, team name) pair in owners.json. Add it to the right owner's ` +
    `claimedTeamSeasons rather than guessing.`,
  )
}
