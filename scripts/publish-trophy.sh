#!/usr/bin/env bash
#
# Publish the Trophy Room shards to the `data` branch.
#
# The record book is built locally, not by CI. Finished seasons never change,
# so rebuilding them on every 15-minute refresh would be thousands of wasted
# Yahoo requests, and the refresh workflow carries a refresh-token chain that
# Yahoo invalidates on rotation. Keeping this out of that workflow keeps the
# fragile part untouched.
#
# The shards persist once pushed. The refresh workflow restores the `data`
# branch into data/, runs its pipelines, and force-pushes the whole directory
# back, so files it never touches survive every run. It rewrites the branch's
# history each time, which is why this script does not try to preserve any.
#
# Only data/kp/trophy/ is touched. Every other snapshot on the branch is left
# exactly as it was found.
#
#   npm run publish:trophy
#
set -euo pipefail

SRC="data/kp/trophy"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ ! -d "$SRC" ]; then
  echo "error: $SRC does not exist. Run 'npm run fetch:trophy' first." >&2
  exit 1
fi

# Never publish shards that do not validate. verify.ts checks the files on
# disk, which is exactly what is about to be uploaded.
echo "Validating the shards before publishing..."
npm run --silent verify:trophy

REMOTE="$(git remote get-url origin)"
echo
echo "Fetching the current data branch..."
git fetch --quiet origin data

git clone --quiet --branch data --single-branch --depth 1 "$REMOTE" "$WORK/data-branch"

mkdir -p "$WORK/data-branch/kp/trophy"
rsync -a --delete "$SRC/" "$WORK/data-branch/kp/trophy/"

cd "$WORK/data-branch"
if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
  echo
  echo "The data branch already holds these exact shards. Nothing to publish."
  exit 0
fi

echo
echo "Changes to publish:"
git add -A
git status --short

git -c user.name="$(git -C "$OLDPWD" config user.name)" \
    -c user.email="$(git -C "$OLDPWD" config user.email)" \
    commit --quiet -m "Trophy Room shards $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push --quiet origin data

echo
echo "Published to the data branch. A push to main will deploy them."
