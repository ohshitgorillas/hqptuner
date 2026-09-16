#!/usr/bin/env python3
"""PreToolUse hook: a gate run is not truncated on its way out of the shell.

`make check | head -40`, `pytest | grep FAILED` and `ruff check >/dev/null`
each drop the part of a gate's output that says why it failed, and the part
they keep is chosen by position rather than by content. What reaches the
transcript then looks like a verdict and is not one: `head` shows the first
screen of a run whose failures are at the end, and a `grep` for one spelling
is silent about every other.

`scripts/gate.sh` keeps both halves: the whole log on disk, the path named,
and the failure lines selected by pattern. So this hook denies the truncating
shapes and names that script.

Denied: a gate stage (`make check`, `make test`, `pytest`, `ruff`, `npm test`,
a script under `scripts/gates/`) piped into `head`, `tail` or `grep`, or with
its stdout sent to `/dev/null`. A gate already wrapped in `scripts/gate.sh` is
not a gate stage here, so the wrapper passes.

Command shapes come from `shell_shapes.py`: its quote masking, its heredoc
stripping, its word splitting, its redirection pattern. `shell_shapes.segments`
treats `|` and `;` as one kind of boundary, and a denial needs them apart, so
`pipelines()` below draws that one distinction over `shell_shapes`' own masked
text and parses nothing else itself.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name: str):
    path = os.path.join(HERE, name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


shapes = _load("shell_shapes")

#: commands that cut a gate's output down to a fragment of itself
SUPPRESSORS = frozenset({"head", "tail", "grep"})

#: heads that are a gate whatever their arguments say
GATE_HEADS = frozenset({"pytest", "ruff"})

#: `make` targets that are gates, exactly or as a prefixed variant
#: (`test-js`, `check-fast`)
GATE_TARGETS = frozenset({"check", "test"})

#: the directory whose every script is a gate
GATE_DIR = "scripts/gates/"

#: interpreter heads that run a gate named in their arguments
INTERPRETERS = ("python", "python3")

#: words that stand in front of the command a stage runs. `sudo` and `env` are
#: here so a gate behind one is still a gate. `scripts/gate.sh` is absent, and
#: that absence is what lets the wrapper through.
WRAPPERS = frozenset({"env", "timeout", "nice", "ionice", "sudo", "command", "exec"})

#: a shell variable assignment standing in front of a command
_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")

#: the file descriptor a redirection carries, read off the operator text that
#: `shell_shapes.REDIRECT` matched in front of the target
_FD = re.compile(r"(\d*|&)>>?\s*$")

#: descriptors whose loss takes the gate's verdict with it. `2` is absent: a
#: bare `2>/dev/null` drops stderr noise and leaves stdout intact.
_VERDICT_FDS = frozenset({"", "1", "&"})

_WHY = (
    "A gate's output is not piped into head, tail or grep, and its stdout does not go to "
    "/dev/null: the lines that survive are chosen by position or by one spelling, so what "
    "reaches the transcript reads as a verdict without being one. Run it through "
    "scripts/gate.sh instead -- that keeps the whole log on disk, prints exit= and log=, "
    "and selects the failure lines by pattern. Here: scripts/gate.sh {gate}"
)


def pipelines(command: str) -> list[list[str]]:
    """The command's pipelines, each as its list of stages in order.

    A `;` is not a `|`: `make check; grep -n foo notes.txt` pipes nothing into
    anything, and a split that treats the two alike denies it. The scan runs
    over `mask_quoted` output, so a separator inside a quoted argument stays an
    argument character, and every index is an index into the unmasked text the
    stages are sliced from.
    """
    text = shapes.strip_heredocs(command)
    masked = shapes.mask_quoted(text)

    out: list[list[str]] = []
    current: list[str] = []
    start = 0
    i = 0

    def stage(end: int) -> None:
        piece = text[start:end].strip()
        if piece:
            current.append(piece)

    def flush() -> None:
        nonlocal current
        if current:
            out.append(current)
        current = []

    while i < len(masked):
        ch = masked[i]
        if masked.startswith("&&", i) or masked.startswith("||", i):
            stage(i)
            flush()
            i += 2
            start = i
        elif ch in ";\n":
            stage(i)
            flush()
            i += 1
            start = i
        elif ch == "&" and not ((i and masked[i - 1] in ">&") or (i + 1 < len(masked) and masked[i + 1] in ">&")):
            stage(i)
            flush()
            i += 1
            start = i
        elif ch == "|":
            #: a stage boundary that leaves the pipeline open
            stage(i)
            i += 1
            start = i
        else:
            i += 1
    stage(len(masked))
    flush()
    return out


def head_words(segment: str) -> list[str]:
    """The words of the command a stage runs, wrappers and assignments off.

    `shell_shapes.command_words` takes the shell keywords; this takes the layer
    above them, so `timeout 600 make check` is a `make` and `FORCE_COLOR=0 npm
    test` is an `npm`.
    """
    words = shapes.command_words(shapes.words_of(segment))
    while words:
        word = words[0]
        if _ASSIGN.match(word):
            words = words[1:]
            continue
        if os.path.basename(word) in WRAPPERS:
            words = words[1:]
            #: a wrapper's own flags, and a bare `timeout` duration
            while words and (words[0].startswith("-") or words[0].replace(".", "", 1).isdigit()):
                words = words[1:]
            continue
        break
    return words


def _under_gates(word: str) -> bool:
    return GATE_DIR in word.replace("\\", "/")


def _gate_target(word: str) -> bool:
    return word in GATE_TARGETS or any(word.startswith(t + "-") for t in GATE_TARGETS)


def is_gate(words: list[str]) -> bool:
    """Does this stage run one of the gates the repo's report is built on?

    The `scripts/gates/` test is against the program, not against any word: a
    path there is a gate when it is what runs, and an argument to `ls` or `git
    add` naming the same directory is not.
    """
    if not words:
        return False
    head = os.path.basename(words[0])
    rest = words[1:]
    if head in GATE_HEADS or _under_gates(words[0]):
        return True
    if head == "make":
        return any(_gate_target(word) for word in rest if not word.startswith("-"))
    if head in INTERPRETERS or head.startswith("python3."):
        if any(_under_gates(word) for word in rest):
            return True
        #: `python -m pytest`, in every spelling of the interpreter
        if "-m" in rest:
            after = rest[rest.index("-m") + 1 :]
            return bool(after) and after[0] == "pytest"
        return False
    if head == "npm":
        args = [word for word in rest if not word.startswith("-")]
        return args[:1] == ["test"] or args[:2] == ["run", "test"]
    return False


def to_null(segment: str) -> bool:
    """Does this stage send stdout, or everything, to `/dev/null`?

    `shell_shapes.redirect_targets` filters `/dev/null` out, so the unfiltered
    pattern is the one to read here. The descriptor decides: `>`, `1>` and `&>`
    take the verdict with them, `2>` takes only the noise.
    """
    masked = shapes.mask_quoted(segment)
    for match in shapes.REDIRECT.finditer(masked):
        target = segment[match.start(1) : match.end(1)].strip("\"'")
        if target != shapes.NULL_TARGET:
            continue
        operator = _FD.search(segment[match.start(0) : match.start(1)])
        if operator and operator.group(1) in _VERDICT_FDS:
            return True
    return False


def verdict(command: str) -> str | None:
    """Why this command is refused, or None to let it through."""
    for stages in pipelines(command):
        for index, segment in enumerate(stages):
            words = head_words(segment)
            if not is_gate(words):
                continue
            gate = " ".join(words)
            for later in stages[index + 1 :]:
                downstream = head_words(later)
                if downstream and os.path.basename(downstream[0]) in SUPPRESSORS:
                    return _WHY.format(gate=gate)
            if to_null(segment):
                return _WHY.format(gate=gate)
    return None


def main() -> None:
    try:
        data = json.loads(sys.stdin.read())
    except (ValueError, OSError):
        return
    if not isinstance(data, dict) or data.get("tool_name") != "Bash":
        return
    reason = verdict(shapes.command_of(data.get("tool_input")))
    if reason is None:
        return
    print(shapes.deny(reason))


def self_test() -> int:
    """Pin the verdicts: truncated gates deny, everything else passes."""
    deny = [
        "make check | head -40",
        "make test 2>&1 | tail -20",
        ".venv/bin/pytest -m 'not live' -q | grep FAILED",
        ".venv/bin/ruff check hqptuner | head",
        "npm test | tail -n 5",
        "npm run test | grep -c fail",
        "python3 scripts/gates/check_changelog.py | head -3",
        "scripts/gates/check_changelog.py | head -3",
        "make check > /dev/null",
        "make check >/dev/null 2>&1",
        "make check &>/dev/null",
        ".venv/bin/python -m pytest -q >/dev/null",
        "timeout 600 make check | head -40",
        "FORCE_COLOR=0 npm test | head",
        "make test-js | head -5",
        "cd hqptuner && make check | head -40",
        "make check | grep -E 'FAILED|ERROR' | head -5",
    ]
    allow = [
        "make check",
        "make check 1>run.log",
        "scripts/gate.sh make check",
        "scripts/gate.sh .venv/bin/pytest -m 'not live' -q",
        #: a `;` is not a pipe: the grep reads a file, not the gate
        "make check; grep -n version CHANGELOG.md",
        "make check && git commit -m 'fix: x'",
        "git log --oneline | head -20",
        "grep -rn FAILED docs/ | head -40",
        "cat .pytest-junit.xml | grep failures",
        "ls scripts/gates/ | head",
        "git add scripts/gates/check_idle.py | head",
        #: stderr noise, not the gate's verdict
        "make check 2>/dev/null",
        "echo 'make check | head' > notes.txt",
        "",
    ]
    bad = [c for c in deny if verdict(c) is None]
    bad += [c for c in allow if verdict(c) is not None]
    for command in bad:
        print(f"wrong verdict: {command!r}")
    print("gate-capture self-test:", "FAIL" if bad else "ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main())
