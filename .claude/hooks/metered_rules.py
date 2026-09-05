#!/usr/bin/env python3
"""Why a call metered, and the standing rule it walked into.

read-volume.py prints `Budget: N/8 (metered: <token>)` after every metered
call. That line answers "what did this cost", and the token answers "what
decided it". Neither answers "what should I have done instead", which is the
only one of the three that changes the next command.

So a second clause rides the same line when the call matches a shape the
project has already ruled on. The rules here are not advice in general; each
one is a standing ruling that was written down, ignored at the keystroke, and
paid for. A shape earns an entry by having actually misfired.

The clause is appended after the charge, not before it — this module is
reached from a PostToolUse hook and cannot stop anything. It exists to kill the
second offense, which is where the observed cost was: a repeated merge, a
second worktree write. The first one is memory's job.

Lives beside read-volume.py rather than inside it because that file sits at its
length-ratchet allowance (scripts/gates/check_file_length.py) and the ratchet
does not rise. why_metered() moved here with the table for the same reason, and
because the two answers belong to one question.
"""
import os
import re
import shlex

# the same splitter read-volume.py uses on a command's segments; a rule that
# read a command differently from the file that calls it would be a second
# parser to keep in step
SEGMENT = re.compile(r"&&|\|\||;|\|")

INTERPRETERS = {"bash", "sh", "zsh"}

MERGE_RULE = ("a failed merge leaves the combined tree standing — gate it there "
              "with `make check`, which is free; re-running merge to diagnose "
              "costs another action and reports the same failure")


def _pair_merge(command):
    """True when some segment of `command` runs `pair.sh merge`.

    The token is matched by basename, so a path invocation matches, and it is
    read at the segment head or directly after an interpreter, so a `pair.sh`
    that appears mid-segment — inside a quoted argument, say, which SEGMENT
    splits through because it is not quote-aware — does not. Only the first
    non-flag token after it counts, so `merge` later in the arguments does not
    match either.
    """
    for segment in SEGMENT.split(command or ""):
        try:
            tokens = shlex.split(segment, comments=False, posix=True)
        except ValueError:
            tokens = segment.split()
        if tokens and os.path.basename(tokens[0]) in INTERPRETERS:
            tokens = tokens[1:]
        if not tokens or os.path.basename(tokens[0]) != "pair.sh":
            continue
        rest = [t for t in tokens[1:] if not t.startswith("-")]
        if rest and rest[0] == "merge":
            return True
    return False


def rule_for(name, tool_input):
    """The standing rule this metered call walked into, or None.

    One entry, deliberately. A rule earns a place here by having misfired at a
    real cost, and by being true: writes under .claude/worktrees/ were the other
    candidate and are not in, because they resolve inside the repo root and
    classify as free in-tree edits, so the rule would have been false.
    """
    tool_input = tool_input or {}
    if name == "Bash" and _pair_merge(tool_input.get("command", "")):
        return MERGE_RULE
    return None


def why_metered(name, tool_input, budget):
    """A few words naming what made this call cost an action.

    For Bash the allowlist parser answers; for the other tools the class itself
    is the answer, and naming the tool is what makes the charge legible — an
    agent that reads "Agent(general-purpose)" knows to reach for Explore next
    time, where a bare count teaches nothing.
    """
    if name == "Bash":
        return budget.reason_metered(tool_input.get("command", ""))
    if name == "Agent":
        return f"Agent({tool_input.get('subagent_type')}) not a read-only type"
    if name in budget.EDIT_TOOLS:
        return f"{name} outside the working tree"
    return f"{name} not on the free list"
