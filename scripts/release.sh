#!/usr/bin/env bash
# One-command desktop release: npm run release [patch|minor|major]
#
# Bumps the version, pushes the matching v* tag (which starts the Desktop
# workflow), waits for GitHub to build the installers into a draft release,
# then publishes that draft once you confirm. See RELEASING.md for the
# manual steps this automates.
set -euo pipefail

cd "$(dirname "$0")/.."

bump="${1:-patch}"
case "$bump" in
  patch|minor|major) ;;
  *) echo "Usage: npm run release [patch|minor|major]   (default: patch)"; exit 1 ;;
esac

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31mStopped:\033[0m %s\n' "$*"; exit 1; }
ask()  { local reply; read -r -p "$1 [y/N] " reply; [[ "$reply" =~ ^[Yy]$ ]]; }

# --- Safety checks: only release a clean, pushed master ----------------------
command -v gh >/dev/null || fail "The GitHub CLI (gh) is not installed."
gh auth status >/dev/null 2>&1 || fail "Not signed in to GitHub. Run: gh auth login"
[ "$(git branch --show-current)" = "master" ] || fail "You are not on master. Switch with: git checkout master"
[ -z "$(git status --porcelain)" ] || fail "You have unsaved (uncommitted) changes. Commit or discard them first."
git fetch --quiet origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || fail "master is not in sync with GitHub. Run git pull and git push first."

current="$(node -p "require('./package.json').version")"
next="$(node -e "
  const [a, b, c] = '$current'.split('.').map(Number);
  console.log({ major: [a + 1, 0, 0], minor: [a, b + 1, 0], patch: [a, b, c + 1] }['$bump'].join('.'));
")"
tag="v$next"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && fail "Tag $tag already exists."

say "Checking the code (lint)…"
npm run lint --silent || fail "Lint found problems. Fix them, then run this again."

say "Ready to release $current -> $next"
ask "Bump the version and start the GitHub build?" || fail "Cancelled. Nothing was changed."

# --- Bump, commit, tag, push -------------------------------------------------
say "Bumping version to $next…"
npm version "$next" --no-git-tag-version >/dev/null
git commit -q -am "chore: release $tag"
git push -q origin master
git tag "$tag"
git push -q origin "$tag"

# --- Wait for the Desktop workflow -------------------------------------------
say "Waiting for GitHub to start the build…"
run_id=""
for _ in $(seq 1 30); do
  run_id="$(gh run list --workflow desktop.yml --branch "$tag" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
  [ -n "$run_id" ] && break
  sleep 5
done
[ -n "$run_id" ] || fail "The build didn't start. Check the Actions tab on GitHub."

say "Building (this usually takes 10-20 minutes)…"
if ! gh run watch "$run_id" --exit-status --interval 30; then
  fail "The GitHub build failed. See: $(gh run view "$run_id" --json url --jq .url)
To retry after fixing it, delete the tag and the draft release, then run:
  git tag -d $tag && git push origin :refs/tags/$tag
and push the tag again: git tag $tag && git push origin $tag"
fi

# --- Publish -----------------------------------------------------------------
say "Build finished. The draft release $tag is ready on GitHub."
echo "Installers: $(gh release view "$tag" --json assets --jq '[.assets[].name] | join(", ")')"
echo
if ask "Publish $tag now? Users will start getting the update."; then
  read -r -p "Release notes (one line, what changed): " notes
  gh release edit "$tag" --draft=false --notes "${notes:-Improvements and fixes.}" >/dev/null
  say "Published! $(gh release view "$tag" --json url --jq .url)"
  # The README download buttons link straight to versioned installer files,
  # so point them at the release that just went live.
  sed -i -E "s#releases/download/v[0-9.]+/AppBlips(-Setup)?-[0-9]+\.[0-9]+\.[0-9]+#releases/download/$tag/AppBlips\1-$next#g" README.md
  if [ -n "$(git status --porcelain README.md)" ]; then
    git commit -q -m "docs: point README downloads at $tag" README.md
    git push -q origin master
    say "README download buttons now point at $tag."
  fi
else
  say "Left as a draft. Publish it later at: $(gh release view "$tag" --json url --jq .url)"
fi
