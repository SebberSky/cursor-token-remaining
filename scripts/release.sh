#!/usr/bin/env bash
# Create and push an annotated v* tag from package.json (or npm version bump).
#
# Usage:
#   ./scripts/release.sh           # tag current package.json version
#   ./scripts/release.sh patch     # npm version patch, commit, tag, push
#   ./scripts/release.sh 0.3.1     # set exact version, commit, tag, push
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" && -z "${1:-}" ]]; then
  echo "Working tree is dirty. Commit first, or pass patch|minor|major|x.y.z to bump." >&2
  exit 1
fi

if [[ -n "${1:-}" ]]; then
  npm version "$1" --no-git-tag-version
  VERSION="$(node -p "require('./package.json').version")"
  git add package.json package-lock.json
  git commit -m "Release v${VERSION}"
fi

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "Tag ${TAG} already exists." >&2
  exit 1
fi

git tag -a "${TAG}" -m "Token Remaining ${VERSION}"
git push origin HEAD
git push origin "${TAG}"
echo "Pushed ${TAG}. GitHub Actions will attach the VSIX."
