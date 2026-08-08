#!/usr/bin/env bash
# pair — the two worktrees a /tests run needs, opened and converged in one action each.
#
#   scripts/pair.sh open  <slug>
#   scripts/pair.sh merge <slug> [-m "<subject>"] [--dry-run]
#   scripts/pair.sh abort <slug>
#   scripts/pair.sh list
#
# The /tests chain runs the blind test-writer and the implementer concurrently.
# They cannot share a tree: the writer's tree must contain no implementation for
# the red run to prove anything, and several sessions may be doing this at once.
# So each session gets a PAIR of worktrees off dev's tip:
#
#   .claude/worktrees/<slug>-spec   branch spec/<slug>   writer   tests/ only
#   .claude/worktrees/<slug>-impl   branch impl/<slug>   you      everything but tests/
#
# The main checkout is never an agent workspace — it is the user's.
#
# Like ship.sh, each subcommand is one shell invocation on purpose: the budget
# hook meters tool calls, not work, so open+merge costs two actions for a chain
# that would otherwise spend four or five on git alone.
#
# merge, in order, touching dev only at the very end:
#   1. lane check   spec tree confined to tests/, impl tree kept out of it
#   2. commit       both trees
#   3. rebase       both branches onto dev if dev moved under them
#   4. combine      impl/<slug> merged into the SPEC tree — tests + code
#   5. make check   in that combined tree; red stops here and dev never sees it
#   6. land         dev fast-forwarded to it, branches and trees removed
#
# Steps 3-6 hold a lock, so two sessions merging at once queue instead of
# racing the dev tip. Every merge is --ff-only; nothing is ever force-pushed.
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root
ROOT=$(pwd)

WT="$ROOT/.claude/worktrees"
STATE="$WT/.pair-state"
LOCK="$WT/.pair.lock"

DRY=0
SUBJECT=""

say()  { echo; echo "== $* =="; }
run()  { if [ "$DRY" = 1 ]; then echo "  would run: $*"; else "$@"; fi; }
die()  { echo "FAIL: $*" >&2; exit 1; }

usage() {
  echo "usage: scripts/pair.sh open <slug> | merge <slug> [-m subj] [--dry-run] | abort <slug> | list" >&2
  exit 2
}

# ---- argument parsing -------------------------------------------------------

[ $# -ge 1 ] || usage
CMD=$1; shift
SLUG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    -m)        shift; [ $# -gt 0 ] || usage; SUBJECT=$1 ;;
    -*)        usage ;;
    *)         [ -z "$SLUG" ] || usage; SLUG=$1 ;;
  esac
  shift
done

case "$CMD" in
  open|merge|abort) [ -n "$SLUG" ] || usage ;;
  list)             [ -z "$SLUG" ] || usage ;;
  *)                usage ;;
esac

# A slug names two branches and two directories. Keep it boring.
if [ -n "$SLUG" ] && ! printf '%s' "$SLUG" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
  die "slug '$SLUG' — lowercase letters, digits and dashes only."
fi

SPEC_DIR="$WT/$SLUG-spec"
IMPL_DIR="$WT/$SLUG-impl"
SPEC_BR="spec/$SLUG"
IMPL_BR="impl/$SLUG"
BASE_FILE="$STATE/$SLUG.base"

# ---- helpers ----------------------------------------------------------------

# The gates all shell out to `.venv/bin/...` and `npx`, both resolved relative
# to the tree they run in. A fresh worktree has neither, so pre-commit and
# `make check` would die there. Borrowing the main checkout's is enough: they
# are read-only in use, and PYTHONPATH (below) is what decides which copy of
# hqptuner actually gets imported.
link_tooling() {   # link_tooling <tree>
  local tree=$1 dep
  for dep in .venv node_modules; do
    [ -e "$ROOT/$dep" ] || continue
    [ -e "$tree/$dep" ] || ln -s "$ROOT/$dep" "$tree/$dep"
  done
}

# The borrowed .venv has hqptuner installed editable, pointing at the MAIN
# checkout — so without this, a worktree's suite silently tests the wrong code.
# PYTHONPATH is searched ahead of site-packages, so the worktree wins.
in_tree() {   # in_tree <tree> <cmd>...
  local tree=$1; shift
  ( cd "$tree" && PYTHONPATH="$tree" "$@" )
}

# Everything this tree has changed since it was cut: committed, staged,
# unstaged and untracked alike.
#
# Minus the two links link_tooling put there. .gitignore spells those `.venv/`
# and `node_modules/`, and a trailing-slash pattern matches a directory but not
# a symlink to one — so git reports them untracked and the lane check would
# fail every merge on the script's own scaffolding.
tree_files() {   # tree_files <tree> <base>
  local tree=$1 base=$2
  {
    git -C "$tree" diff --name-only "$base"
    git -C "$tree" ls-files --others --exclude-standard
  } | grep -Ev '^(\.venv|node_modules)$' | sort -u
}

# The disjoint-path rule, enforced rather than trusted. It is what makes the
# combine in step 4 conflict-free by construction.
lane_check() {   # lane_check <tree> <base> spec|impl
  local tree=$1 base=$2 lane=$3 bad
  case "$lane" in
    spec) bad=$(tree_files "$tree" "$base" | grep -v '^tests/' || true) ;;
    impl) bad=$(tree_files "$tree" "$base" | grep    '^tests/' || true) ;;
  esac
  if [ -z "$bad" ]; then return 0; fi
  echo "  $lane tree wrote outside its lane:" >&2
  printf '    %s\n' $bad >&2
  return 1
}

commit_tree() {   # commit_tree <tree> <base> <message>
  local tree=$1 base=$2 msg=$3
  # "is there anything here" asks tree_files, not `status`, so the tooling
  # links do not count as work — and `.gitignore` spells them without a
  # trailing slash, so `add -A -- .` cannot stage them either.
  if [ -z "$(tree_files "$tree" "$base")" ]; then echo "  $tree: nothing to commit"; return 0; fi
  if [ "$DRY" = 1 ]; then echo "  would commit: $tree — $msg"; return 0; fi
  git -C "$tree" add -A -- .
  # pre-commit runs the full gate set here, from inside the worktree; the
  # PYTHONPATH is what points it at this tree's code rather than the main one.
  in_tree "$tree" git commit -m "$msg"
}

# ---- open -------------------------------------------------------------------

do_open() {
  say "open $SLUG"

  git rev-parse -q --verify dev >/dev/null || die "no dev branch here."
  local d b
  for d in "$SPEC_DIR" "$IMPL_DIR"; do
    if [ -e "$d" ]; then die "$d already exists — pick another slug, or abort that pair."; fi
  done
  for b in "$SPEC_BR" "$IMPL_BR"; do
    if git rev-parse -q --verify "$b" >/dev/null; then die "branch $b already exists."; fi
  done

  # dev's committed tip, deliberately — not the main checkout's working tree.
  # Uncommitted work in the user's checkout is theirs and does not come along.
  local base
  base=$(git rev-parse dev)

  if [ -n "$(git status --porcelain)" ]; then
    echo "  note: main checkout is dirty; these trees start from committed dev ($(git rev-parse --short dev))."
  fi

  run mkdir -p "$STATE"
  run git worktree add --quiet -b "$SPEC_BR" "$SPEC_DIR" "$base"
  run git worktree add --quiet -b "$IMPL_BR" "$IMPL_DIR" "$base"
  if [ "$DRY" = 0 ]; then
    printf '%s\n' "$base" > "$BASE_FILE"
    link_tooling "$SPEC_DIR"
    link_tooling "$IMPL_DIR"
  fi

  cat <<EOF

  base        $(git rev-parse --short "$base") (dev)

  spec tree   $SPEC_DIR
              branch $SPEC_BR — test-writer works here, tests/ only.
              No implementation lands here before the merge, so the red run
              in this tree is the bite proof.

  impl tree   $IMPL_DIR
              branch $IMPL_BR — implementation, docs, CHANGELOG. Never tests/.

  Run anything in either tree from inside it; the borrowed .venv needs
  PYTHONPATH pointed at the tree or you will test the main checkout's code:

      cd $SPEC_DIR && PYTHONPATH=\$(pwd) .venv/bin/pytest tests/<file> -q

  Converge with:  scripts/pair.sh merge $SLUG
EOF
}

# ---- merge ------------------------------------------------------------------

do_merge() {
  say "[1/6] lane check"

  [ -d "$SPEC_DIR" ] || die "no spec tree at $SPEC_DIR — was this pair opened?"
  [ -d "$IMPL_DIR" ] || die "no impl tree at $IMPL_DIR — was this pair opened?"
  [ -f "$BASE_FILE" ] || die "no recorded base for $SLUG — open it with pair.sh so the lane check has something to diff against."
  local base
  base=$(cat "$BASE_FILE")

  local lane_ok=1
  lane_check "$SPEC_DIR" "$base" spec || lane_ok=0
  lane_check "$IMPL_DIR" "$base" impl || lane_ok=0
  [ "$lane_ok" = 1 ] || die "the lanes are what make this merge conflict-free; move those files to the other tree."
  echo "  spec tree confined to tests/, impl tree clear of it"

  [ -n "$SUBJECT" ] || SUBJECT="$SLUG"

  say "[2/6] commit both trees"
  commit_tree "$SPEC_DIR" "$base" "test: $SUBJECT"
  commit_tree "$IMPL_DIR" "$base" "$SUBJECT"

  if [ "$DRY" = 1 ]; then
    echo; echo "  (dry run — nothing below is executed)"
    echo "  would: rebase onto dev if moved, merge $IMPL_BR into the spec tree,"
    echo "         make check there, then fast-forward dev and remove both trees."
    return 0
  fi

  # Steps 3-6 read and move the dev tip. Serialise them: a gate run against a
  # stale tip proves nothing, and two sessions landing at once would race.
  mkdir -p "$WT"
  exec 9>"$LOCK"
  echo "  waiting for the pair lock..." >&2
  flock 9

  say "[3/6] rebase onto dev"
  local dev_tip
  dev_tip=$(git rev-parse dev)
  if [ "$dev_tip" = "$base" ]; then
    echo "  dev has not moved since $SLUG was opened"
  else
    echo "  dev moved $(git rev-list --count "$base".."$dev_tip") commit(s) since branch point — rebasing both branches"
    git -C "$IMPL_DIR" rebase --quiet dev || die "$IMPL_BR does not rebase onto dev cleanly — resolve it in $IMPL_DIR and rerun."
    git -C "$SPEC_DIR" rebase --quiet dev || die "$SPEC_BR does not rebase onto dev cleanly — resolve it in $SPEC_DIR and rerun."
  fi

  say "[4/6] combine in the spec tree"
  git -C "$SPEC_DIR" merge --no-ff --no-edit "$IMPL_BR" \
    || die "merging $IMPL_BR into $SPEC_BR conflicted — the lanes should have prevented this; resolve in $SPEC_DIR."
  echo "  $SPEC_DIR now holds the tests and the implementation"

  say "[5/6] make check"
  if ! in_tree "$SPEC_DIR" make check; then
    cat >&2 <<EOF

FAIL: the gate is red in the combined tree. dev is untouched and both trees
are left exactly as they are.

  combined tree   $SPEC_DIR

A failing test here means the spec and the code disagree. Adjudicate it — say
which of the three it is before editing anything — then rerun this merge.
EOF
    exit 1
  fi

  say "[6/6] land on dev"
  git merge --ff-only "$SPEC_BR" \
    || die "dev will not fast-forward to $SPEC_BR — the main checkout may have local changes over the same files."
  git worktree remove "$SPEC_DIR"
  git worktree remove "$IMPL_DIR"
  git branch -d "$SPEC_BR" "$IMPL_BR" >/dev/null
  rm -f "$BASE_FILE"

  echo
  echo "  dev is now $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"
  echo "  both worktrees removed. Next: test-reviewer and /task-check, from here."
}

# ---- abort ------------------------------------------------------------------

do_abort() {
  say "abort $SLUG"
  local gone=0
  for d in "$SPEC_DIR" "$IMPL_DIR"; do
    [ -d "$d" ] || continue
    run git worktree remove --force "$d"
    gone=1
  done
  for b in "$SPEC_BR" "$IMPL_BR"; do
    git rev-parse -q --verify "$b" >/dev/null || continue
    run git branch -D "$b"
    gone=1
  done
  run rm -f "$BASE_FILE"
  [ "$gone" = 1 ] || echo "  nothing to abort — no trees or branches for $SLUG"
}

# ---- list -------------------------------------------------------------------

do_list() {
  [ -d "$STATE" ] || { echo "no open pairs"; return 0; }
  local found=0 f slug base behind
  for f in "$STATE"/*.base; do
    [ -e "$f" ] || continue
    found=1
    slug=$(basename "$f" .base)
    base=$(cat "$f")
    behind=$(git rev-list --count "$base"..dev 2>/dev/null || echo "?")
    echo "$slug"
    echo "  base    $(git rev-parse --short "$base" 2>/dev/null || echo "$base")  ($behind commit(s) behind dev)"
    echo "  spec    $WT/$slug-spec"
    echo "  impl    $WT/$slug-impl"
  done
  [ "$found" = 1 ] || echo "no open pairs"
}

case "$CMD" in
  open)  do_open ;;
  merge) do_merge ;;
  abort) do_abort ;;
  list)  do_list ;;
esac
