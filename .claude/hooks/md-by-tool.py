#!/usr/bin/env python3
"""PreToolUse hook: markdown is written with Write/Edit, never from the shell.

The soft-wrap and changelog-style gates hang off the Write/Edit tools:
md-softwrap.py and changelog-style.py read a PostToolUse payload naming the
file. A `sed -i`, a `>` redirect, a heredoc or a script that lands prose in a
`.md` file fires neither, and the doc meets its first gate at commit, or never
if it stays untracked. (The trivia judge is the exception: it runs at Stop over
the whole working tree and sees shell writes too.) Wired session-wide, so it
binds every agent and subagent without anyone being reminded.

Blocked: a Bash command with a stage that meters under free_bash.py and writes
to a `.md` target. Read-only commands (`cat`, `grep`, `sed -n`, `diff`) are free
and pass. `git`, `rm`, `make`, `pre-commit`, `mv`, `cp`, `install` pass by head
command, stage by stage: they move, delete, stage or gate markdown and add no
prose. So does a call into
`scripts/gates/`, a `triviajudge-*` console script or `md-softwrap.py`, which
are the gates themselves, and so does the `skills/caveman-compress` CLI,
exempted by the owner: it rewrites prose in place and the caller runs
`md-softwrap.py --fix` over its output.

Any other shape is refused with the instruction to use Write or Edit.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

#: a markdown path token
MD_PATH = re.compile(r"(?<![\w.])[\w./~-]*\.md\b")
#: head commands that touch markdown files without adding prose. `mv`, `cp` and
#: `install` relocate prose; none of the four types a character of it.
EXEMPT_HEADS = {"git", "rm", "make", "pre-commit", "mv", "cp", "install"}
#: script paths that are markdown gates or fixers in their own right
EXEMPT_SCRIPTS = ("scripts/gates/", "triviajudge-", "md-softwrap.py", "skills/caveman-compress")

#: text that can write, in a stage whose targets this parser cannot read. An
#: unreadable stage is refused only when a mark appears in the text that holds
#: it: an inline script or an `xargs` command with no write verb and no
#: redirection writes nothing, wherever it names a markdown path. The list is a
#: deny-list, so an unrecognized write verb reads as no mark and passes -- the
#: residual hole is an inline script whose write hides behind a call into a
#: module (`python3 -c "import gen; gen.run()"`).
WRITE_MARK = re.compile(
    r">"
    r"|\bopen\s*\("
    r"|\bwrite\w*"
    r"|\btruncate\b"
    r"|\bdump\w*"
    r"|\bunlink\b"
    r"|\bmkdir\b"
    r"|\brename\b"
    r"|\breplace\b"
    r"|\bfile\s*="
    r"|\bshutil\b"
    r"|\bsystem\s*\("
    r"|\bpopen\b"
    r"|\btee\b"
    r"|\btouch\b"
    r"|\bsed\b"
    r"|\bmv\b"
    r"|\bcp\b"
    r"|\binstall\b"
    r"|\bchmod\b"
    r"|\bremove\b"
    r"|\bmove\b"
    r"|\bcopy\w*"
    r"|\bsave\w*"
)

_WHY = (
    "Markdown is written with the Write or Edit tool, never from the shell. The soft-wrap "
    "and changelog-style gates run from those tools' PostToolUse payload; a shell write to "
    "a .md file skips both. Make the edit with Write or Edit."
)


def _load(name: str):
    path = os.path.join(HERE, name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_free = _load("free_bash")
_shapes = _load("shell_shapes")


def _unreadable_md_write(stage: str, body: str, cmd: str, unknown: str) -> bool:
    """Does a stage whose targets cannot be read look like a markdown write?

    Two tests, on the only evidence there is: the text that holds the stage,
    and the reason the targets are unreadable. A `STAGE` reason -- an inline
    script, a heredoc -- carries the whole program in the stage text and its
    body, so a markdown path the program writes is spelled in one of the two.
    The `STDIN` reason of an `xargs` takes its paths off the pipe, so the whole
    command is the text. Past that the text has to hold something that can
    write at all; a program that only prints writes nothing, whatever it names.

    The heredoc case stays denied. `python3 - <<EOF` rewriting a plan spells
    the plan in the body and opens it there, so both tests find it in the body
    alone. What this lets through is the shape that only quotes: a markdown
    name inside an inline script that prints it, matches it or passes it to a
    reader.
    """
    text = f"{stage}\n{body}" if unknown == _shapes.STAGE else cmd
    return bool(MD_PATH.search(text) and WRITE_MARK.search(text))


def verdict(cmd: str) -> str | None:
    """Why this command is refused, or None to let it through.

    The question is asked per stage, of what that stage writes *to*. A command
    that names a `.md` path somewhere is not a markdown write: `git commit -m`
    with the message in a heredoc names one and writes none, and
    `cat > notes.txt <<EOF` naming a plan in its body writes `notes.txt`. So
    `stage_targets` answers for each stage, and a stage whose targets this
    parser cannot read falls back to its own text, through
    `_unreadable_md_write` -- which is what keeps
    `python3 - <<EOF` rewriting a plan, and `/usr/bin/env mv` around the head
    exemption, on the denied side, while an inline script that only quotes a
    markdown name passes.

    The `MD_PATH` pre-check stays, as the cheap answer to "is markdown in play
    at all". Without it the fail-closed branch would refuse every `python3 -c`
    on this host. It reads the raw command, quoted text and heredoc bodies
    included, because prose naming a plan is evidence that markdown is the
    subject even where it is not a target. It decides nothing on its own: past
    it, only a target or an unreadable stage denies.
    """
    if not MD_PATH.search(cmd):
        return None
    if _free.is_free_bash(cmd):
        return None
    if any(s in cmd for s in EXEMPT_SCRIPTS):
        return None
    for stage, body in _shapes.segments_with_bodies(cmd):
        words = _shapes.command_words(_shapes.words_of(stage))
        if words and os.path.basename(words[0]) in EXEMPT_HEADS:
            continue
        targets, unknown = _shapes.stage_targets(stage, body)
        if any(t.endswith(".md") for t in targets):
            return _WHY
        if unknown and _unreadable_md_write(stage, body, cmd, unknown):
            return _WHY
    return None


def main() -> None:
    try:
        data = json.loads(sys.stdin.read())
    except (ValueError, OSError):
        return
    if data.get("tool_name") != "Bash":
        return
    reason = verdict((data.get("tool_input") or {}).get("command", ""))
    if reason is None:
        return
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )


def self_test() -> int:
    """Pin the verdicts: shell writes to markdown deny, reads and git pass."""
    deny = [
        "sed -i 's/a/b/' docs/architecture.md",
        "printf 'x\\n' > docs/new.md",
        "cat >> notes.md <<'EOF'\nhello\nEOF",
        "python3 tools/gen.py docs/out.md",
        "python3 - <<'EOF'\nopen('docs/plan.md', 'w').write('x')\nEOF",
        "/usr/bin/env mv docs/a.md docs/b.md",
        "python3 -c \"open('docs/plan.md', 'w').write('x')\"",
        "grep -rl foo docs | xargs sed -i 's/a/b/' docs/x.md",
    ]
    allow = [
        "cp scratch.md docs/plan.md",
        "git commit -m \"$(cat <<'EOF'\ndocs: rewrite docs/x.md\nEOF\n)\"",
        "cat > notes.txt <<'EOF'\nsee docs/plan.md\nEOF",
        "python3 -c 'print(1)'",
        "sed -n '10,20p' docs/architecture.md",
        "grep -n foo README.md | head",
        "git add docs/x.md && git commit -m 'docs: touch x.md'",
        "rm docs/old.md",
        "python3 .claude/hooks/md-softwrap.py --fix docs/x.md",
        ".venv/bin/triviajudge-md docs/x.md",
        "make check",
        "echo hi > out.txt",
        "python3 -c \"print('docs/plan.md')\"",
        "ls docs/*.md | xargs cat",
        "python3 - <<'EOF'\nprint('docs/plan.md')\nEOF",
    ]
    bad = [c for c in deny if verdict(c) is None] + [c for c in allow if verdict(c) is not None]
    for c in bad:
        print(f"wrong verdict: {c!r}")
    print("md-by-tool self-test:", "FAIL" if bad else "ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main())
