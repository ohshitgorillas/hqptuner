#!/usr/bin/env python3
"""Shared plumbing for the budget analysers.

``budget_miner.py`` (trips) and ``budget_read_profile.py`` (read behaviour) both
walk the same session transcripts and both need the same three things: the
change-budget hook's own accounting, a way to read a transcript, and a way to
say what kind of call a tool_use block was. That lives here so the two analysers
cannot drift apart in how they classify.

The hook is imported by path and used unmodified. Reimplementing ``classify`` /
``is_free_bash`` here would measure a different budget than the one that fired.
The hook already guards ``main()`` behind ``__name__``, so importing it is inert
and no byte of it changes.
"""

from __future__ import annotations

import importlib.util
import json
import re
import shlex
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections import Counter
    from collections.abc import Iterator
    from types import ModuleType

#: A decoded JSONL object — a transcript row, a message, or a content block.
JsonDict = dict[str, Any]

ROOT = Path(__file__).resolve().parent.parent.parent
HOOK_PATH = ROOT / ".claude" / "hooks" / "change-budget.py"
LOG_DIR = ROOT / ".claude" / "logs"
TRANSCRIPT_DIR = Path.home() / ".claude" / "projects" / "-srv-hqptuner"

PREVIEW = 140


def load_hook() -> ModuleType:
    """Import the hook by path under a name that is not ``__main__``."""
    spec = importlib.util.spec_from_file_location("change_budget", HOOK_PATH)
    if spec is None or spec.loader is None:  # pragma: no cover - unreachable in practice
        raise RuntimeError(f"cannot import hook at {HOOK_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


hook = load_hook()

# ---- command classification -------------------------------------------------

#: Ordered by severity. A chained command takes the first class present here, so
#: `git add -A && git commit` reads as git-commit rather than as its first token.
CLASS_ORDER = [
    "sudo",
    "docker",
    "git-push",
    "git-commit",
    "pkg-install",
    "rm",
    "curl-mutating",
    "python-exec",
    "other",
]
PKG_CMDS = {"dnf", "yum", "apt", "apt-get", "pip", "pip3", "npm", "cargo", "flatpak", "rpm"}
PKG_SUBS = {"install", "uninstall", "remove", "erase", "upgrade", "update", "add", "ci"}
PYTHON_RE = re.compile(r"^python[0-9.]*$")


# Commands whose class is settled by the command name alone.
NAME_CLASSES = {"sudo": "sudo", "docker": "docker", "docker-compose": "docker", "podman": "docker", "rm": "rm"}


def _segment_class(name: str, rest: list[str]) -> str:
    if name in NAME_CLASSES:
        return NAME_CLASSES[name]
    if name == "git":
        sub = next((a for a in rest if not a.startswith("-")), None)
        return {"commit": "git-commit", "push": "git-push"}.get(sub or "", "other")
    if name == "curl":
        return "other" if hook._curl_ok(rest) else "curl-mutating"
    if PYTHON_RE.match(name):
        return "python-exec"
    if name in PKG_CMDS:
        sub = next((a for a in rest if not a.startswith("-")), None)
        return "pkg-install" if sub in PKG_SUBS else "other"
    return "other"


def segments(command: str) -> list[list[str]]:
    """Every &&/||/;/|-separated stage of a shell command, tokenised."""
    out = []
    for segment in re.split(r"&&|\|\||;|\|", command or ""):
        try:
            tokens = hook._strip_prefix(shlex.split(segment, comments=False, posix=True))
        except ValueError:
            tokens = segment.split()
        if tokens:
            out.append(tokens)
    return out


def bash_class(command: str) -> str:
    """Return the severity-ranked class of a shell command, over all its segments."""
    found = {_segment_class(hook._cmd_name(t[0]), t[1:]) for t in segments(command)}
    return next((c for c in CLASS_ORDER if c in found), "other")


def _preview(name: str, tool_input: JsonDict) -> str:
    if name == "Bash":
        text = tool_input.get("command", "")
    elif name in hook.EDIT_TOOLS:
        text = str(tool_input.get(hook.EDIT_TOOLS[name], ""))
    elif name == "Agent":
        text = str(tool_input.get("subagent_type", "")) + ": " + str(tool_input.get("description", ""))
    else:
        text = json.dumps(tool_input, sort_keys=True)
    return " ".join(text.split())[:PREVIEW]


def entry_for(block: JsonDict, root: str | None, cwd: str) -> JsonDict:
    """One burst entry: which leash the call pulled and what kind of call it was."""
    name = block.get("name") or ""
    tool_input = block.get("input") or {}
    leash_class = hook.classify(name, tool_input, root, cwd)
    if name == "Bash":
        cmd_class = bash_class(tool_input.get("command", ""))
    elif name in hook.EDIT_TOOLS:
        cmd_class = "edit-in-tree" if leash_class == hook.EDIT else "write-outside-tree"
    else:
        cmd_class = "other"
    return {
        "tool": name,
        "cmd_class": cmd_class,
        "leash_class": leash_class,
        "tool_use_id": block.get("id"),
        "preview": _preview(name, tool_input),
    }


# ---- transcript reading -----------------------------------------------------


def text_of(content: Any) -> str:
    """Flatten a message content field (str, or a list of blocks) to text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") in ("text", "tool_result"):
                inner = block.get("content") if block.get("type") == "tool_result" else block.get("text")
                parts.append(text_of(inner))
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts)
    return ""


def read_rows(path: Path) -> list[JsonDict]:
    """Return every decodable JSON object in a JSONL transcript, skipping blank and malformed lines."""
    rows: list[JsonDict] = []
    for raw in path.read_text(errors="replace").splitlines():
        line = raw.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows


def tool_uses(row: JsonDict) -> Iterator[JsonDict]:
    """Every tool_use block in an assistant row."""
    message = row.get("message")
    if not isinstance(message, dict) or message.get("role") != "assistant":
        return
    for block in message.get("content") or []:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            yield block


def result_sizes(rows: list[JsonDict]) -> dict[str, int]:
    """tool_use_id -> characters its result put back into the context window."""
    sizes: dict[str, int] = {}
    for row in rows:
        message = row.get("message")
        if not isinstance(message, dict):
            continue
        for block in message.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                key = block.get("tool_use_id")
                if key:
                    sizes[key] = sizes.get(key, 0) + len(text_of(block.get("content")))
    return sizes


#: The hook owns the definition of what the user typed, and the analysers import
#: it rather than keeping a second copy: a measurement of a rule that has drifted
#: from the rule is worse than no measurement.
clean_reply = hook.clean_reply


def human_turns(rows: list[JsonDict]) -> list[int]:
    """Return indices of every human row — the period boundaries these analysers use.

    Deliberately ``is_human_row``, not ``is_genuine_reply``: a period here is a
    unit of observation, and the wider boundary is what the historical numbers
    were measured against. The hook resets on the narrower one.
    """
    return [i for i, row in enumerate(rows) if hook.is_human_row(row)]


def write_jsonl(path: Path, records: list[JsonDict]) -> None:
    """Write records to path as key-sorted JSONL, creating the parent directory if needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in records))


# ---- synthetic rows, shared by both analysers' self-tests -------------------


def fake_assistant(uuid: str, tool_id: str, name: str, tool_input: JsonDict) -> JsonDict:
    """Build a synthetic assistant row carrying a single tool_use block."""
    content = [{"type": "tool_use", "id": tool_id, "name": name, "input": tool_input}]
    return {"uuid": uuid, "cwd": str(ROOT), "message": {"role": "assistant", "content": content}}


def fake_human(text: str) -> JsonDict:
    """Build a synthetic human row whose message content is the given text."""
    return {"uuid": f"human-{abs(hash(text))}", "cwd": str(ROOT), "message": {"role": "user", "content": text}}


def fake_result(tool_id: str, size: int) -> JsonDict:
    """Build a synthetic tool_result row for a tool_use id, padded to size characters."""
    block = {"type": "tool_result", "tool_use_id": tool_id, "content": "x" * size}
    return {"uuid": f"res-{tool_id}", "cwd": str(ROOT), "message": {"role": "user", "content": [block]}}


def histogram(title: str, counter: Counter[str], total: int) -> None:
    """Print a titled count table, most common first, with each count as a share of total."""
    print(f"\n{title}")
    if not counter:
        print("  (none)")
        return
    for name, count in counter.most_common():
        share = f"{100 * count / total:5.1f}%" if total else "    - "
        print(f"  {name:<20} {count:>4}  {share}")
