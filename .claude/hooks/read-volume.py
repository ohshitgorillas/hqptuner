#!/usr/bin/env python3
"""read-volume — PostToolUse advisory. Never denies, never meters, never blocks.

The change budget prices what an agent *changes*. Nothing prices what it
*reads*, and reading is where the context window actually goes — the bulk of
free-read bytes are re-reads of files already in context, and heavy read
periods often produce zero edits.

So this emits three advisories, all purely informational:

  0. **Budget counter** — this call was metered, so it cost one of CHANGE_LIMIT.
     Names the count and the reason, because the denial arrives eight commands
     later and by then nothing connects it to the shape that caused it. The
     count comes from the budget's own window and tally, never a second path.


  a. **Byte advisory** — free reads in this leash period crossed another
     multiple of THRESHOLD. Names the read-only agent types by name, because
     "delegate more" is advice nobody can act on and "spawn Explore" is.
  b. **Stale re-read advisory** — this call re-read a path the session had
     already read and nothing has written to since. A path that *was* edited
     since its last read never triggers: re-reading it is correct.

The read advisories fire at most once per leash period (the byte one, once per
crossing); the counter fires on every metered call, which is the point of it.
None of them can stop anything. An advisory that blocks is a budget, and the
budget already exists; this is here to be read and ignored when it's wrong.

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
        for previous, token in zip(tokens, tokens[1:]):
            if previous == "-C":
                continue    # `git -C <dir>`: a working directory, not a file read
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


def _batch_follower(rows, tool_id, sizes):
    """True when this call sits behind another unfinished free call in its own
    assistant row.

    A parallel batch fires one PostToolUse per call, and the siblings' results
    are not in the transcript yet when each fires, so every sibling would
    compute the same crossing and speak. Only the batch's first unfinished free
    call speaks; the rest defer to it.
    """
    for row in rows:
        message = budget._msg(row)
        if message.get("role") != "assistant" or not isinstance(message.get("content"), list):
            continue
        blocks = [b for b in message["content"] if isinstance(b, dict) and b.get("type") == "tool_use"]
        if not any(b.get("id") == tool_id for b in blocks):
            continue
        cwd = row.get("cwd") or ""
        root = budget._repo_root(cwd)
        pending = [b["id"] for b in blocks if b.get("id") not in sizes
                   and budget.classify(b.get("name"), b.get("input"), root, cwd) == budget.FREE]
        return bool(pending) and pending[0] != tool_id
    return False


def why_metered(name, tool_input):
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


def count_metered(data, rows, root, cwd):
    """This call's ordinal among the metered actions since the user last spoke.

    Deliberately the same three functions the denial uses — budget.window() for
    the period, count_blocks() for the tally, _pending_present() for whether
    this call has reached the transcript yet. A second counting path here would
    let the number the agent reads drift from the number that denies it, which
    is the one thing this advisory cannot afford to get wrong.
    """
    period = budget.window(rows)
    count = sum(budget.count_blocks(ev, root, cwd)[0] for ev in period)
    name, tool_input = data.get("tool_name"), data.get("tool_input") or {}
    if not budget._pending_present(period, budget._result_ids(rows), name, tool_input):
        count += 1
    return count


def advise(data, rows):
    """The advisory text for this call, or None. Never denies — there is no
    code path in this file that returns a permission decision."""
    cwd = data.get("cwd") or os.getcwd()
    name, tool_input = data.get("tool_name"), data.get("tool_input") or {}
    root = budget._repo_root(cwd)
    kind = budget.classify(name, tool_input, root, cwd)
    if kind == budget.CHANGE:
        count = count_metered(data, rows, root, cwd)
        return (f"Budget: {count}/{budget.CHANGE_LIMIT} "
                f"(metered: {why_metered(name, tool_input)})")
    if kind != budget.FREE:
        return None

    period = budget.window(rows)
    sizes = _result_sizes(rows)
    calls = calls_in(period, cwd)

    size = len(_text(data.get("tool_response")) or json.dumps(data.get("tool_response") or ""))
    # `counted` only ever sums calls that already have a result, and this call's
    # result is never one of them at PostToolUse time, so its bytes are always
    # the increment — no double counting to guard against.
    tool_id = data.get("tool_use_id")
    counted = sum(sizes.get(c["id"], 0) for c in calls if c["kind"] == budget.FREE)
    after = counted + size
    if after // THRESHOLD > counted // THRESHOLD and not _batch_follower(rows, tool_id, sizes):
        return BYTE_TEXT.format(after=after, agents=AGENTS)

    # Is the pending call already in the transcript? Its tool_use_id says so.
    # Matching on (name, input) would be wrong for exactly the calls this
    # advisory exists to catch: a re-read is byte-identical to the read before
    # it, so the earlier call would be mistaken for this one; and a call whose
    # result is already written would be appended twice and see itself as prior.
    session = calls_in(rows, cwd)
    logged = tool_id is not None and any(c["id"] == tool_id for c in session)
    if not logged:
        session.append({"id": tool_id, "name": name, "input": tool_input,
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
    return _batch(uuid, [(tool_id, name, tool_input)])


def _batch(uuid, calls):
    """One assistant row holding several tool_use blocks: a parallel batch."""
    content = [{"type": "tool_use", "id": tool_id, "name": name, "input": tool_input}
               for tool_id, name, tool_input in calls]
    return {"uuid": uuid, "cwd": HOOK_DIR, "message": {"role": "assistant", "content": content}}


def _result(tool_id, size):
    block = {"type": "tool_result", "tool_use_id": tool_id, "content": "x" * size}
    return {"message": {"role": "user", "content": [block]}}


def _said(text):
    return {"message": {"role": "user", "content": text}}


def _read(index, path, size):
    return [_call(f"a{index}", f"t{index}", "Read", {"file_path": path}), _result(f"t{index}", size)]


def _post(name, tool_input, size, tool_id="pending"):
    return {"cwd": HOOK_DIR, "tool_name": name, "tool_input": tool_input,
            "tool_use_id": tool_id, "tool_response": "y" * size}


def _metered(count, start=0):
    """`count` completed metered calls, each with its result already recorded."""
    rows = []
    for i in range(start, start + count):
        rows += [_call(f"m{i}", f"tm{i}", "Bash", {"command": f"sudo ls {i}"}),
                 _result(f"tm{i}", 10)]
    return rows


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

    three = os.path.join(HOOK_DIR, "three.py")
    batch = [_said("go"), *_read(0, one, THRESHOLD - 1000),
             _batch("b", [("t1", "Read", {"file_path": two}), ("t2", "Read", {"file_path": three})])]
    pair = (advise(_post("Read", {"file_path": two}, 5000, "t1"), batch),
            advise(_post("Read", {"file_path": three}, 5000, "t2"), batch))
    ok.append(_check("a parallel batch crossing the threshold speaks once, from its first call",
                     bool(pair[0]) and pair[1] is None))

    edited = [_said("go"), *_read(0, one, small),
              _call("w", "tw", "Edit", {"file_path": one}), _result("tw", 10)]
    ok.append(_check("re-read of a path edited since is never advised",
                     advise(_post("Read", {"file_path": one}, 10), edited) is None))

    plain = [_said("go"), *_read(0, one, small)]
    logged = advise(_post("Read", {"file_path": one}, small, "t0"), plain)
    first = advise(_post("Read", {"file_path": one}, small), plain)
    ok.append(_check("an already-logged first read is not stale; the second read is, once",
                     logged is None and bool(first) and "one.py" in first))
    plain += [*_read(1, one, small)]
    ok.append(_check("a third read in the same period says nothing",
                     advise(_post("Read", {"file_path": one}, 10), plain) is None))
    plain += [*_read(2, two, 10)]
    ok.append(_check("another stale path in the same period says nothing",
                     advise(_post("Read", {"file_path": two}, 10), plain) is None))
    after_reply = plain + [_said("now do the next thing")]
    ok.append(_check("a new period is advised again",
                     bool(advise(_post("Read", {"file_path": one}, 10), after_reply))))

    two = [_said("go"), *_metered(2)]
    counted = advise(_post("Bash", {"command": "sed -E 's/a/b/' f"}, 10), two)
    silent = (advise(_post("Bash", {"command": "grep -n x f"}, 10), two),
              advise(_post("Edit", {"file_path": os.path.join(HOOK_DIR, "one.py")}, 10), two))
    ok.append(_check("the third metered call in a period is counted, the free ones are not",
                     "3/8" in (counted or "") and not any(silent)))
    ok.append(_check("a metered Agent spawn is counted too",
                     "3/8" in (advise(_post("Agent", {"subagent_type": "general-purpose"}, 10),
                                      two) or "")))
    full = [_said("go"), *_metered(budget.CHANGE_LIMIT - 1)]
    ok.append(_check("the counter at the limit includes the call that just completed",
                     f"{budget.CHANGE_LIMIT}/{budget.CHANGE_LIMIT}"
                     in (advise(_post("Bash", {"command": "sudo ls"}, 10), full) or "")))
    every = [advise(_post("Read", {"file_path": one}, n), plain) for n in (0, 10, 10**6)]
    ok.append(_check("no advisory ever carries a permission decision",
                     all("permissionDecision" not in (t or "") for t in every)))

    print(f"\n{sum(ok)}/{len(ok)} passed")
    return 0 if all(ok) else 1


if __name__ == "__main__":
    sys.exit(self_test()) if "--self-test" in sys.argv else main()
