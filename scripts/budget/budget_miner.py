#!/usr/bin/env python3
"""budget_miner — offline analyzer for change-budget hook trips.

The hook at ``.claude/hooks/change-budget.py`` caps how much an agent may change
between turns where the user speaks. Its two limits (5 metered actions, 15
in-tree edits) were set by judgment, never measured. The question this answers
is whether a trip is a *catch* — the agent was drifting and the forced report
corrected it — or *friction*: the user says "continue" and the same burst
resumes unchanged.

The evidence is already on disk. Every session transcript records the denial the
hook produced, the burst of tool calls that led to it, and whatever the user
typed next. This walks all of them and emits one record per trip. Read-only by
construction: the only writes are the JSONL outputs under ``.claude/logs/``.

What a denial actually looks like in a transcript (it is NOT a
``permissionDecisionReason`` field — that is the hook's *output* shape, not what
gets logged)::

    {"message": {"role": "user", "content": [{"type": "tool_result",
        "is_error": true, "tool_use_id": "toolu_…",
        "content": "6 metered actions since the user last spoke (…)"}]},
     "toolDenialKind": "permission-rule",
     "sourceToolAssistantUUID": "d225c770-…", "cwd": "/srv/hqptuner"}

``sourceToolAssistantUUID`` and ``tool_use_id`` name the blocked call exactly, so
the burst window needs no heuristics.

Read-behavior profiling over *every* leash period, tripped or not, lives in
``budget_read_profile.py`` and runs alongside the trip table — the trip sample is
biased toward bursts that went too far, and a threshold set from it alone would
be a guess.

Usage::

    .venv/bin/python scripts/budget/budget_miner.py              # mine + both tables
    .venv/bin/python scripts/budget/budget_miner.py --self-test  # synthetic acceptances
    .venv/bin/python scripts/budget/budget_miner.py --label-ambiguous
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING

import budget_read_profile as profiler
from budget_common import (
    LOG_DIR,
    ROOT,
    TRANSCRIPT_DIR,
    JsonDict,
    bash_class,
    clean_reply,
    entry_for,
    histogram,
    hook,
    read_rows,
    text_of,
    write_jsonl,
)

if TYPE_CHECKING:
    from collections.abc import Callable

OUT_PATH = LOG_DIR / "budget-trips.jsonl"

#: Both signatures are required alongside toolDenialKind — other permission
#: rules and hooks produce the same kind, and matching on kind alone would sweep
#: them in.
CHANGE_SIG = "metered actions since the user last spoke"
EDIT_SIG = "in-tree edits since the user last spoke"
REPORTED = re.compile(r"(\d+)\s+(?:metered actions|in-tree edits) since the user last spoke")


def trip_of(row: JsonDict) -> tuple[str | None, str]:
    """``(leash, reason_text)`` when this row is a budget denial, else ``(None, "")``."""
    if row.get("toolDenialKind") != "permission-rule":
        return None, ""
    message = row.get("message")
    if not isinstance(message, dict) or not isinstance(message.get("content"), list):
        return None, ""
    for block in message["content"]:
        if not isinstance(block, dict) or block.get("type") != "tool_result" or not block.get("is_error"):
            continue
        text = text_of(block.get("content"))
        if CHANGE_SIG in text:
            return "change", text
        if EDIT_SIG in text:
            return "edit", text
    return None, ""


def blocked_id(row: JsonDict) -> str | None:
    """Return the tool_use id named by a denial row's first tool_result block, or None."""
    message = row.get("message")
    if isinstance(message, dict) and isinstance(message.get("content"), list):
        for block in message["content"]:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                value = block.get("tool_use_id")
                return str(value) if value else None
    return None


# ---- reply labeling --------------------------------------------------------

CONTINUE_WORDS = {
    "continue",
    "go",
    "proceed",
    "yes",
    "y",
    "ok",
    "okay",
    "lgtm",
    "yep",
    "yeah",
    "sure",
    "keep",
    "going",
    "ahead",
    "on",
    "carry",
    "please",
    "do",
    "it",
    "approved",
    "fine",
    "good",
}


def label_reply(text: str) -> str:
    """``command`` | ``continue`` | ``ambiguous`` — command is its own bucket."""
    if not text or text.startswith("/"):
        return "command"
    words = re.sub(r"[^\w\s]", " ", text).lower().split()
    if words and all(word in CONTINUE_WORDS for word in words):
        return "continue"
    return "ambiguous"


# ---- mining -----------------------------------------------------------------


def build_record(rows: list[JsonDict], index: int, session: str) -> JsonDict:
    """One trip record, replaying the burst window the hook counted over."""
    row = rows[index]
    leash, reason = trip_of(row)
    cwd = row.get("cwd") or str(ROOT)
    root = hook._repo_root(cwd)
    denied = blocked_id(row)

    start = max((i for i in range(index) if hook.is_human_row(rows[i])), default=-1)
    end = index - 1
    source = row.get("sourceToolAssistantUUID")
    if source:
        end = next((i for i in range(index) if rows[i].get("uuid") == source), end)

    burst, blocked = [], None
    changes = edits = 0
    for candidate in rows[start + 1 : end + 1]:
        added_c, added_e = hook.count_blocks(candidate, root, cwd)
        changes += added_c
        edits += added_e
        message = candidate.get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        for block in message.get("content") or []:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            entry = entry_for(block, root, cwd)
            if denied and block.get("id") == denied:
                blocked = entry
            else:
                burst.append(entry)

    reply_index = next((i for i in range(index + 1, len(rows)) if hook.is_human_row(rows[i])), None)
    reply = ""
    if reply_index is not None:
        reply = clean_reply(text_of((rows[reply_index].get("message") or {}).get("content")))
    match = REPORTED.search(reason)

    return {
        "key": denied or row.get("uuid"),
        "session": session,
        "timestamp": row.get("timestamp") or "",
        "leash": leash,
        "counts": {"changes": changes, "edits": edits},
        "reported": int(match.group(1)) if match else None,
        "burst": burst,
        "blocked_call": blocked,
        "user_reply": {"text": reply, "label": label_reply(reply)},
        "seen_in": 1,
    }


def mine_rows(rows: list[JsonDict], session: str) -> list[JsonDict]:
    """Return one trip record for every budget denial in a single session's rows."""
    return [build_record(rows, i, session) for i, row in enumerate(rows) if trip_of(row)[0]]


def mine(directory: Path) -> tuple[list[JsonDict], list[str]]:
    """Every trip across every transcript, deduped by blocked-call identity."""
    seen: dict[str, JsonDict] = {}
    warnings = []
    for path in sorted(directory.glob("*.jsonl")):
        for record in mine_rows(read_rows(path), path.stem):
            key = record["key"]
            if key in seen:
                seen[key]["seen_in"] += 1
                continue
            seen[key] = record
            reported, counts = record["reported"], record["counts"]
            actual = counts["changes"] if record["leash"] == "change" else counts["edits"]
            if reported is not None and reported != actual:
                warnings.append(f"{path.stem} {record['timestamp']}: reported {reported}, replayed {actual}")
    return sorted(seen.values(), key=lambda r: (r["timestamp"], r["key"] or "")), warnings


# ---- reporting --------------------------------------------------------------


def summarise(records: list[JsonDict], warnings: list[str]) -> None:
    """Print the trip tables — counts per leash, reply labels, catch rates, class histograms, mismatches."""
    print(f"trips: {len(records)}   (transcripts: {TRANSCRIPT_DIR})")
    leashes = Counter(r["leash"] for r in records)
    for leash in ("change", "edit"):
        print(f"  {leash:<8} {leashes.get(leash, 0)}")

    labels = Counter(r["user_reply"]["label"] for r in records)
    print("\nreply label")
    for name in ("continue", "ambiguous", "command"):
        print(f"  {name:<20} {labels.get(name, 0):>4}")

    llm = Counter(r["user_reply"].get("llm_label") for r in records if r["user_reply"].get("llm_label"))
    if llm:
        print("\nllm label (ambiguous replies)")
        for name, count in llm.most_common():
            print(f"  {name:<20} {count:>4}")
        _catch_rates(records)

    tripping = Counter(r["blocked_call"]["cmd_class"] for r in records if r["blocked_call"])
    histogram("tripping class (the blocked call)", tripping, len(records))
    burst_classes = Counter(e["cmd_class"] for r in records for e in r["burst"])
    histogram("burst classes (calls that ran)", burst_classes, sum(burst_classes.values()))

    if warnings:
        print(f"\nreplay mismatches: {len(warnings)}")
        for line in warnings[:10]:
            print(f"  {line}")


def _verdict(record: JsonDict) -> str:
    """Return the catch/continue verdict for one trip, or "" when it has no denominator."""
    reply = record["user_reply"]
    if reply["label"] == "command":
        return ""
    if reply["label"] == "continue":
        return "CONTINUE"
    return reply.get("llm_label") or ""


def _rate_rows(records: list[JsonDict], keyfn: Callable[[JsonDict], list[str]]) -> None:
    groups: dict[str, Counter[str]] = {}
    for record in records:
        verdict = _verdict(record)
        if not verdict:
            continue
        for name in keyfn(record):
            groups.setdefault(name, Counter())[verdict] += 1
    print(f"  {'group':<20} {'catch':>6} {'cont':>6} {'uncl':>6} {'rate':>7}")
    for name, counts in sorted(groups.items(), key=lambda kv: -sum(kv[1].values())):
        catch, cont, uncl = counts["CORRECTION"], counts["CONTINUE"], counts["UNCLEAR"]
        total = catch + cont + uncl
        print(f"  {name:<20} {catch:>6} {cont:>6} {uncl:>6} {100 * catch / total:>6.1f}%")


def _catch_rates(records: list[JsonDict]) -> None:
    excluded = sum(1 for r in records if r["user_reply"]["label"] == "command")
    print(f"\ncatch rate by leash   ({excluded} command-reply trips excluded from denominators)")
    _rate_rows(records, lambda r: [r["leash"]])
    print("\ncatch rate by tripping class")
    _rate_rows(records, lambda r: [r["blocked_call"]["cmd_class"]] if r["blocked_call"] else [])
    print("\ncatch rate by class present in burst")
    _rate_rows(records, lambda r: sorted({e["cmd_class"] for e in r["burst"]}))


# ---- llm labeling ----------------------------------------------------------

PROMPT = """A coding agent hit a budget limit and was forced to stop and report. \
Below is the report it had just produced (or the calls it had just made), then the user's next message.

Answer with exactly one word: CONTINUE if the user simply told the agent to keep going with the same plan, \
CORRECTION if the user redirected, corrected, questioned, or changed the work, UNCLEAR if you cannot tell.

--- AGENT'S BURST ---
{burst}

--- USER'S REPLY ---
{reply}
"""
VERDICTS = {"CONTINUE", "CORRECTION", "UNCLEAR"}
CLAUDE_CLI = shutil.which("claude") or "claude"


def ask_claude(record: JsonDict) -> str:
    """Ask the `claude` CLI to verdict one trip's reply, retrying once and falling back to UNCLEAR."""
    burst = "\n".join(f"{e['tool']}: {e['preview']}" for e in record["burst"][-8:])
    if record["blocked_call"]:
        burst += f"\n[BLOCKED] {record['blocked_call']['tool']}: {record['blocked_call']['preview']}"
    prompt = PROMPT.format(burst=burst, reply=record["user_reply"]["text"][:4000])
    for _ in range(2):
        try:
            result = subprocess.run(  # noqa: S603
                [CLAUDE_CLI, "-p", prompt], capture_output=True, text=True, timeout=180, check=False
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        answer = result.stdout.strip().upper()
        for verdict in VERDICTS:
            if verdict in answer:
                return verdict
    return "UNCLEAR"


def label_ambiguous(records: list[JsonDict]) -> None:
    """Attach an llm_label to every unlabeled ambiguous trip, and CONTINUE to the plainly affirmative ones."""
    pending = [r for r in records if r["user_reply"]["label"] == "ambiguous" and not r["user_reply"].get("llm_label")]
    for number, record in enumerate(pending, start=1):
        record["user_reply"]["llm_label"] = ask_claude(record)
        print(f"  [{number}/{len(pending)}] {record['timestamp']} -> {record['user_reply']['llm_label']}", flush=True)
    for record in records:
        if record["user_reply"]["label"] == "continue":
            record["user_reply"]["llm_label"] = "CONTINUE"


# ---- self-test --------------------------------------------------------------


def _assistant(uuid: str, tool_id: str, name: str, tool_input: JsonDict) -> JsonDict:
    content = [{"type": "tool_use", "id": tool_id, "name": name, "input": tool_input}]
    return {"uuid": uuid, "cwd": str(ROOT), "message": {"role": "assistant", "content": content}}


def _denial(source: str, tool_id: str, text: str) -> JsonDict:
    block = {"type": "tool_result", "is_error": True, "tool_use_id": tool_id, "content": text}
    return {
        "uuid": f"deny-{tool_id}",
        "cwd": str(ROOT),
        "timestamp": "2026-01-01T00:00:00Z",
        "toolDenialKind": "permission-rule",
        "sourceToolAssistantUUID": source,
        "message": {"role": "user", "content": [block]},
    }


def _human(text: str) -> JsonDict:
    return {"uuid": f"human-{abs(hash(text))}", "cwd": str(ROOT), "message": {"role": "user", "content": text}}


def _burst_rows(count: int, name: str, tool_input: JsonDict) -> list[JsonDict]:
    return [_assistant(f"a{i}", f"t{i}", name, tool_input) for i in range(count)]


def _check(label: str, *, condition: bool) -> bool:
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    return condition


def _trip_checks() -> list[bool]:
    decoy = [
        _human("hi"),
        _assistant("a0", "t0", "Bash", {"command": "sudo ls"}),
        _denial("a0", "t0", "Permission denied by a different rule entirely."),
    ]
    ok = [_check("non-budget denial yields no trip", condition=mine_rows(decoy, "s") == [])]

    rows = [_human("do the thing"), *_burst_rows(6, "Bash", {"command": "sudo docker ps"})]
    rows += [_denial("a5", "t5", f"6 {CHANGE_SIG} (change budget 5)."), _human("<command-name>/clear</command-name>")]
    change = mine_rows(rows, "s")[0]
    ok.append(_check("change trip detected", condition=change["leash"] == "change" and change["reported"] == 6))
    ok.append(_check("replayed count matches report", condition=change["counts"]["changes"] == 6))
    ok.append(_check("blocked call captured", condition=(change["blocked_call"] or {}).get("tool_use_id") == "t5"))
    ok.append(
        _check(
            "blocked call excluded from burst",
            condition=all(e["tool_use_id"] != "t5" for e in change["burst"]),
        )
    )
    changed = [e for e in change["burst"] if e["leash_class"] == hook.CHANGE]
    ok.append(
        _check(
            "burst change entries == counts.changes - 1",
            condition=len(changed) == change["counts"]["changes"] - 1,
        )
    )
    ok.append(_check("tripping class is sudo", condition=change["blocked_call"]["cmd_class"] == "sudo"))
    ok.append(_check("slash-command reply labels command", condition=change["user_reply"]["label"] == "command"))

    rows = [_human("edit them"), *_burst_rows(16, "Write", {"file_path": str(ROOT / "x.py")})]
    rows += [_denial("a15", "t15", f"16 {EDIT_SIG} (edit allowance 15)."), _human("continue")]
    edit = mine_rows(rows, "s")[0]
    ok.append(_check("edit trip detected", condition=edit["leash"] == "edit" and edit["counts"]["edits"] == 16))
    edits = [e for e in edit["burst"] if e["leash_class"] == hook.EDIT]
    ok.append(_check("burst edit entries == counts.edits - 1", condition=len(edits) == 15))
    ok.append(_check("change count untouched on edit trip", condition=edit["counts"]["changes"] == 0))
    ok.append(
        _check(
            "in-tree write classed edit-in-tree",
            condition=edit["blocked_call"]["cmd_class"] == "edit-in-tree",
        )
    )
    ok.append(_check("short affirmative labels continue", condition=edit["user_reply"]["label"] == "continue"))
    return ok


def self_test() -> int:
    """Run the synthetic acceptance checks for miner and profiler, and return a process exit code."""
    ok = [_check("hook imported outside __main__", condition=hook.__name__ != "__main__")]
    ok += _trip_checks()
    ok += profiler.self_checks(_check)
    chained = bash_class("git add -A && git commit -m x")
    ok.append(_check("chained git commit outranks first token", condition=chained == "git-commit"))
    print(f"\n{sum(ok)}/{len(ok)} passed")
    return 0 if all(ok) else 1


# ---- entry point ------------------------------------------------------------


def main(argv: list[str]) -> int:
    """Parse arguments, then self-test or mine the transcripts and write and print both reports."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--self-test", action="store_true", help="run synthetic acceptance checks and exit")
    parser.add_argument("--label-ambiguous", action="store_true", help="label ambiguous replies via `claude -p`")
    parser.add_argument("--transcripts", type=Path, default=TRANSCRIPT_DIR)
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    if args.label_ambiguous and OUT_PATH.exists():
        records = [json.loads(line) for line in OUT_PATH.read_text().splitlines() if line.strip()]
        warnings: list[str] = []
    else:
        records, warnings = mine(args.transcripts)

    if args.label_ambiguous:
        label_ambiguous(records)

    write_jsonl(OUT_PATH, records)
    summarise(records, warnings)

    periods, sidechain = profiler.profile(args.transcripts)
    write_jsonl(profiler.OUT_PATH, periods)
    profiler.summarise(periods, sidechain)

    print(f"\nwrote {OUT_PATH}\nwrote {profiler.OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
