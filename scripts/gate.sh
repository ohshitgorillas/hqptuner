#!/usr/bin/env bash
#
# Run a gate, keep the whole log, print only what decides it.
#
#   scripts/gate.sh make check
#   scripts/gate.sh .venv/bin/pytest -m 'not live' -q
#
# A gate's own output is large and its verdict is small. Piping it into `head`
# throws away the part that says why, and the failing lines are usually not in
# the first or last screen. This keeps every byte in a log file, names the
# path, and prints the matched failure lines instead.
#
# The log lands under $CLAUDE_SCRATCH when the session sets one, and /tmp when
# it does not. Exit status is the wrapped command's own, so a caller chaining
# on `&&` behaves as if the wrapper were not there.

set -uo pipefail

[ $# -ge 1 ] || {
	echo "usage: gate.sh <command> [args...]" >&2
	exit 2
}

#: lines that decide a failing run, in the spellings the gates here use:
#: make's own error line, pytest's FAILED and its summary count, a ruff or
#: cargo-style diagnostic code, and a bare ERROR at the head of a line
FAILURE='make: \*\*\*|FAILED|[0-9]+ failed|error\[|^ERROR'

#: how many matched lines are worth reading before the log itself is
MATCH_LINES=40
#: how much of a green run is worth confirming
TAIL_LINES=3

dir=${CLAUDE_SCRATCH:-/tmp}
mkdir -p "$dir" || {
	echo "gate.sh: cannot create $dir" >&2
	exit 2
}

#: the wrapped command's name in the filename, so a scratch directory holding
#: several runs is readable without opening them
tag=$(basename -- "$1")
tag=${tag//[^A-Za-z0-9._-]/_}

log=$(mktemp "${dir%/}/gate-${tag}-XXXXXXXX.log") || {
	echo "gate.sh: cannot create a log file under $dir" >&2
	exit 2
}

"$@" >"$log" 2>&1
rc=$?

echo "exit=$rc log=$log"

if [ "$rc" -eq 0 ]; then
	tail -n "$TAIL_LINES" "$log"
else
	#: collected before it is printed, because `head` closing the pipe early
	#: makes `grep` exit on SIGPIPE, and under `pipefail` that reads as no match
	matches=$(grep -nE "$FAILURE" "$log" | head -n "$MATCH_LINES")

	#: a failing run with no matched line has failed in a shape this pattern
	#: does not know. Printing nothing there would read as a green run, so the
	#: tail stands in and the log path above is the rest of the answer.
	if [ -n "$matches" ]; then
		printf '%s\n' "$matches"
	else
		tail -n "$TAIL_LINES" "$log"
	fi
fi

exit $rc
