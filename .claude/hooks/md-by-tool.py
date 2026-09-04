#!/usr/bin/env python3
"""PreToolUse hook: markdown is written with Write/Edit, never from the shell.

The soft-wrap and changelog-style gates hang off the Write/Edit tools:
md-softwrap.py and changelog-style.py read a PostToolUse payload naming the
file. A `sed -i`, a `>` redirect, a heredoc or a script that lands prose in a
`.md` file fires neither, and the doc meets its first gate at commit, or never
if it stays untracked. (The trivia judge is the exception: it runs at Stop over
the whole working tree and sees shell writes too.) Wired session-wide, so it
binds every agent and subagent without anyone being reminded.

Blocked: a Bash command that meters under free_bash.py and names a `.md` path
outside quotes. Read-only commands (`cat`, `grep`, `sed -n`, `diff`) are free
and pass. `git`, `rm`, `make`, `pre-commit` pass by head command: they move,
delete, stage or gate markdown and add no prose. So does a call into
`scripts/gates/` or `md-softwrap.py`, which are the gates themselves.

Any other shape is refused with the instruction to use Write or Edit.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shlex
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

#: a markdown path token
MD_PATH = re.compile(r"(?<![\w.])[\w./~-]*\.md\b")
#: head commands that touch markdown files without adding prose
EXEMPT_HEADS = {"git", "rm", "make", "pre-commit"}
#: script paths that are markdown gates or fixers in their own right
EXEMPT_SCRIPTS = ("scripts/gates/", "md-softwrap.py")

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


def _heads(cmd: str) -> list[str]:
    """Basename of the first word of every &&/;/| segment."""
    out = []
    for seg in re.split(r"&&|\|\||;|\|", cmd):
        try:
            toks = shlex.split(seg, posix=True)
        except ValueError:
            toks = seg.split()
        toks = [t for t in toks if "=" not in t or t.startswith("-")] or toks
        if toks:
            out.append(os.path.basename(toks[0]))
    return out


def verdict(cmd: str) -> str | None:
    """Why this command is refused, or None to let it through."""
    masked = _free._mask(cmd) or cmd
    if not MD_PATH.search(masked):
        return None
    if _free.is_free_bash(cmd):
        return None
    if any(s in cmd for s in EXEMPT_SCRIPTS):
        return None
    if all(h in EXEMPT_HEADS for h in _heads(masked)):
        return None
    return _WHY


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
        "cp scratch.md docs/plan.md",
    ]
    allow = [
        "sed -n '10,20p' docs/architecture.md",
        "grep -n foo README.md | head",
        "git add docs/x.md && git commit -m 'docs: touch x.md'",
        "rm docs/old.md",
        "python3 .claude/hooks/md-softwrap.py --fix docs/x.md",
        ".venv/bin/python scripts/gates/check_md_trivia.py docs/x.md",
        "make check",
        "echo hi > out.txt",
    ]
    bad = [c for c in deny if verdict(c) is None] + [c for c in allow if verdict(c) is not None]
    for c in bad:
        print(f"wrong verdict: {c!r}")
    print("md-by-tool self-test:", "FAIL" if bad else "ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main())
