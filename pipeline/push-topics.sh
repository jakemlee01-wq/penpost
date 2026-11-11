#!/usr/bin/env bash
# Commit and push topic-manifest changes from .github/workflows/draft-edition.yml.
#
#   bash pipeline/push-topics.sh claim    mark $TOPICS pending for $EDITION_DATE and push
#   bash pipeline/push-topics.sh finish   commit stories + edition, mark topics ready, push
#
# Claim jobs and the edition run can push at the same moment, and all of them edit
# content/topics/<date>.json. Each attempt re-applies the change on top of the latest main
# instead of merging JSON, and retries if someone else pushed first.
set -euo pipefail

mode="${1:?usage: push-topics.sh claim|finish}"
date="${EDITION_DATE:-}"
[ -n "$date" ] || date="$(TZ=America/Chicago date +%F)"
manifest="content/topics/$date.json"

git config user.name "penpost-bot"
git config user.email "penpost-bot@users.noreply.github.com"

if [ "$mode" = "claim" ]; then
  for attempt in 1 2 3 4 5 6; do
    git fetch -q origin main
    git reset -q --hard origin/main
    claimed="$(npx tsx pipeline/topics.ts claim --date "$date" --topics "${TOPICS:-}")"
    git add "$manifest"
    if git diff --cached --quiet; then
      echo "Nothing to claim for $date (all ready)."
      exit 0
    fi
    git commit -q -m "Topics pending $date: ${claimed:0:200}"
    if git push -q origin HEAD:main; then
      echo "Claimed for $date: $claimed"
      exit 0
    fi
    sleep $((attempt * 3))
  done
  echo "Could not push the topic claim." >&2
  exit 1
fi

if [ "$mode" = "finish" ]; then
  # 1. The content commit. Story files are new and only one edition run writes at a time, so it rebases cleanly.
  git add content/stories content/editions
  git diff --cached --quiet || git commit -q -m "Edition $date"
  # Any manifest edits on disk are recomputed from the latest main below.
  git checkout -q -- content/topics 2>/dev/null || true
  git clean -fdq -- content/topics
  # 2. The manifest commit, rebuilt on each attempt.
  made=0
  for attempt in 1 2 3 4 5 6; do
    if [ "$made" = 1 ]; then git reset -q --hard HEAD~1; made=0; fi
    git pull -q --rebase origin main
    npx tsx pipeline/topics.ts finish --date "$date"
    if [ -f "$manifest" ]; then git add "$manifest"; fi
    if ! git diff --cached --quiet; then
      git commit -q -m "Topics ready $date"
      made=1
    fi
    if git push -q origin HEAD:main; then
      echo "Published edition $date."
      exit 0
    fi
    sleep $((attempt * 3))
  done
  echo "Could not push the edition." >&2
  exit 1
fi

echo "usage: push-topics.sh claim|finish" >&2
exit 2
