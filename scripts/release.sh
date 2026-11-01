#!/usr/bin/env bash
# Usage: npm run release -- 1.1.0
#
# Apps install the kit straight from git ("github:Alcariss/pwa-kit#semver:^1.0.0"),
# so the tagged commit must already contain the built dist/: npm then needs no
# build step and no install scripts on the app's side. dist/ stays out of main;
# it lives only on the release commit the tag points to.
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: npm run release -- X.Y.Z" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Commit or stash your changes first." >&2
  exit 1
fi
if [[ "$(git branch --show-current)" != main ]]; then
  echo "Release from main." >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
  echo "Tag v$version already exists." >&2
  exit 1
fi

npm run typecheck
npm test

if [[ "$(node -p 'require("./package.json").version')" != "$version" ]]; then
  npm version "$version" --no-git-tag-version >/dev/null
  git commit -q -m "chore: release v$version" package.json package-lock.json
fi
npm run build

major="v${version%%.*}"
git checkout -q --detach
git add -f dist
git commit -q -m "build: dist for v$version"
git tag -a "v$version" -m "v$version"
# Apps' deploy workflows call ...deploy-pages.yml@v1, so the major tag follows the latest release.
git tag -f -a "$major" -m "$major -> v$version" >/dev/null
git checkout -q main

echo "Tagged v$version and moved $major. Publish with:"
echo "  git push origin main v$version && git push --force origin $major"
