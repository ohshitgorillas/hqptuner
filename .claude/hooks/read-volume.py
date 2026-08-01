#!/usr/bin/env python3
"""read-volume — PostToolUse advisory. Never denies, never meters, never blocks.

The change budget prices what an agent *changes*. Nothing prices what it
*reads*, and reading is where the context window actually goes — the bulk of
free-read bytes are re-reads of files already in context, and heavy read
periods often produce zero edits.

So this emits two advisories, both purely informational:

  a. **Byte advisory** — free reads in this leash period crossed another
     multiple of THRESHOLD. Names the read-only agent types by name, because
     "delegate more" is advice nobody can act on and "spawn Explore" is.
  b. **Stale re-read advisory** — this call re-read a path the session had
     already read and nothing has written to since. A path that *was* edited
     since its last read never triggers: re-reading it is correct.

Both fire at most once per leash period (the byte one, once per crossing), and
neither can stop anything. An advisory that blocks is a budget, and the budget
already exists; this is here to be read and ignored when it's wrong.

Statelessness is deliberate: everything is derived from the transcript on each
invocation, so there is no state file to go stale, no session id to key, and
nothing to clean up. "Has this already fired this period?" is answered by
replaying the period, not by remembering.
"""
import importlib.util
import json
import os
import re
import shlex
import sys

THRESHOLD = 25_600      # bytes of free reading per leash period, per advisory

HOOK_DIR = os.path.dirname(os.path.abspath(__file__))
BUDGET = os.path.join(HOOK_DIR, "change-budget.py")


def _load_budget():
    """The change budget hook, for its classifier and its period boundaries.

    Imported rather than reimplemented: "this leash period" has to mean exactly
    what the budget means by it, and "a free read" exactly what the budget
    prices at zero. Two copies of that would drift, and the advisory would then
    be describing a rule nobody enforces.
    """
    spec = importlib.util.spec_from_file_location("change_budget", BUDGET)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


budget = _load_budget()

# ---- path extraction --------------------------------------------------------
# Kept here rather than imported from scripts/: a hook must run without the repo
# checkout being importable. scripts/budget_read_profile.py carries the same
# parser for the offline analysis, and the two are meant to stay in step.

NO_PATH_TOOLS = {"Grep", "Glob", "WebFetch", "WebSearch", "Agent", "Task"}
PATH_FIELDS = {"Read": "file_path", "NotebookRead": "notebook_path"}
GLOB_CHARS = re.compile(r"[*?\[\]]")
REDIRECT = re.compile(r"^\d*[<>]")


def _resolve(path, cwd):
    return os.path.abspath(os.path.join(cwd or "/", os.path.expanduser(path)))


def _bash_paths(command, cwd):
    """File operands of a shell command, parsed conservatively.

    A token counts only when it looks like a path and nothing else: it holds a
    slash, carries no glob metacharacter, is not a flag, not a URL, not a
    redirect (`2>/dev/null` survives shlex as one token), not under /dev. A
    missed path costs a silent advisory; an invented one costs a wrong nag.
    """
    found = []
    for segment in re.split(r"&&|\|\||;|\|", command or ""):
        try:
            tokens = shlex.split(segment, comments=False, posix=True)
        except ValueError:
            tokens = segment.split()
        for token in tokens[1:]:
            if token.startswith(("-", "$")) or "/" not in token or "://" in token:
                continue
            if GLOB_CHARS.search(token) or REDIRECT.match(token) or token.startswith("/dev/"):
                continue
            found.append(_resolve(token, cwd))
    return found


def paths_of(name, tool_input, cwd):
    """Local paths this call names. Grep/Glob take patterns, not paths."""
    tool_input = tool_input or {}
    if name in NO_PATH_TOOLS:
        return []
    if name in PATH_FIELDS:
        value = tool_input.get(PATH_FIELDS[name])
        return [_resolve(str(value), cwd)] if value else []
    if name in budget.EDIT_TOOLS:
        value = tool_input.get(budget.EDIT_TOOLS[name])
        return [_resolve(str(value), cwd)] if value else []
    if name == "Bash":
        return _bash_paths(tool_input.get("command", ""), cwd)
    return []


# ---- transcript walk --------------------------------------------------------


def _text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") in ("text", "tool_result"):
                inner = block.get("content") if block.get("type") == "tool_result" else block.get("text")
                parts.append(_text(inner))
        return "\n".join(parts)
    return ""


def _result_sizes(rows):
    sizes = {}
    for row in rows:
        content = budget._msg(row).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_result" and block.get("tool_use_id"):
                sizes[block["tool_use_id"]] = len(_text(block.get("content")))
    return sizes


def calls_in(rows, cwd_default):
    """Every tool_use in order, with the facts the advisories need."""
    out = []
    for row in rows:
        message = budget._msg(row)
        if message.get("role") != "assistant" or not isinstance(message.get("content"), list):
            continue
        cwd = row.get("cwd") or cwd_default
        root = budget._repo_root(cwd)
        for block in message["content"]:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            name = block.get("name") or ""
            tool_input = block.get("input") or {}
            out.append({
                "id": block.get("id"),
                "name": name,
                "input": tool_input,
                "kind": budget.classify(name, tool_input, root, cwd),
                "paths": paths_of(name, tool_input, cwd),
            })
    return out


def stale_events(calls):
    """Index of every call that re-read a path nothing had written to since.

    Session-scoped, in order. A path read, then written, then read again is not
    stale — that read is the only way to see the new content.
    """
    last_read, last_write, stale = {}, {}, []
    for index, call in enumerate(calls):
        if call["kind"] == budget.FREE and call["name"] not in NO_PATH_TOOLS:
            if any(p in last_read and last_write.get(p, -1) < last_read[p] for p in call["paths"]):
                stale.append(index)
            for path in call["paths"]:
                last_read[path] = index
        else:
            for path in call["paths"]:
                last_write[path] = index
    return stale


# ---- advisories -------------------------------------------------------------

AGENTS = ", ".join(sorted(budget.READ_ONLY_AGENTS))
BYTE_TEXT = (
    "Read-volume advisory (not a limit, nothing is blocked): {after:,} bytes of free reading "
    "since the user last spoke. If the answer is small and the material is large, a read-only "
    "subagent reads it instead of your context window — available types: {agents}. "
    "Ignore this if you are reading the thing you are about to change."
)
STALE_TEXT = (
    "Re-read advisory (not a limit, nothing is blocked): {path} is already in your context from "
    "earlier this session, and nothing has written to it since. Scroll back rather than re-reading, "
    "unless you have reason to think the file changed."
)


def advise(data, rows):
    """The advisory text for this call, or None. Never denies — there is no
    code path in this file that returns a permission decision."""
    cwd = data.get("cwd") or os.getcwd()
    name, tool_input = data.get("tool_name"), data.get("tool_input") or {}
    root = budget._repo_root(cwd)
    if budget.classify(name, tool_input, root, cwd) != budget.FREE:
        return None

    period = budget.window(rows)
    sizes = _result_sizes(rows)
    calls = calls_in(period, cwd)

    size = len(_text(data.get("tool_response")) or json.dumps(data.get("tool_response") or ""))
    # `counted` only ever sums calls that already have a result, and this call's
    # result is never one of them at PostToolUse time, so its bytes are always
    # the increment — no double counting to guard against.
    counted = sum(sizes.get(c["id"], 0) for c in calls if c["kind"] == budget.FREE)
    after = counted + size
    if after // THRESHOLD > counted // THRESHOLD:
        return BYTE_TEXT.format(after=after, agents=AGENTS)

    # Is the pending call already in the transcript? Identify it as the most
    # recent tool_use with no result yet. Matching on (name, input) alone would
    # be wrong for exactly the calls this advisory exists to catch: a re-read is
    # byte-identical to the read before it, so the earlier call would be
    # mistaken for this one and the re-read would never be seen.
    session = calls_in(rows, cwd)
    logged = bool(session) and (session[-1]["name"] == name
                                and session[-1]["input"] == tool_input
                                and session[-1]["id"] not in sizes)
    if not logged:
        session.append({"id": None, "name": name, "input": tool_input,
                        "kind": budget.FREE, "paths": paths_of(name, tool_input, cwd)})
    stale = stale_events(session)
    if stale and stale[-1] == len(session) - 1:
        # once per period: only the first stale re-read in this period speaks
        first = len(session) - len(calls_in(period, cwd)) - (0 if logged else 1)
        if not any(index >= first for index in stale[:-1]):
            path = next(iter(paths_of(name, tool_input, cwd)), "the file")
            return STALE_TEXT.format(path=path)
    return None


def main():
    try:
        data = json.loads(sys.stdin.read())
        rows = budget._rows(data.get("transcript_path") or "")
    except Exception:
        return  # advisory only: never interfere with the tool call
    try:
        text = advise(data, rows)
    except Exception:
        return
    if text:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": text,
            }
        }))


# ---- self-test --------------------------------------------------------------


def _call(uuid, tool_id, name, tool_input):
    content = [{"type": "tool_use", "id": tool_id, "name": name, "input": tool_input}]
    return {"uuid": uuid, "cwd": HOOK_DIR, "message": {"role": "assistant", "content": content}}


def _result(tool_id, size):
    block = {"type": "tool_result", "tool_use_id": tool_id, "content": "x" * size}
    return {"message": {"role": "user", "content": [block]}}


def _said(text):
    return {"message": {"role": "user", "content": text}}


def _read(index, path, size):
    return [_call(f"a{index}", f"t{index}", "Read", {"file_path": path}), _result(f"t{index}", size)]


def _post(name, tool_input, size):
    return {"cwd": HOOK_DIR, "tool_name": name, "tool_input": tool_input, "tool_response": "y" * size}


def _check(label, condition):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    return condition


def self_test():
    one, two = os.path.join(HOOK_DIR, "one.py"), os.path.join(HOOK_DIR, "two.py")
    small = 1000        # well inside one threshold multiple, so the byte
    #                     advisory cannot fire and mask the re-read checks

    rows = [_said("go"), *_read(0, one, THRESHOLD - 1000)]
    fired = advise(_post("Read", {"file_path": two}, 5000), rows)
    ok = [_check("byte advisory fires on crossing the threshold", bool(fired))]
    ok.append(_check("byte advisory names the read-only agent types", "Explore" in (fired or "")))
    rows += [*_read(1, two, 5000)]
    ok.append(_check("byte advisory does not fire again inside the same multiple",
                     advise(_post("Read", {"file_path": os.path.join(HOOK_DIR, "three.py")}, 100), rows) is None))

    edited = [_said("go"), *_read(0, one, small),
              _call("w", "tw", "Edit", {"file_path": one}), _result("tw", 10)]
    ok.append(_check("re-read of a path edited since is never advised",
                     advise(_post("Read", {"file_path": one}, 10), edited) is None))

    plain = [_said("go"), *_read(0, one, small)]
    first = advise(_post("Read", {"file_path": one}, small), plain)
    ok.append(_check("stale re-read is advised once", bool(first) and "one.py" in first))
    plain += [*_read(1, one, small)]
    ok.append(_check("a third read in the same period says nothing",
                     advise(_post("Read", {"file_path": one}, 10), plain) is None))
    plain += [*_read(2, two, 10)]
    ok.append(_check("another stale path in the same period says nothing",
                     advise(_post("Read", {"file_path": two}, 10), plain) is None))
    after_reply = plain + [_said("now do the next thing")]
    ok.append(_check("a new period is advised again",
                     bool(advise(_post("Read", {"file_path": one}, 10), after_reply))))

    ok.append(_check("a metered call is never advised",
                     advise(_post("Bash", {"command": "sudo ls"}, 10), plain) is None))
    every = [advise(_post("Read", {"file_path": one}, n), plain) for n in (0, 10, 10**6)]
    ok.append(_check("no advisory ever carries a permission decision",
                     all("permissionDecision" not in (t or "") for t in every)))

    print(f"\n{sum(ok)}/{len(ok)} passed")
    return 0 if all(ok) else 1


if __name__ == "__main__":
    sys.exit(self_test()) if "--self-test" in sys.argv else main()
