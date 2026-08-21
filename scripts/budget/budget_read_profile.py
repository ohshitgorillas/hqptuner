#!/usr/bin/env python3
"""Read-behavior profiling across every leash period, not just tripped ones.

The trip miner only sees the periods that ended in a denial. That is a biased
sample: it says what a burst looked like when it went too far, and nothing about
what a normal period looks like. The advisory thresholds a later step would set
have to come from the whole distribution, otherwise the number is a guess with a
histogram stapled to it.

A *leash period* is the span from one human turn to the next — exactly the window
the change-budget hook counts over. Rows before the first human turn are session
preamble (SessionStart hooks, injected context) and are not a period: no budget
is running yet.

For each period this records how much free reading went into it, how much of
that reading was a file the session had already read, and how many edits and
metered actions came out the other side. The interesting quadrant is high read
volume with zero edits: grounding that produced nothing.

Emits one record per period to ``.claude/logs/read-profile.jsonl``.
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING

from budget_common import (
    LOG_DIR,
    ROOT,
    JsonDict,
    entry_for,
    fake_assistant,
    fake_human,
    fake_result,
    hook,
    human_turns,
    read_rows,
    result_sizes,
    segments,
    tool_uses,
)

if TYPE_CHECKING:
    from collections.abc import Callable

OUT_PATH = LOG_DIR / "read-profile.jsonl"

#: Grep and Glob take patterns, not paths, so they cannot be re-read tracked.
#: Their result bytes still count toward the read total — they land in context
#: like any other read. Agent/WebFetch/WebSearch likewise have no local path.
NO_PATH_TOOLS = {"Grep", "Glob", "WebFetch", "WebSearch", "Agent", "Task"}
PATH_FIELDS = {"Read": "file_path", "NotebookRead": "notebook_path"}
GLOB_CHARS = re.compile(r"[*?\[\]]")
#: `2>/dev/null` survives shlex as a single token and reads as a path unless
#: caught here. So does a bare `>out.txt`.
REDIRECT = re.compile(r"^\d*[<>]")


def _resolve(path: str, cwd: str) -> str:
    return str(Path(cwd or "/", Path(path).expanduser()).resolve())


def _bash_paths(command: str, cwd: str) -> list[str]:
    """File operands of a read-only shell command.

    Conservative on purpose: a token counts only when it looks like a path and
    nothing else — it contains a slash, carries no glob metacharacter, is not a
    flag, and is not a URL. A missed path understates re-reading; a wrong one
    would invent it.
    """
    found = []
    for tokens in segments(command):
        for token in tokens[1:]:
            if token.startswith("-") or "/" not in token or "://" in token:
                continue
            if GLOB_CHARS.search(token) or token.startswith("$"):
                continue
            if REDIRECT.match(token) or token.startswith("/dev/"):
                continue
            found.append(_resolve(token, cwd))
    return found


def read_paths(name: str, tool_input: JsonDict, cwd: str) -> list[str]:
    """Every local path a free read targeted, resolved against the row's cwd."""
    if name in NO_PATH_TOOLS:
        return []
    if name in PATH_FIELDS:
        value = tool_input.get(PATH_FIELDS[name])
        return [_resolve(str(value), cwd)] if value else []
    if name == "Bash":
        return _bash_paths(tool_input.get("command", ""), cwd)
    return []


def _blank(session: str, index: int, key: str) -> JsonDict:
    return {
        "key": key,
        "session": session,
        "period_index": index,
        "timestamp": "",
        "free_read_bytes": 0,
        "free_read_calls": 0,
        "distinct_paths": 0,
        "reread_count": 0,
        "reread_bytes": 0,
        "reread_paths": {},
        "websearch_calls": 0,
        "webfetch_calls": 0,
        "edit_count": 0,
        "change_count": 0,
        "delegation_count": 0,
        "agent_calls": 0,
        "seen_in": 1,
    }


def _count_free(block: JsonDict, rec: JsonDict, sizes: dict[str, int], cwd: str, seen: set[str]) -> None:
    """Fold one FREE-classified call into the period record."""
    name = block.get("name") or ""
    size = sizes.get(block.get("id") or "", 0)
    rec["free_read_calls"] += 1
    rec["free_read_bytes"] += size
    repeated = False
    for path in read_paths(name, block.get("input") or {}, cwd):
        if path in seen:
            rec["reread_count"] += 1
            rec["reread_paths"][path] = rec["reread_paths"].get(path, 0) + 1
            repeated = True
        seen.add(path)
    if repeated:
        # charged once per call, not once per path: the bytes entered the
        # context window one time regardless of how many operands it named
        rec["reread_bytes"] += size


def _period(rows: list[JsonDict], index: int, session: str, sizes: dict[str, int], seen: set[str]) -> JsonDict:
    opening = rows[0]
    rec = _blank(session, index, opening.get("uuid") or f"{session}:{index}")
    rec["timestamp"] = opening.get("timestamp") or ""
    paths: set[str] = set()
    for row in rows:
        cwd = row.get("cwd") or ""
        root = hook._repo_root(cwd)
        changes, edits = hook.count_blocks(row, root, cwd)
        rec["change_count"] += changes
        rec["edit_count"] += edits
        for block in tool_uses(row):
            name = block.get("name") or ""
            if name == "WebSearch":
                rec["websearch_calls"] += 1
            elif name == "WebFetch":
                rec["webfetch_calls"] += 1
            elif name == "Agent":
                rec["agent_calls"] += 1
                if (block.get("input") or {}).get("subagent_type") in hook.READ_ONLY_AGENTS:
                    rec["delegation_count"] += 1
            if entry_for(block, root, cwd)["leash_class"] == hook.FREE:
                paths.update(read_paths(name, block.get("input") or {}, cwd))
                _count_free(block, rec, sizes, cwd, seen)
    rec["distinct_paths"] = len(paths)
    return rec


def profile_rows(rows: list[JsonDict], session: str) -> list[JsonDict]:
    """One record per leash period in one transcript."""
    sizes = result_sizes(rows)
    turns = human_turns(rows)
    seen: set[str] = set()
    records: list[JsonDict] = []
    for index, start in enumerate(turns):
        end = turns[index + 1] if index + 1 < len(turns) else len(rows)
        records.append(_period(rows[start:end], index, session, sizes, seen))
    return records


def profile(directory: Path) -> tuple[list[JsonDict], int]:
    """Every period across every transcript, deduped, plus the sidechain-row count."""
    seen: dict[str, JsonDict] = {}
    sidechain = 0
    for path in sorted(directory.glob("*.jsonl")):
        rows = read_rows(path)
        sidechain += sum(1 for row in rows if row.get("isSidechain"))
        for record in profile_rows(rows, path.stem):
            if record["key"] in seen:
                seen[record["key"]]["seen_in"] += 1
                continue
            seen[record["key"]] = record
    ordered = sorted(seen.values(), key=lambda r: (r["session"], r["period_index"]))
    return ordered, sidechain


# ---- summary ----------------------------------------------------------------

READ_BUCKETS = [(10_000, "<10K"), (50_000, "10-50K"), (150_000, "50-150K"), (500_000, "150-500K")]
EDIT_BUCKETS = [(0, "0 edits"), (5, "1-5 edits"), (15, "6-15 edits")]


def percentile(values: list[int], fraction: float) -> int:
    """Return the value at the given fraction of an already-sorted list, or 0 when it is empty."""
    if not values:
        return 0
    return values[min(len(values) - 1, round(fraction * (len(values) - 1)))]


def _bucket(value: int, table: list[tuple[int, str]], last: str) -> str:
    return next((label for edge, label in table if value <= edge), last)


def _distribution(records: list[JsonDict]) -> None:
    values = sorted(r["free_read_bytes"] for r in records)
    total = sum(values)
    print(f"\nfree read bytes per period   (periods: {len(records)}, total: {total / 1e6:.1f} MB)")
    for name, fraction in (("p50", 0.50), ("p75", 0.75), ("p90", 0.90)):
        print(f"  {name:<8} {percentile(values, fraction):>10,}")
    print(f"  {'max':<8} {(values[-1] if values else 0):>10,}")
    # Most periods are empty: the hook treats every user-role row as a turn that
    # resets the leash, and slash commands, /clear and injected local-command
    # output all qualify. Percentiles over all periods are dominated by those.
    active = [r for r in records if r["free_read_calls"] or r["edit_count"] or r["change_count"]]
    working = sorted(r["free_read_bytes"] for r in active)
    print(f"\n  periods with any tool activity: {len(active)} of {len(records)}")
    for name, fraction in (("p50", 0.50), ("p75", 0.75), ("p90", 0.90)):
        print(f"  {name:<8} {percentile(working, fraction):>10,}   (active periods only)")


def _rereads(records: list[JsonDict]) -> None:
    total = sum(r["free_read_bytes"] for r in records)
    repeated = sum(r["reread_bytes"] for r in records)
    share = f"{100 * repeated / total:.1f}%" if total else "-"
    calls = sum(r["reread_count"] for r in records)
    print(f"\nre-read: {repeated:,} bytes of {total:,} ({share}), {calls} repeat reads")
    counter: Counter[str] = Counter()
    for record in records:
        for path, count in record["reread_paths"].items():
            counter[path] += count
    print("  top re-read paths")
    for path, count in counter.most_common(10):
        print(f"    {count:>4}  {path[-90:]}")
    if not counter:
        print("    (none)")


def _grounding(records: list[JsonDict]) -> None:
    grid: Counter[tuple[str, str]] = Counter()
    for record in records:
        read = _bucket(record["free_read_bytes"], READ_BUCKETS, ">500K")
        edit = _bucket(record["edit_count"], EDIT_BUCKETS, ">15 edits")
        grid[(read, edit)] += 1
    edits = ["0 edits", "1-5 edits", "6-15 edits", ">15 edits"]
    print("\ngrounding efficiency: periods by read volume x edits produced")
    print(f"  {'read bytes':<12}" + "".join(f"{name:>12}" for name in edits))
    for _, read in [*READ_BUCKETS, (0, ">500K")]:
        row = "".join(f"{grid[(read, edit)]:>12}" for edit in edits)
        print(f"  {read:<12}{row}")


def summarise(records: list[JsonDict], sidechain: int) -> None:
    """Print the read-behavior report — read-byte distribution, re-reads, delegation, web, grounding grid."""
    _distribution(records)
    _rereads(records)
    delegations = sum(r["delegation_count"] for r in records)
    agents = sum(r["agent_calls"] for r in records)
    print(f"\ndelegation: {delegations} read-only-agent calls, {agents} Agent calls total")
    print(f"  second signal: {sidechain} isSidechain rows across all transcripts")
    if bool(delegations) != bool(sidechain):
        print("  FLAG: the two delegation signals disagree — one of them is not measuring what it claims")
    web = sum(r["websearch_calls"] for r in records), sum(r["webfetch_calls"] for r in records)
    print(f"  web: {web[0]} WebSearch, {web[1]} WebFetch")
    _grounding(records)


# ---- self-test --------------------------------------------------------------


def _synthetic() -> list[JsonDict]:
    """Preamble row, then three periods: read+grep, re-read+edit, empty."""
    target = str(ROOT / "docs" / "architecture.md")
    return [
        {"uuid": "pre", "cwd": str(ROOT), "message": {"role": "assistant", "content": []}},
        fake_human("first"),
        fake_assistant("p0", "r0", "Read", {"file_path": target}),
        fake_result("r0", 1000),
        fake_assistant("p1", "r1", "Grep", {"pattern": "x"}),
        fake_result("r1", 500),
        fake_human("second"),
        fake_assistant("p2", "r2", "Read", {"file_path": target}),
        fake_result("r2", 1000),
        fake_assistant("p3", "r3", "Write", {"file_path": str(ROOT / "y.py")}),
        fake_human("third"),
    ]


def self_checks(check: Callable[..., bool]) -> list[bool]:
    """Return acceptance checks for period profiling; `check(label, condition=...) -> bool`."""
    rec = profile_rows(_synthetic(), "s")
    ok = [check("one record per human turn, preamble excluded", condition=len(rec) == 3)]
    ok.append(check("free read bytes summed per period", condition=rec[0]["free_read_bytes"] == 1500))
    ok.append(check("grep counted in bytes but not as a path", condition=rec[0]["distinct_paths"] == 1))
    ok.append(check("first read of a path is not a re-read", condition=rec[0]["reread_count"] == 0))
    ok.append(check("second read of same path counts as re-read", condition=rec[1]["reread_count"] == 1))
    ok.append(check("re-read bytes charged once per call", condition=rec[1]["reread_bytes"] == 1000))
    ok.append(check("edits attributed to their own period", condition=rec[1]["edit_count"] == 1))
    ok.append(
        check(
            "period totals reconcile with session sum",
            condition=sum(r["free_read_bytes"] for r in rec) == 2500,
        )
    )
    ok.append(check("empty trailing period still emits a record", condition=rec[2]["free_read_calls"] == 0))
    paths = read_paths("Bash", {"command": "sed -n '1,5p' docs/protocol.md"}, str(ROOT))
    ok.append(
        check("bash operand resolved against the row cwd", condition=paths == [str(ROOT / "docs" / "protocol.md")])
    )
    ok.append(
        check(
            "glob operand rejected as a path",
            condition=read_paths("Bash", {"command": "cat a/*.py"}, "/") == [],
        )
    )
    redirected = read_paths("Bash", {"command": "ls /srv/x 2>/dev/null"}, "/")
    ok.append(check("redirect target rejected as a path", condition=redirected == ["/srv/x"]))
    return ok
