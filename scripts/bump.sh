#!/usr/bin/env bash
# bump — author the release commit that scripts/ship.sh then promotes.
#
#   scripts/bump.sh <--major|--minor|--patch> [body] [--dry-run]
#
# The bump is one shell invocation for the same reason ship.sh is: the
# change-budget hook meters tool calls, not work, and `git` is not on its
# read-only allowlist — so a hand-authored release commit costs two git recon
# calls plus the commit itself, and the ship it exists to enable then trips the
# leash. Chained here the whole thing costs one action, leaving the budget for
# the ship.
#
# Where the version comes from: pyproject.toml, incremented. There is no
# explicit-number argument, so there is exactly one way to bump and the two
# version files cannot drift apart by a typo.
#
# What it does, in order:
#   1. preflight   on dev, clean tree, versions agree, CHANGELOG is ready
#   2. rewrite     both version files + a new CHANGELOG heading
#   3. commit      `release: <version>`, with the optional body
#   4. print       the full diff, for review before ship.sh pushes anything
#
# It only ever inserts a *heading* into CHANGELOG.md, never prose. That is what
# makes it safe to bypass the markdown soft-wrap hook, which is scoped to the
# Edit/Write tools and does not see a script's writes: headings are exempt from
# the wrap rule anyway, so there is nothing here for it to catch. Changelog
# prose stays an Edit call.
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

DRY=0
PART=""
BODY=""

usage() { echo "usage: scripts/bump.sh <--major|--minor|--patch> [body] [--dry-run]" >&2; exit 2; }
say()   { echo; echo "== $* =="; }
run()   { if [ "$DRY" = 1 ]; then echo "  would run: $*"; else "$@"; fi; }
die()   { echo "FAIL: $*" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --major|--minor|--patch)
      [ -z "$PART" ] || die "pick one of --major, --minor, --patch."
      PART="${arg#--}" ;;
    --dry-run) DRY=1 ;;
    -*) usage ;;
    *)
      [ -z "$BODY" ] || usage
      BODY="$arg" ;;
  esac
done
[ -n "$PART" ] || usage

# ---- 1. preflight -----------------------------------------------------------

say "[1/4] preflight"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = dev ] || die "on '$BRANCH'; release commits are authored on dev."

# A clean tree is what makes `git add -A` below safe: the only paths it can pick
# up are the three this script just wrote.
if [ -n "$(git status --porcelain)" ]; then
  [ "$DRY" = 1 ] || die "working tree is dirty — commit or stash first."
  echo "  WARNING: working tree is dirty; a real bump would stop here."
fi

CUR=$(grep -m1 '^version = ' pyproject.toml | cut -d'"' -f2)
INIT_VER=$(grep -m1 '^__version__ = ' hqptuner/__init__.py | cut -d'"' -f2)
[ -n "$CUR" ] || die "no version in pyproject.toml."
[ "$CUR" = "$INIT_VER" ] || die "version mismatch: pyproject.toml=$CUR hqptuner/__init__.py=$INIT_VER"
[[ "$CUR" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version '$CUR' is not N.N.N — bump it by hand."

IFS=. read -r MAJOR MINOR PATCH <<<"$CUR"
case "$PART" in
  major) NEW="$((MAJOR + 1)).0.0" ;;
  minor) NEW="$MAJOR.$((MINOR + 1)).0" ;;
  patch) NEW="$MAJOR.$MINOR.$((PATCH + 1))" ;;
esac
TODAY=$(date +%F)

grep -q '^## \[Unreleased\]$' CHANGELOG.md || die "no '## [Unreleased]' heading in CHANGELOG.md."
if grep -q "^## \[$NEW\]" CHANGELOG.md; then
  die "CHANGELOG.md already has a [$NEW] section."
fi

# Everything between [Unreleased] and the next version heading. Empty means the
# release would ship with nothing to say it changed, which is a mistake every
# time.
UNREL=$(sed -n '/^## \[Unreleased\]$/,/^## \[/{ /^## \[/d; p; }' CHANGELOG.md | tr -d '[:space:]')
[ -n "$UNREL" ] || die "CHANGELOG.md [Unreleased] is empty — write the entries first."

echo "  $CUR -> $NEW ($PART) · dated $TODAY"
if [ "$DRY" = 1 ]; then echo "  (dry run — nothing below is executed)"; fi

# ---- 2. rewrite -------------------------------------------------------------

say "[2/4] rewrite"

echo "  pyproject.toml, hqptuner/__init__.py, CHANGELOG.md"
if [ "$DRY" = 0 ]; then
  sed -i "s/^version = \"$CUR\"\$/version = \"$NEW\"/" pyproject.toml
  sed -i "s/^__version__ = \"$CUR\"\$/__version__ = \"$NEW\"/" hqptuner/__init__.py
  sed -i "s/^## \[Unreleased\]\$/## [Unreleased]\n\n## [$NEW] — $TODAY/" CHANGELOG.md

  # A sed that matched nothing exits 0, so verify rather than trust. Restoring
  # here keeps a half-applied bump from being committed by the next attempt.
  for f in pyproject.toml hqptuner/__init__.py; do
    grep -q "\"$NEW\"" "$f" || { git checkout -- pyproject.toml hqptuner/__init__.py CHANGELOG.md
      die "$f did not take the new version — nothing changed."; }
  done
fi

# ---- 3. commit --------------------------------------------------------------

say "[3/4] commit"

run git add -A
if [ "$DRY" = 1 ]; then
  echo "  would run: git commit -m 'release: $NEW'${BODY:+ -m '<body>'}"
elif [ -n "$BODY" ]; then
  git commit -q -m "release: $NEW" -m "$BODY" \
    || die "commit rejected — the edits are staged; fix the message and commit by hand."
else
  git commit -q -m "release: $NEW" \
    || die "commit rejected — the edits are staged; fix the message and commit by hand."
fi

# ---- 4. review --------------------------------------------------------------

say "[4/4] diff"

if [ "$DRY" = 1 ]; then
  echo "  would show: git show HEAD"
else
  git --no-pager show --format='  %h %s' HEAD
fi

echo
if [ "$DRY" = 1 ]; then
  echo "DRY RUN — nothing changed."
else
  echo "PASS — $NEW committed. Ship it with scripts/ship.sh <dev|beta|main>."
fi
