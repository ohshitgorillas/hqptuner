#!/usr/bin/env python3
"""The owner's off switch, in its three voices.

`GAUNTLET=off claude` starts a session with the seven lane hooks silent and the
`Stop` gate silent. The switch itself is `bypassed()` in `shell_shapes.py`, read
at the top of each hook's `main()`; this file is what the switch says out loud
and what keeps it out of the hands of the session it governs.

One file rather than three, because all three behaviours are the same one-line
question asked of the same variable, and splitting them would put three copies
of that question in the tree.

  * `--session-start`  silent when the gauntlet is on; a banner when it is off,
    naming the seven hooks, the `Stop` gate, and the plain statement that
    nothing in `gauntlet/` is protected from any hand.
  * `--prompt`         emits on every turn either way. Gauntlet on: the
    never-propose rule, stated absolutely. Gauntlet off: the standing notice
    that the chain is not running, so the banner is not the only thing keeping
    the state in view thirty turns deep.
  * `--bash`           a `PreToolUse` hook, live only when the gauntlet is on
    and silent when it is off. It denies a `GAUNTLET=` assignment and a nested
    `claude` invocation. The bypass belongs to the hand that launches the
    session and to no hand inside it.

Neither `--bash` test is a substring search over the command text. The
assignment test is for a `GAUNTLET=` *word*: a leading assignment on a segment,
or an argument to `export`, `set` or `env`. The `claude` test is on the *head
word* of a segment, after any leading assignments and any wrapper (`env`,
`nohup`, `timeout`, `xargs`) are stepped over. A head-word test rather than a
text match because the commands this repository documents carry the string
`claude` inside a path: `python3 .claude/hooks/<name>.py --self-test` is nine
lines of `README.md`. Matching text would deny the repository's own documented
commands; matching the head word denies `claude -p ...`, `env GAUNTLET=off
claude` and `nohup claude` and lets every `.claude/` path through. The reading
it gives up is a `claude` reached through a shell it cannot see into --
`bash -c 'claude'`, a wrapper script named something else -- which is the same
bound every other shape test in `shell_shapes` carries.

Both halves of the denial are needed and neither is redundant. A bare
`GAUNTLET=off` prefix on a shell command does not in fact disarm anything:
hooks run in the Claude Code process's environment, not in the environment of a
`Bash` tool call. It is denied because the combination that does work is
`GAUNTLET=off claude`, and denying the two halves separately means no spelling
of the pair gets through -- an `export` on one line and a bare `claude` on the
next, an `env GAUNTLET=off`, a `claude` behind `nohup` or `timeout`.

The `--self-test` sets the value it is testing explicitly for each case and
never reads the ambient variable to decide what to assert, so a developer
running it under `GAUNTLET=off` gets the same output as one running it with the
variable unset. That property is itself one of the lines it pins, and it is
`docs/testing.md:67` rule 16 being obeyed rather than bent.
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell_shapes as sh  # noqa: E402

VAR = "GAUNTLET"
OFF = "off"

#: commands that carry another command as their argument. The head word we want
#: is the first word that is not one of these and not an assignment.
WRAPPERS = ("env", "nohup", "timeout", "xargs")

#: `timeout` takes a duration before the command it wraps, and every wrapper
#: takes options of its own. Neither is the head word we are after.
_DURATION = re.compile(r"\A[0-9]+(?:\.[0-9]+)?[smhd]?\Z")

#: the seven hooks the switch silences, by the name a reader sees in the tree
SILENCED = (
    "specs-lane.py",
    "plans-lane.py",
    "tests-lane.py",
    "reviews-lane.py",
    "verdicts-lane.py",
    "no-impl-reads.py",
    "blind-bash.py",
)

BANNER = (
    "GAUNTLET=off -- the chain is not running in this session.\n"
    "Silent: " + ", ".join(SILENCED) + ", and the `Stop` gate "
    "(`verdicts-lane.py --stop`), which no longer holds a turn open for an "
    "unruled red run.\n"
    "Nothing under `gauntlet/` is protected from any hand, this agent's "
    "included. A blind subagent spawned in this session is not blind: it can "
    "read the implementation and run any shell command.\n"
    "The chain is for work done under the chain. A session with the gauntlet "
    "off should not run it: an approved spec block written here was reviewed "
    "by an agent that could read the code, and it lands in a tracked file "
    "indistinguishable from one produced under the chain."
)

NOTICE = (
    "GAUNTLET=off is in force: the seven lane hooks and the `Stop` gate are "
    "silent this session -- the chain is not running. Any write into `gauntlet/` "
    "will be allowed whoever "
    "makes it, and no blind agent is blind. Artifacts produced here are not "
    "evidence of anything."
)

RULE = (
    "You may never propose the gauntlet bypass. Do not set GAUNTLET, do not "
    "suggest the owner set it, and do not name it as an option -- not to "
    "unblock yourself, not to save a turn, not as one alternative among "
    "several. The rule has no exception and no cost/benefit case attached to "
    "it, because a rule an agent can argue its way past is a rule the agent "
    "will argue its way past on the one turn it matters. The switch belongs "
    "to the hand that launches the session."
)

_WHY_ASSIGN = (
    "This command carries a `" + VAR + "=` assignment. That variable is the owner's "
    "gauntlet switch, set on the shell that launches `claude` and nowhere else. An "
    "agent inside a running session does not reach it. (hooks/gauntlet-off.py)"
)
_WHY_NESTED = (
    "This command invokes `claude`. A nested session is the one place the gauntlet "
    "switch could be set from inside a session that has it on, so the invocation is "
    "denied by name. Paths under `.claude/` are unaffected -- what is matched is the "
    "head word of a command, not the text. (hooks/gauntlet-off.py)"
)


def off(value: str | None) -> bool:
    """Whether this value of the variable means off.

    Pure, and the switch's whole grammar: the exact value `off` after strip and
    lowercase. Unset, empty or misspelled leaves the gauntlet on, which is the
    safe direction. `sh.bypassed()` is this predicate over `os.environ`; this
    one takes its value as an argument so the self-test never has to touch the
    ambient environment to assert on it.
    """
    return (value or "").strip().lower() == OFF


def _head(segment: str) -> str:
    """The command word of a segment, past assignments and wrappers.

    An empty string where the segment carries no command word at all.
    """
    words = sh.words_of(segment)
    i = 0
    wrapped = False
    while i < len(words):
        word = words[i]
        if "=" in word and not word.startswith("=") and "/" not in word.split("=", 1)[0]:
            i += 1  # a leading assignment, not the command
            continue
        if os.path.basename(word) in WRAPPERS:
            wrapped = True
            i += 1  # a wrapper carries the command we want in its arguments
            continue
        if wrapped and (word.startswith("-") or _DURATION.match(word)):
            i += 1  # a wrapper's own option or `timeout`'s duration
            continue
        return os.path.basename(word)
    return ""


def _assignment_words(segment: str) -> list[str]:
    """The words of a segment that could carry a `VAR=` assignment.

    Leading assignments, and the arguments of `export`, `set` and `env`. A word
    inside a longer string is not one of these, which is what keeps the test off
    a substring search.
    """
    words = sh.words_of(segment)
    out: list[str] = []
    i = 0
    while i < len(words) and "=" in words[i] and not words[i].startswith("="):
        out.append(words[i])
        i += 1
    while i < len(words):
        if os.path.basename(words[i]) in ("export", "set", "env"):
            out.extend(words[i + 1 :])
            break
        if os.path.basename(words[i]) in WRAPPERS:
            i += 1
            continue
        break
    return out


def sets_var(command: str) -> bool:
    """Whether the command assigns the gauntlet variable, in any spelling."""
    for segment in sh.segments(command):
        for word in _assignment_words(segment):
            if word.split("=", 1)[0] == VAR:
                return True
    return False


def invokes_claude(command: str) -> bool:
    """Whether any segment's head word is `claude`."""
    return any(_head(segment) == "claude" for segment in sh.segments(command))


def _verdict(name: str, tool_input: dict) -> str | None:
    """Why this call is refused, or None to let it through."""
    if name != "Bash":
        return None
    command = sh.command_of(tool_input)
    if sets_var(command):
        return _WHY_ASSIGN
    if invokes_claude(command):
        return _WHY_NESTED
    return None


def session_start() -> None:
    if sh.bypassed():
        print(BANNER)


def prompt() -> None:
    print(NOTICE if sh.bypassed() else RULE)


def bash() -> None:
    #: this hook guards one tool, so a payload naming any other is not its call
    #: to refuse however malformed it is
    sh.hook_main(lambda name, tool_input, payload: _verdict(name, tool_input), guards=("Bash",))


def self_test() -> int:
    """Pin the switch's grammar, the three voices, and the two denials."""
    lines = {
        "off() is the exact value `off`, after strip and lowercase": (
            off("off")
            and off("OFF")
            and off("  off\n")
            and not off(None)
            and not off("")
            and not off("offf")
            and not off("0")
            and not off("false")
        ),
        "a GAUNTLET= assignment is denied, in every spelling": all(
            _verdict("Bash", {"command": c}) == _WHY_ASSIGN
            for c in (
                "GAUNTLET=off claude",
                "GAUNTLET=off echo hi",
                "export GAUNTLET=off",
                "env GAUNTLET=off claude -p x",
                "echo hi; export GAUNTLET=off",
                "set GAUNTLET=off",
            )
        ),
        "a claude head word is denied, past wrappers and assignments": all(
            _verdict("Bash", {"command": c}) == _WHY_NESTED
            for c in (
                "claude",
                "claude -p 'do a thing'",
                "nohup claude &",
                "timeout 60 claude -p x",
                "FOO=1 claude",
                "ls; claude -p x",
                "/usr/local/bin/claude -p x",
            )
        ),
        "a .claude/ path is not a claude invocation": all(
            _verdict("Bash", {"command": c}) is None
            for c in (
                "python3 .claude/hooks/plans-lane.py --self-test",
                "python3 .claude/hooks/gauntlet-off.py --self-test",
                "cat .claude/settings.json",
                "ls .claude/worktrees",
                "grep -rn claude docs/",
                "scripts/gates/check-gates.sh",
            )
        ),
        "a tool that is not Bash is not this hook's business": (
            _verdict("Write", {"command": "claude"}) is None
            and _verdict("Read", {"file_path": "GAUNTLET=off"}) is None
        ),
        "the three voices differ, and each says what it is for": (
            VAR + "=" + OFF in BANNER
            and "Stop" in BANNER
            and all(h in BANNER for h in SILENCED)
            and "never propose" in RULE.lower()
            and "no exception" in RULE
            and "not running" in NOTICE
            and BANNER != NOTICE
        ),
        "the self-test asserts nothing on the ambient variable": (
            off("off") is True and off(os.environ.get("nonexistent-by-construction")) is False
        ),
        #: a hook decides a tool call, so its own crash is a denial -- and a
        #: payload it cannot read is a call it cannot decide, which is a refusal.
        #: `--bash` is the entry point that decides one; the other two only speak.
        "every payload shape is answered, and an unreadable one is refused": (
            sh.survives_hostile_payloads(__file__, "--bash", guards=("Bash",))
        ),
    }
    return sh.report(lines)


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    if "--session-start" in sys.argv:
        session_start()
    elif "--prompt" in sys.argv:
        prompt()
    elif "--bash" in sys.argv:
        bash()
