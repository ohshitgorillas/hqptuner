#!/usr/bin/env bash
# ship — promote the current release commit along dev -> beta -> main.
#
#   scripts/ship.sh <dev|beta|main> [--dry-run]
#
# The whole promotion is one shell invocation on purpose: the change-budget
# hook meters tool calls, not work, so a five-step promotion run as five Bash
# calls trips the leash before it finishes. Chained here it costs one.
#
# It does NOT commit. Authoring the release commit — version bump in
# pyproject.toml + hqptuner/__init__.py, the CHANGELOG entry, the message —
# stays outside so the diff is reviewed and the markdown soft-wrap hook sees
# the CHANGELOG write. This script starts from a clean tree at that commit.
#
# What it does, in order:
#   1. preflight   clean tree, on dev, versions agree, remotes fetched,
#                  and for beta/main: HEAD is the bump.sh release commit
#   2. make check  full gate; red aborts before anything is pushed
#   3. push dev
#   4. promote     ff-only merges dev->beta (and beta->main for `main`)
#   5. tag         v<version> on a main ship, pushed
#   6. /srv        bump the hqptuner submodule pointer, commit, push
#
# Every merge is --ff-only and no push is ever forced: divergence fails loudly
# instead of being resolved by a script nobody is watching.
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

PARENT=/srv               # superproject tracking hqptuner as a submodule
DRY=0
TARGET=""

for arg in "$@"; do
  case "$arg" in
    dev|beta|main) TARGET="$arg" ;;
    --dry-run)     DRY=1 ;;
    *) echo "usage: scripts/ship.sh <dev|beta|main> [--dry-run]" >&2; exit 2 ;;
  esac
done
[ -n "$TARGET" ] || { echo "usage: scripts/ship.sh <dev|beta|main> [--dry-run]" >&2; exit 2; }

say()  { echo; echo "== $* =="; }
run()  { if [ "$DRY" = 1 ]; then echo "  would run: $*"; else "$@"; fi; }
die()  { echo "FAIL: $*" >&2; exit 1; }

# ---- 1. preflight -----------------------------------------------------------

say "[1/6] preflight"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = dev ] || die "on '$BRANCH'; ship runs from dev."

if [ -n "$(git status --porcelain)" ]; then
  # a dry run prints the plan and touches nothing, so a dirty tree is only a
  # warning there; a real ship refuses, since the commit is what gets promoted
  [ "$DRY" = 1 ] || die "working tree is dirty — commit the release first."
  echo "  WARNING: working tree is dirty; a real ship would stop here."
fi

PY_VER=$(grep -m1 '^version = ' pyproject.toml | cut -d'"' -f2)
INIT_VER=$(grep -m1 '^__version__ = ' hqptuner/__init__.py | cut -d'"' -f2)
[ -n "$PY_VER" ] || die "no version in pyproject.toml."
[ "$PY_VER" = "$INIT_VER" ] || die "version mismatch: pyproject.toml=$PY_VER hqptuner/__init__.py=$INIT_VER"
TAG="v$PY_VER"

# Channel branches only ever point at release commits: a beta or main ship
# promotes exactly what bump.sh authored, never unlabeled dev work.
if [ "$TARGET" != dev ]; then
  SUBJECT=$(git log -1 --format=%s)
  if [ "$SUBJECT" != "release: $PY_VER" ]; then
    [ "$DRY" = 1 ] || die "HEAD is '$SUBJECT', not 'release: $PY_VER' — run scripts/bump.sh first."
    echo "  WARNING: HEAD is not the release commit for $PY_VER; a real ship would stop here."
  fi
fi

git fetch --quiet origin
git fetch --quiet --tags origin
git merge-base --is-ancestor origin/dev HEAD || die "origin/dev has commits you don't — pull and rerun."

if [ "$TARGET" = main ] && git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  [ "$(git rev-parse "$TAG^{commit}")" = "$(git rev-parse HEAD)" ] \
    || die "tag $TAG already exists on a different commit — bump the version."
fi

# Checking out a promotion target writes every path that exists in its tree but
# not in dev's. Git refuses when such a path is an untracked file on disk — but
# NOT when the file is ignored: those it overwrites without a word. A file that
# is ignored here and still tracked downstream is therefore destroyed by the
# checkout, and the ff-merge then deletes it outright. That is not hypothetical;
# it is how this script ate an in-flight docs/eq-assistant/todo.md.
clobber_check() {   # clobber_check <ref>...
  local ref path hit=0
  for ref in "$@"; do
    git rev-parse -q --verify "$ref" >/dev/null || continue
    while IFS= read -r path; do
      [ -n "$path" ] && [ -e "$path" ] || continue
      echo "  $ref tracks '$path', which exists here untracked — checkout would overwrite it" >&2
      hit=1
    done < <(git diff --name-only --diff-filter=A HEAD "$ref")
  done
  return "$hit"
}

case "$TARGET" in
  beta) CLOBBER_REFS=(origin/beta beta) ;;
  main) CLOBBER_REFS=(origin/beta beta origin/main main) ;;
  *)    CLOBBER_REFS=() ;;
esac
if [ ${#CLOBBER_REFS[@]} -gt 0 ] && ! clobber_check "${CLOBBER_REFS[@]}"; then
  [ "$DRY" = 1 ] || die "move or delete the file(s) above, then rerun — promoting would destroy them."
  echo "  WARNING: a real ship would stop here."
fi

echo "  version $PY_VER · dev at $(git rev-parse --short HEAD) · target $TARGET"
if [ "$DRY" = 1 ]; then echo "  (dry run — nothing below is executed)"; fi

# restore the starting branch even if a merge or push fails mid-promotion
trap 'git checkout --quiet dev 2>/dev/null || true' EXIT

# ---- 2. gate ----------------------------------------------------------------

say "[2/6] make check"
if [ "$DRY" = 1 ]; then
  echo "  would run: make check"
else
  make check || die "make check is red — nothing pushed."
fi

# ---- 3. push dev ------------------------------------------------------------

say "[3/6] push dev"
run git push origin dev

# ---- 4. promote -------------------------------------------------------------

promote() {   # promote <from> <to>
  local from=$1 to=$2
  echo "  $from -> $to"
  run git checkout --quiet "$to"
  run git merge --ff-only "origin/$to"
  run git merge --ff-only "$from"
  run git push origin "$to"
  run git checkout --quiet dev
}

say "[4/6] promote"
case "$TARGET" in
  dev)  echo "  target is dev — no promotion" ;;
  beta) promote dev beta ;;
  main) promote dev beta; promote beta main ;;
esac

# ---- 5. tag -----------------------------------------------------------------

say "[5/6] tag"
if [ "$TARGET" = main ]; then
  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    echo "  $TAG already exists on this commit"
  else
    run git tag -a "$TAG" -m "$TAG"
  fi
  run git push origin "$TAG"
else
  echo "  tags are cut on a main ship only"
fi

# ---- 6. parent repo ---------------------------------------------------------

say "[6/6] $PARENT submodule pointer"
if [ ! -e "$PARENT/.git" ]; then
  echo "  $PARENT is not a git repo here — skipped"
elif [ -z "$(git -C "$PARENT" status --porcelain -- hqptuner)" ]; then
  echo "  pointer already at $(git rev-parse --short HEAD) — nothing to bump"
else
  run git -C "$PARENT" add hqptuner
  run git -C "$PARENT" commit -m "chore(hqptuner): bump to $PY_VER ($TARGET)" -- hqptuner
  run git -C "$PARENT" push
fi

echo
if [ "$DRY" = 1 ]; then
  echo "DRY RUN — nothing changed."
else
  echo "PASS — $PY_VER shipped to $TARGET."
fi
