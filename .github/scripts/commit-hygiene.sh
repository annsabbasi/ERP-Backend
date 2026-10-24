#!/bin/sh
# Checks the commits on a branch: author and committer e-mail must be the repository
# owner's, and no message may contain "Co-authored-by" on any line
# (docs/adr/0004-direct-commits-to-main.md).
#
#   sh .github/scripts/commit-hygiene.sh [baseline] [head]
#
# Only the commits after the baseline are checked. With no baseline, or one that is not
# in the history of head (for example after a history rewrite), every commit is checked.
set -eu

allowed='annsabbasi54@gmail.com'
baseline="${1:-}"
head="${2:-HEAD}"

if [ -n "$baseline" ] && git merge-base --is-ancestor "$baseline" "$head" 2>/dev/null; then
  range="$baseline..$head"
  echo "Checking the commits after $baseline up to $head."
else
  [ -n "$baseline" ] && echo "Baseline $baseline is not in the history of $head."
  range="$head"
  echo "Checking every commit up to $head."
fi

failed=0
for sha in $(git rev-list "$range"); do
  author=$(git log -1 --format=%ae "$sha")
  committer=$(git log -1 --format=%ce "$sha")
  if [ "$author" != "$allowed" ] || [ "$committer" != "$allowed" ]; then
    echo "::error::$sha: author <$author>, committer <$committer>; both must be <$allowed>."
    failed=1
  fi
  if git log -1 --format=%B "$sha" | grep -qi 'co-authored-by'; then
    echo "::error::$sha: the message contains \"Co-authored-by\"."
    failed=1
  fi
done

if [ "$failed" -eq 0 ]; then
  echo "$(git rev-list --count "$range") commit(s) checked: every one is clean."
fi
exit "$failed"
