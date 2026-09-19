# Adding curated content

Everything in the Museum is entered by hand. The rest of the Trophy Room is
computed from stored data and can be traced to a row; these entries record
things the league remembers and Yahoo never kept.

## Where it lives

`src/domain/curated.json`, in the repo rather than on the data branch. A change
is reviewed like code, survives a data-branch rebuild, and cannot be lost. The
pipeline copies it to `data/kp/trophy/curated.json` when it runs.

## The rules

- **Nothing renders until you approve it.** A new entry is `"status": "draft"`
  and appears only on a local dev server. Change it to `"approved"` to publish.
- **Every entry declares how well attested it is.** `"source": "confirmed"` means
  there is a record; `"reported"` means somebody remembers it. The page shows
  which, so a reader is never left guessing.
- **A cited statistic must be true.** If an entry carries `evidence`, the
  pipeline looks the team-week up and refuses to write the shards when the
  number disagrees. A curated plaque may be hand-written; it may not be wrong.
- **Owner ids come from `owners.json`,** not display names. An unknown id fails
  the build.
- **No quotes from the league email**, per the brief. Describe what happened.

## The three kinds

### Veto

```json
{
  "id": "unique-slug",
  "status": "draft",
  "source": "reported",
  "sourceNote": "Where this came from.",
  "season": 2019,
  "proposedBy": ["nick", "galen"],
  "players": [{ "name": "Some Player", "from": "nick", "to": "galen" }],
  "vote": { "against": 7, "inFavour": 2, "abstained": 1 },
  "outcome": "vetoed",
  "description": "What happened, in plain terms."
}
```

`vote` may be `null` when no vote was recorded. `outcome` is `vetoed`,
`upheld` or `withdrawn`.

### Keeper

```json
{
  "id": "unique-slug",
  "status": "draft",
  "source": "confirmed",
  "ownerId": "galen",
  "playerName": "Some Player",
  "fromSeason": 2016,
  "toSeason": 2021,
  "description": "Optional."
}
```

Keepers are derivable from the draft data from 2015 on. An entry covering any
of those seasons is cross-checked against it, and a disagreement is reported
during the build without failing it, because the entry may be describing
something the draft data cannot see.

### Plaque

```json
{
  "id": "unique-slug",
  "status": "draft",
  "source": "confirmed",
  "title": "Twenty home runs in a championship week",
  "season": 2026,
  "week": 24,
  "ownerId": "mike",
  "description": "What it was.",
  "evidence": {
    "kind": "team-week",
    "season": 2026,
    "week": 24,
    "ownerId": "mike",
    "category": "HR",
    "value": 20
  }
}
```

`week` may be `null` for a season-long honour, and `evidence` may be omitted
when there is no statistic to cite. When it is present, every field is
required so the claim can be checked.

## After editing

```bash
npm run fetch:trophy
```

It prints how many entries are approved and draft, reports any cross-check
notes, and refuses to write anything if a cited figure is wrong.
