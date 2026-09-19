# Trophy Room docs

- `audit.md` — the Stage 0 audit. Sections A–F are written by hand; the numbered
  sections after them are generated and should never be edited directly.
- `audit-prose.md` — the hand-written half, and the file to edit.
- `audit-generated.md` — regenerate with `npx tsx src/trophy/write-audit.ts`, then
  rebuild the combined document:

  ```
  cat docs/trophy-room/audit-prose.md docs/trophy-room/audit-generated.md > docs/trophy-room/audit.md
  ```

- `design.md` — the visual language, components and accessibility rules.
- `screenshots/` — generated with `scripts/screenshot.mjs`, gitignored. They are
  review artifacts rather than source, so they are regenerated rather than kept
  in history.
- `pipeline.md` — how the Trophy Room shards are built and refreshed.
- `curated.md` — how to add a veto, a keeper or a plaque by hand.
- `stage3-copy.md` — generated; every draft blurb, for review.
- `stage4-qualifiers.md` — generated; the record qualifiers and the evidence for them.
- `stage4-spotcheck.md` — generated; displayed records traced back to raw Yahoo.
- `stage5-matrix-check.md` — generated; the head-to-head matrix reconciled against
  the all-time standings.
- `stage6-archive.md` — generated; what the archive computes, and what it cannot.
- `stage1-report.md` — generated; rebuild with `npx tsx src/trophy/report.ts`.

The owner map moved to `src/domain/owners.json`, beside `leagues.ts`, since it is
hand-maintained identity config of the same kind.

Recon scripts live in `src/trophy/`. All Yahoo reads go through `cache.ts`, which
stores raw responses under `data/.cache/yahoo/` (gitignored), so reruns cost no API
calls and the backfill is idempotent.
