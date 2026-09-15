#!/usr/bin/env bash
#
# The whole shell of a blind agent, in three subcommands.
#
#   blind.sh test <path>             run the suite and the mechanical gates
#   blind.sh status <slug>           is that block's approved spec committed
#   blind.sh show <commit> <slug>    print that block's approved spec
#
# `.claude/hooks/blind-bash.py` denies the gauntlet-scrivener and the
# gauntlet-bailiff every command but these, matching the whole command text
# against one anchored pattern per subcommand. This script is the other half:
# the hook decides nothing about what a subcommand does, and this file offers
# no way to say anything the hook did not already admit.
#
# Every subcommand runs under `bwrap` with the whole filesystem read-only,
# because a blind agent's one command is not a way to write. The exception is
# the agent's own lane: a `test` run binds the tree's `tests/` back writable,
# which is the directory `tests-lane.py` already lets that agent write.
#
# It does not mask the implementation. A test run needs the code it tests on
# disk, and a mask turns the suite into a collect error, which separates
# nothing. The blindness that holds here is the blindness `no-impl-reads.py`
# holds: the agent cannot read the implementation, and cannot type a command
# that prints it.
#
# A slug names its worktree. `.claude/worktrees/<slug>-spec` is where a block's
# writer works, so `status` and `show` answer from that tree when it exists and
# from the main checkout when it does not. The tree's HEAD is the HEAD those
# two questions are about.

set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
	echo "blind.sh: not inside a git checkout" >&2
	exit 2
}
cd "$ROOT" || exit 2

die() {
	echo "blind.sh: $1" >&2
	exit 2
}

usage() {
	echo "usage: blind.sh test <path> | status <slug> | show <commit> <slug>" >&2
	exit 2
}

#: the worktree a slug names, or the main checkout when it has none
tree_for_slug() {
	local wt=$ROOT/.claude/worktrees/$1-spec
	if [ -d "$wt" ]; then echo "$wt"; else echo "$ROOT"; fi
}

#: whole filesystem read-only, a private /tmp for whatever a tool caches, and
#: no view of any process outside. Extra arguments bind a path back writable.
sandbox() {
	bwrap \
		--ro-bind / / \
		--dev /dev \
		--proc /proc \
		--tmpfs /tmp \
		--tmpfs /run/user \
		--unshare-pid \
		--die-with-parent \
		"$@"
}

#: the values of `.claude/hooks/blind-reads.json`, through the same reader
#: the hooks use, so the lane this script binds writable is the lane
#: `tests-lane.py` guards and the block it shows is the one `specs-lane.py` holds
READER=$ROOT/.claude/hooks/shell_shapes.py
cfg() {
	[ -f "$READER" ] || die "no $READER: scripts/ ships with .claude/hooks/, copy both"
	python3 "$READER" --config "$1"
}
SPECS=$(cfg specs_lane) || die "cannot read the approved-specs lane"

#: one configured runner invocation into an array, one word per line, so an
#: argument carrying a space stays one argument. A word with a slash is a path
#: in this checkout and is read from $ROOT: the run happens with the tree as its
#: working directory, and a bare word is left alone because it is on PATH.
read_runner() {
	local -n words=$1
	words=()
	local line
	while IFS= read -r line; do words+=("$line"); done < <(cfg "$2")
	[ ${#words[@]} -gt 0 ] || die "cannot read the $2 runner"
	case ${words[0]} in
	/*) ;;
	*/*) words[0]=$ROOT/${words[0]} ;;
	esac
}

cmd_test() {
	[ $# -eq 1 ] || usage
	local path=$1 tree=$ROOT rel=$1 status=0 ran=0 tests ext
	tests=$(cfg tests_dir)

	#: a path into a spec worktree names the tree it runs in; anything else is
	#: the main checkout, and the hook admits no third shape
	if [[ $path == .claude/worktrees/*-spec/* ]]; then
		tree=$ROOT/${path%%/$tests/*}
		rel=$tests/${path#*/$tests/}
	fi
	[ -f "$tree/$rel" ] || die "no such test file: $path"

	run_gate() {
		local label=$1
		shift
		if [ ! -x "$1" ] && ! command -v "$1" >/dev/null 2>&1; then
			echo "SKIP  $label  (not installed)"
			return 0
		fi
		echo "--- $label"
		sandbox --bind "$tree/$tests" "$tree/$tests" \
			env -C "$tree" PYTHONPATH="$tree" PYTHONDONTWRITEBYTECODE=1 "$@"
		local rc=$?
		ran=1
		[ $rc -eq 0 ] || status=1
		return 0
	}

	#: the runner for this file's extension, then the lint gates. The runner is
	#: `pytest_command` or `node_command` from `blind-reads.json`, so a project
	#: that deselects a marker or imports a loader names it there rather than
	#: here; the path and the flags below it are this script's own.
	local -a runner
	ext=${rel##*.}
	if [ "$ext" = py ]; then
		read_runner runner pytest_command
		run_gate pytest "${runner[@]}" "$rel" -q -p no:cacheprovider
		run_gate ruff "$ROOT/.venv/bin/ruff" check "$tests"
		run_gate black "$ROOT/.venv/bin/black" --check "$tests"
	else
		read_runner runner node_command
		run_gate node "${runner[@]}" "$rel"
		run_gate eslint npx eslint "$rel"
	fi

	[ "$ran" -eq 1 ] || die "no gate for $path is installed, so nothing ran"
	return $status
}

cmd_status() {
	[ $# -eq 1 ] || usage
	local tree
	tree=$(tree_for_slug "$1")
	sandbox env -C "$tree" git status --porcelain "$SPECS/$1.txt"
}

cmd_show() {
	[ $# -eq 2 ] || usage
	local tree
	tree=$(tree_for_slug "$2")
	sandbox env -C "$tree" git show "$1:$SPECS/$2.txt"
}

[ $# -ge 1 ] || usage
sub=$1
shift
case $sub in
test) cmd_test "$@" ;;
status) cmd_status "$@" ;;
show) cmd_show "$@" ;;
*) usage ;;
esac
