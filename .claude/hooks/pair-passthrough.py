#!/usr/bin/env python3
"""The one carve-out from the sandbox: `scripts/pair.sh`.

`pair.sh` writes lane files by design -- it is the route by which a lane file
changes on disk -- so it must run unwrapped, and something has to decide that.
This module is that decision and nothing else. `bwrap-wrap.py` imports it and
returns no `updatedInput` where it answers yes.

It is a module rather than a second hook entry ahead of the wrapper. Hook
entries under one matcher run in parallel and do not chain: every entry receives
the original `tool_input`, no entry sees another's `updatedInput`, and two
entries both returning one would race. An ordered carve-out therefore has no
mechanism to mark a call for a hook that has already answered.

Its own file rather than a branch inside the wrapper, because a wrapper that
decided for itself which commands to skip would be a classifier again under a
new name. What lives here is the opposite of a classifier: a closed set of
anchored whole-string patterns, one per subcommand, with nothing to extend as
new commands appear. It never walks a command apart and never judges its pieces.

The match is end to end, and that is the whole of its safety. A predicate that
searched for `scripts/pair.sh` anywhere in the command would answer yes for
`scripts/pair.sh red demo; rm -rf state`, and that second command would then run
outside the sandbox -- the one place in this design where a command does. A
command in front, a command behind, an environment assignment, a redirection, a
`cd` first: none of them match, so all of them get wrapped.

The argument grammar is the other half. A slug is one path segment carrying no
traversal, so `scripts/pair.sh red ../../etc` is not a `pair.sh` call this
module admits, and it goes through the sandbox like any other command.
"""

from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell_shapes as sh  # noqa: E402

ENTRY = "scripts/pair.sh"

#: the subcommands that write a lane file, each taking one slug
SUBCOMMANDS = ("open", "red", "merge")

#: a slug names a file inside a lane directory, so it is one path segment and
#: carries no traversal, the same shape every other lane check uses
SLUG = sh.SLUG

ALLOWED = tuple(
    re.compile(rf"\A\s*{re.escape(ENTRY)}\s+{sub}\s+{SLUG}\s*\Z") for sub in SUBCOMMANDS
)


def is_pair_command(command: str) -> bool:
    """Whether the whole command text is one `pair.sh` subcommand call.

    False for everything else, which is the direction that costs a wrap rather
    than an escape: a command this answers no about still runs, inside `bwrap`.
    """
    if ".." in command:
        return False
    return any(pattern.match(command) for pattern in ALLOWED)


def self_test() -> int:
    """Pin the whole-string match and the slug grammar."""
    lines = {
        "one whole subcommand call, for each subcommand": all(
            is_pair_command(f"{ENTRY} {sub} demo") for sub in SUBCOMMANDS
        ),
        "a second command appended does not match": not any(
            is_pair_command(f"{ENTRY} red demo{tail}")
            for tail in ("; rm -rf state", " && rm -rf state", " | tee x", " > out.txt")
        ),
        "a command or an assignment in front does not match": not any(
            is_pair_command(head + f"{ENTRY} red demo")
            for head in ("cd /tmp && ", "GAUNTLET=off ", "echo hi; ", "time ")
        ),
        "a slug that walks out of its directory does not match": not any(
            is_pair_command(f"{ENTRY} red {arg}")
            for arg in ("../../etc", "a/b", "../demo", ".", "..")
        ),
        "a subcommand this module does not name does not match": not any(
            is_pair_command(f"{ENTRY} {sub} demo")
            for sub in ("restore", "close", "impl", "status", "")
        ),
        "a missing or extra argument does not match": not any(
            is_pair_command(c)
            for c in (ENTRY, f"{ENTRY} red", f"{ENTRY} red demo extra", f"{ENTRY} demo")
        ),
        "an entry path that only contains ours does not match": not any(
            is_pair_command(c)
            for c in (f"x{ENTRY} red demo", f"/opt/{ENTRY} red demo", f"./{ENTRY} red demo")
        ),
    }
    return sh.report(lines)


if __name__ == "__main__":
    sys.exit(self_test())
