#!/usr/bin/env python3
"""PreToolUse hook: keep a blind test-author or spec-reviewer out of the implementation.

Wired from the `hooks:` frontmatter of `.claude/agents/test-writer.md`,
`spec-reviewer.md`, `user-reviewer.md`, `abuser-reviewer.md` and
`pedant-reviewer.md`, so it binds those subagents only — the
orchestrator and every other agent are untouched. A session-wide
`permissions.deny` would have blinded the orchestrator too, which is the one
agent that has to read the implementation to adjudicate a failure.

The rule those agents work under is that tests are written from a behavior
spec and never from the code under test, so that a test cannot be shaped to
mirror whatever the implementation happens to do (docs/testing.md "Core rules";
docs/agent-failures.md records a suite built that way). A prompt alone does not
enforce it: the agent that must not peek is the same agent deciding whether it
peeked.

Blocked for those agents:

  * Read of any path under the `hqptuner/` package
  * Grep/Glob rooted anywhere under it, and Grep/Glob with no path at all
    (an unrooted search sweeps the package and prints matching source lines)
  * a Bash command naming a `hqptuner/` path — `cat`, `sed -n`, `less`, and
    every other reader the Bash tool can reach
  * a Bash command fetching a served module or stylesheet from :8090
    (`/components/`, `/store/`, `/lib/`, any `.js`/`.css`/`.map`) — the same
    source by another road; `/api/` GETs pass

Allowed, because they are the spec's own sources: `docs/`, `tests/`,
`hqplayerd-readme.txt`, the HQPlayer manual, and the test runners (`make test`,
`pytest`) — a traceback through implementation source is the cost of running
the suite at all.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import sys

PACKAGE = "hqptuner"
#: a `hqptuner/...` path token anywhere in a shell command
BASH_PATH = re.compile(r"(?:^|[\s\"'=(:])\.?/?hqptuner/")
#: the same source served by the dev container: modules and stylesheets on :8090
SERVED = re.compile(r":8090/(?:components|store|lib)/|:8090/[^\s\"']*\.(?:js|css|map)\b")

_WHY = (
    "Blind agent: the implementation is out of bounds. Work from the spec block, "
    "docs/, tests/, and the HQPlayer documentation. If the spec does not say what the "
    "behavior is, report that gap instead of reading the code to find out."
)


def _repo_root(start: str) -> str | None:
    path = os.path.abspath(start or ".")
    while True:
        if os.path.exists(os.path.join(path, ".git")):
            return path
        parent = os.path.dirname(path)
        if parent == path:
            return None
        path = parent


def _in_package(target: str, root: str | None, cwd: str) -> bool:
    """True when `target` resolves inside the repo's `hqptuner/` package."""
    if not root or not target:
        return False
    package = os.path.join(root, PACKAGE)
    resolved = os.path.abspath(os.path.join(cwd or root, target))
    try:
        return os.path.commonpath([resolved, package]) == package
    except ValueError:
        return False


def _verdict(name: str, tool_input: dict, root: str | None, cwd: str) -> str | None:
    """Why this call is refused, or None to let it through."""
    if name == "Read":
        target = tool_input.get("file_path", "")
        return _WHY if _in_package(target, root, cwd) else None
    if name in ("Grep", "Glob"):
        target = tool_input.get("path")
        if target is None:
            return (
                "Give Grep/Glob an explicit path (tests/, docs/): an unrooted search "
                "sweeps the implementation and prints its source. " + _WHY
            )
        return _WHY if _in_package(target, root, cwd) else None
    if name == "Bash":
        command = tool_input.get("command", "")
        if BASH_PATH.search(command) or SERVED.search(command) or _names_package(command, root, cwd):
            return _WHY
    return None


def _names_package(command: str, root: str | None, cwd: str) -> bool:
    """True when any word of the command resolves inside the package.

    The regex above sees the relative spellings; this sees absolute ones,
    which it cannot, because the repo directory is itself named `hqptuner`
    and `/srv/hqptuner/hqptuner/…` has no anchor character before the
    package segment.
    """
    try:
        words = shlex.split(command, comments=False, posix=True)
    except ValueError:
        words = command.split()
    return any(_in_package(word, root, cwd) for word in words if "/" in word)


def main() -> None:
    try:
        data = json.loads(sys.stdin.read())
    except (ValueError, OSError):
        return  # never block on our own failure
    cwd = data.get("cwd") or os.getcwd()
    reason = _verdict(data.get("tool_name", ""), data.get("tool_input") or {}, _repo_root(cwd), cwd)
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
    """Pin the verdicts on a docs path, an absolute package path, and a served module."""
    root = _repo_root(os.path.dirname(os.path.abspath(__file__))) or "/repo"
    pair = (
        _verdict("Bash", {"command": f"cat {root}/docs/testing.md"}, root, root),
        _verdict("Bash", {"command": f"cat {root}/hqptuner/core/manager.py"}, root, root),
    )
    served = (
        _verdict("Bash", {"command": "curl -s http://127.0.0.1:8090/api/state"}, root, root),
        _verdict("Bash", {"command": "curl -s http://127.0.0.1:8090/components/primer/copy.js"}, root, root),
    )
    passed = pair[0] is None and isinstance(pair[1], str) and served[0] is None and isinstance(served[1], str)
    print(f"  {'PASS' if passed else 'FAIL'}  docs path allowed, absolute package path denied: {pair}")
    print(f"  {'PASS' if passed else 'FAIL'}  api GET allowed, served module denied: {served}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(self_test()) if "--self-test" in sys.argv else main()
