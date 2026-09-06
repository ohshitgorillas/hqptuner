#!/usr/bin/env bash
# pair — the two worktrees a /tests run needs, opened and converged in one action each.
#
#   scripts/pair.sh open  <slug> <specfile> [--dry-run]
#   scripts/pair.sh red   <slug> [--dry-run]
#   scripts/pair.sh merge <slug> [-m "<subject>"] [--dry-run]
#   scripts/pair.sh abort <slug>
#   scripts/pair.sh list
#
# The /tests chain writes tests first — by the blind test-writer, for every
# spec, since .claude/hooks/tests-lane.py keeps every other hand off tests/ —
# and implements beside them. They cannot share a tree: the tests tree must contain no implementation
# for the red run to prove anything, and several sessions may be doing this at
# once. So each session gets a PAIR of worktrees off dev's tip:
#
#   .claude/worktrees/<slug>-spec   branch spec/<slug>   tests    tests/ only
#   .claude/worktrees/<slug>-impl   branch impl/<slug>   you      everything but tests/
#
# The main checkout is never an agent workspace — it is the user's.
#
# Like ship.sh, each subcommand is one shell invocation on purpose: the budget
# hook meters tool calls, not work, so open+red+merge costs three actions for a
# chain that would otherwise spend six or more on git alone.
#
# open commits the approved spec block, with the spec-reviewer's READY output,
# as tests/specs/<slug>.txt — the first commit on the spec branch, made before
# any implementation exists. The orchestrator stages it at specs/<slug>.txt
# (gitignored, in-tree, so the write is free) and passes that path. The writer reads the block from that path and a
# reviewer spawned later reads it from git, so neither depends on a brief.
#
# red commits the tests as written, then runs only the files that commit
# added or changed and saves the output. The red commit is the object the
# post-merge test check diffs against: an assertion that differs from it
# after the merge was softened after the bite proof.
#
# merge, in order, touching dev only at the very end:
#   1. lane check   spec tree confined to tests/, impl tree kept out of it
#   2. commit       both trees
#   3. rebase       both branches onto dev if dev moved under them
#   4. combine      impl/<slug> merged into the SPEC tree — tests + code
#   5. make check   in that combined tree; red stops here and dev never sees it
#   6. land         dev fast-forwarded to it, branches and trees removed
#
# Both exits of step 5 print the test-check brief: the test files the spec
# tree wrote, their diff from the red commit, and the saved red output. The
# orchestrator forwards it verbatim to the spec-reviewer; nothing is typed
# into it.
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
  echo "usage: scripts/pair.sh open <slug> <specfile> | red <slug> | merge <slug> [-m subj] | abort <slug> | list   [--dry-run]" >&2
  exit 2
}

# ---- argument parsing -------------------------------------------------------

[ $# -ge 1 ] || usage
CMD=$1; shift
SLUG=""
SPECFILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    -m)        shift; [ $# -gt 0 ] || usage; SUBJECT=$1 ;;
    -*)        usage ;;
    *)         if [ -z "$SLUG" ]; then SLUG=$1
               elif [ "$CMD" = open ] && [ -z "$SPECFILE" ]; then SPECFILE=$1
               else usage; fi ;;
  esac
  shift
done

case "$CMD" in
  open)             [ -n "$SLUG" ] && [ -n "$SPECFILE" ] || usage ;;
  red|merge|abort)  [ -n "$SLUG" ] || usage ;;
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
RED_FILE="$STATE/$SLUG.red"
SPEC_PATH="tests/specs/$SLUG.txt"
SPEC_MSG="spec: $SLUG"
RED_MSG="test: $SLUG red"

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

# Uncommitted work in a tree: staged, unstaged and untracked alike.
#
# Minus the two links link_tooling put there. .gitignore spells those `.venv/`
# and `node_modules/`, and a trailing-slash pattern matches a directory but not
# a symlink to one — so git reports them untracked and the lane check would
# fail every merge on the script's own scaffolding.
dirty_files() {   # dirty_files <tree>
  local tree=$1
  {
    git -C "$tree" diff --name-only HEAD
    git -C "$tree" ls-files --others --exclude-standard
  } | grep -Ev '^(\.venv|node_modules)$' | sort -u
}

# Everything THIS tree wrote — which is not the same as everything it contains.
# Step 4 merges impl/<slug> into the spec branch, so once a combine has run the
# spec branch holds implementation relative to base; diffing against base would
# make the lane check reject the script's own step 4 and wedge every re-run
# after a red gate.
#
# So enumerate the tree's own contribution: files touched by its own non-merge
# commits along its first-parent chain, plus whatever is uncommitted now. A
# combine is a merge commit, so it is skipped, and everything it brought in
# arrived through it and is skipped with it — while a file the writer really
# did author outside tests/ is a plain commit on that chain and still shows.
#
# The chain starts at `merge-base dev HEAD` rather than the recorded base: a
# branch already rebased onto a moved dev is then measured from where it now
# sits, so dev's own commits never read as this tree's work.
tree_files() {   # tree_files <tree>
  local tree=$1 from
  from=$(git -C "$tree" merge-base dev HEAD)
  {
    git -C "$tree" log --first-parent --no-merges --name-only --pretty=format: "$from"..HEAD
    dirty_files "$tree"
  } | grep -Ev '^(\.venv|node_modules|)$' | sort -u
}

# The disjoint-path rule, enforced rather than trusted. It is what makes the
# combine in step 4 conflict-free by construction.
lane_check() {   # lane_check <tree> spec|impl
  local tree=$1 lane=$2 bad
  case "$lane" in
    spec) bad=$(tree_files "$tree" | grep -v '^tests/' || true) ;;
    impl) bad=$(tree_files "$tree" | grep    '^tests/' || true) ;;
  esac
  if [ -z "$bad" ]; then return 0; fi
  echo "  $lane tree wrote outside its lane:" >&2
  printf '    %s\n' $bad >&2
  return 1
}

commit_tree() {   # commit_tree <tree> <message>
  local tree=$1 msg=$2
  # "is there anything here" asks dirty_files, not `status`, so the tooling
  # links do not count as work — and `.gitignore` spells them without a
  # trailing slash, so `add -A -- .` cannot stage them either. It asks about
  # uncommitted work only: on a re-run the last run's commits are already in,
  # and `git commit` with nothing staged would abort the script.
  if [ -z "$(dirty_files "$tree")" ]; then echo "  $tree: nothing to commit"; return 0; fi
  if [ "$DRY" = 1 ]; then echo "  would commit: $tree — $msg"; return 0; fi
  git -C "$tree" add -A -- .
  # pre-commit runs the full gate set here, from inside the worktree; the
  # PYTHONPATH is what points it at this tree's code rather than the main one.
  in_tree "$tree" git commit -m "$msg"
}

# The spec and red commits are found by their subjects, latest first: a
# stage-2 return mid-run lands a second spec commit and then a second red
# commit, and the check diffs against the newest of each.
find_commit() {   # find_commit <tree> <subject>
  git -C "$1" log --first-parent --format=%H --fixed-strings --grep="$2" -1
}

# The test files the spec tree wrote, as its latest red commit holds them:
# every path under tests/ that commit added or changed relative to the spec
# commit, restricted to what a runner can execute. tests/specs/<slug>.txt is
# on that diff after a second spec commit and belongs to neither runner.
red_files() {   # red_files <tree> <spec-commit> <red-commit>
  git -C "$1" diff "$2" "$3" --name-only --diff-filter=AM -- tests/ \
    | grep -E '\.(py|test\.js)$' || true
}

# ---- open -------------------------------------------------------------------

do_open() {
  say "open $SLUG"

  git rev-parse -q --verify dev >/dev/null || die "no dev branch here."
  [ -f "$SPECFILE" ] || die "no spec file at $SPECFILE — write the approved block and the reviewer's READY output there first."
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

  # The approved block lands before anything else does, so the writer and any
  # reviewer spawned later read it from git rather than from a brief.
  run mkdir -p "$SPEC_DIR/tests/specs"
  run cp "$SPECFILE" "$SPEC_DIR/$SPEC_PATH"
  if [ "$DRY" = 1 ]; then echo "  would commit: $SPEC_DIR — $SPEC_MSG"; else commit_tree "$SPEC_DIR" "$SPEC_MSG"; fi
  # commit_tree returns 0 with nothing to commit, which is what an ignore rule
  # swallowing tests/specs/ looks like from here. The writer and every later
  # reviewer read the block from that commit, so its absence is fatal now, not
  # at `red`.
  if [ "$DRY" = 0 ] && [ -z "$(find_commit "$SPEC_DIR" "$SPEC_MSG")" ]; then
    die "no '$SPEC_MSG' commit landed on $SPEC_BR — is $SPEC_PATH ignored? (check \`git check-ignore -v $SPEC_DIR/$SPEC_PATH\`)"
  fi

  cat <<EOF

  base        $(git rev-parse --short "$base") (dev)

  spec tree   $SPEC_DIR
              branch $SPEC_BR — tests are written here, tests/ only.
              No implementation lands here before the merge, so the red run
              in this tree is the bite proof.
              spec block committed at $SPEC_PATH — the writer reads it there.

  impl tree   $IMPL_DIR
              branch $IMPL_BR — implementation, docs, CHANGELOG. Never tests/.

  Run anything in either tree from inside it; the borrowed .venv needs
  PYTHONPATH pointed at the tree or you will test the main checkout's code:

      cd $SPEC_DIR && PYTHONPATH=\$(pwd) .venv/bin/pytest tests/<file> -q

  Red run:        scripts/pair.sh red $SLUG      (commits the tests, then runs them)
  Converge with:  scripts/pair.sh merge $SLUG
EOF
}

# ---- red --------------------------------------------------------------------

# Commit first, then run: the saved output then describes exactly the tests
# the red commit holds, and "differs from the red run" and "differs from the
# red commit" are one claim. Runner exit codes are not the point — red is the
# expected result — so both are captured and neither stops the script.
do_red() {
  say "red $SLUG"

  [ -d "$SPEC_DIR" ] || die "no spec tree at $SPEC_DIR — was this pair opened?"
  local spec_commit
  spec_commit=$(find_commit "$SPEC_DIR" "$SPEC_MSG")
  [ -n "$spec_commit" ] || die "no '$SPEC_MSG' commit on $SPEC_BR — open this pair with a spec file."

  lane_check "$SPEC_DIR" spec || die "the spec tree writes tests/ only."
  commit_tree "$SPEC_DIR" "$RED_MSG"

  if [ "$DRY" = 1 ]; then
    echo "  would run the test files the red commit adds or changes and save the output to $RED_FILE"
    return 0
  fi

  local red_commit files py js
  red_commit=$(find_commit "$SPEC_DIR" "$RED_MSG")
  files=$(red_files "$SPEC_DIR" "$spec_commit" "$red_commit")
  [ -n "$files" ] || die "the red commit adds or changes no test file under tests/."
  py=$(printf '%s\n' "$files" | grep '\.py$' || true)
  js=$(printf '%s\n' "$files" | grep '\.test\.js$' || true)

  {
    echo "red run for $SLUG at $(git -C "$SPEC_DIR" rev-parse --short "$red_commit")"
    printf '%s\n' "$files"
    echo
    if [ -n "$py" ]; then
      # shellcheck disable=SC2086
      in_tree "$SPEC_DIR" .venv/bin/pytest -q --no-cov $py 2>&1 || true
    fi
    if [ -n "$js" ]; then
      # The loader hook resolves the bare vendor specifiers; without it every
      # store-layer test fails to load and the run proves nothing.
      # shellcheck disable=SC2086
      in_tree "$SPEC_DIR" node --import ./tests/js/support/vendor-resolve.js --test $js 2>&1 || true
    fi
  } > "$RED_FILE"

  echo "  red commit  $(git -C "$SPEC_DIR" rev-parse --short "$red_commit")"
  echo "  output      $RED_FILE"
  echo
  echo "  Send that path to the test-writer; its RED/ERROR/GREEN verdict per line is the"
  echo "  bite proof. The output is not printed here on purpose."
}

# The brief the spec-reviewer's post-merge test check consumes. Generated, not
# typed: paths, the diff from the red commit, and the saved red output.
test_check_brief() {   # test_check_brief <tree>
  local tree=$1 spec_commit red_commit
  spec_commit=$(find_commit "$tree" "$SPEC_MSG")
  red_commit=$(find_commit "$tree" "$RED_MSG")
  if [ -z "$red_commit" ]; then
    echo "  no '$RED_MSG' commit on $SPEC_BR — no test check brief; run scripts/pair.sh red first next time." >&2
    return 0
  fi
  echo
  echo "TEST CHECK $SLUG"
  echo "spec  $SPEC_PATH at $(git -C "$tree" rev-parse --short "$spec_commit")"
  echo "red   $(git -C "$tree" rev-parse --short "$red_commit")"
  echo "files"
  red_files "$tree" "$spec_commit" "$red_commit" | sed 's/^/  /'
  echo
  echo "diff from red"
  git -C "$tree" diff "$red_commit" HEAD -- tests/
  echo
  echo "red output"
  cat "$RED_FILE" 2>/dev/null || echo "  (missing: $RED_FILE)"
  echo "END TEST CHECK"
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
  lane_check "$SPEC_DIR" spec || lane_ok=0
  lane_check "$IMPL_DIR" impl || lane_ok=0
  [ "$lane_ok" = 1 ] || die "the lanes are what make this merge conflict-free; move those files to the other tree."
  echo "  spec tree confined to tests/, impl tree clear of it"

  [ -n "$SUBJECT" ] || SUBJECT="$SLUG"

  say "[2/6] commit both trees"
  commit_tree "$SPEC_DIR" "test: $SUBJECT"
  commit_tree "$IMPL_DIR" "$SUBJECT"

  if [ "$DRY" = 1 ]; then
    echo; echo "  (dry run — nothing below is executed)"
    echo "  would: rebase onto dev if moved, merge $IMPL_BR into the spec tree,"
    echo "         make check there, then fast-forward dev and remove both trees."
    return 0
  fi

  # Steps 3-6 read and move the dev tip. Serialize them: a gate run against a
  # stale tip proves nothing, and two sessions landing at once would race.
  mkdir -p "$WT"
  exec 9>"$LOCK"
  echo "  waiting for the pair lock..." >&2
  flock 9

  say "[3/6] rebase onto dev"
  # "Moved" means moved UNDER these branches, which is ancestry, not the
  # recorded base — the same reason tree_files measures from a merge-base. A
  # pair opened while another session's chain was landing sits on a dev tip
  # ahead of its own base file, with nothing to rebase; measured against the
  # base it reads as moved, and the combine guard below then refuses a rebase
  # that was never needed, with no hand step able to clear it.
  local dev_tip spec_point impl_point
  dev_tip=$(git rev-parse dev)
  spec_point=$(git -C "$SPEC_DIR" merge-base dev HEAD)
  impl_point=$(git -C "$IMPL_DIR" merge-base dev HEAD)
  if [ "$dev_tip" = "$spec_point" ] && [ "$dev_tip" = "$impl_point" ]; then
    echo "  dev has not moved under $SLUG"
  else
    echo "  dev moved $(git rev-list --count "$spec_point".."$dev_tip") commit(s) under $SLUG — rebasing both branches"
    # A re-run after a red gate reaches here with step 4's combine already on
    # the spec branch. A plain rebase drops merge commits and replays their
    # side, so it would flatten that combine and duplicate the implementation
    # commits the impl rebase is about to rewrite. Stop instead of corrupting.
    if [ -n "$(git -C "$SPEC_DIR" rev-list --merges "$spec_point"..HEAD)" ]; then
      die "dev moved after $SLUG was already combined; rebasing $SPEC_BR would flatten that merge and duplicate $IMPL_BR's commits. Rebase it by hand in $SPEC_DIR, keeping the combine, and rerun."
    fi
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

A failing test here means the spec and the code disagree. Two ways out, and
you say which before editing anything: the code is wrong, and the fix lands
in $IMPL_DIR; or the spec is wrong, and it goes back to stage 1 with the
same plan reviewer. Tests are not edited to pass. Then rerun this merge.
EOF
    test_check_brief "$SPEC_DIR" >&2
    exit 1
  fi

  # Printed here, while the spec tree still exists; the diff is the same one
  # dev will carry once step 6 fast-forwards to it.
  test_check_brief "$SPEC_DIR"

  say "[6/6] land on dev"
  git merge --ff-only "$SPEC_BR" \
    || die "dev will not fast-forward to $SPEC_BR — the main checkout may have local changes over the same files."
  git worktree remove "$SPEC_DIR"
  git worktree remove "$IMPL_DIR"
  git branch -d "$SPEC_BR" "$IMPL_BR" >/dev/null
  rm -f "$BASE_FILE" "$RED_FILE"

  echo
  echo "  dev is now $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"
  echo "  both worktrees removed. Next: forward the TEST CHECK block above to the"
  echo "  spec-reviewer verbatim, then /task-check, from here."
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
  run rm -f "$BASE_FILE" "$RED_FILE"
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
  red)   do_red ;;
  merge) do_merge ;;
  abort) do_abort ;;
  list)  do_list ;;
esac
