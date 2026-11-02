#!/usr/bin/env python3
"""Self-test for read-volume.py — `python3 .claude/hooks/read_volume_selftest.py`."""

import importlib.util
import os
import sys


def _load(name):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


read_volume = _load("read-volume")
advise = read_volume.advise
classify = read_volume.classify
READ = read_volume.READ
HOOK_DIR = read_volume.HOOK_DIR
THRESHOLD = read_volume.THRESHOLD


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


def _check(label, condition):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    return condition


def self_test():
    one, two = os.path.join(HOOK_DIR, "one.py"), os.path.join(HOOK_DIR, "two.py")
    small = 1000  # inside one threshold multiple, so the byte advisory cannot fire and mask the re-read checks

    rows = [_said("go"), *_read(0, one, THRESHOLD - 1000), _call("c", "tc", "Read", {"file_path": two})]
    fired = advise(_post("Read", {"file_path": two}, 5000, "tc"), rows)
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
    ok.append(_check("a call whose assistant row is not in the transcript yet stays silent",
                     advise(_post("Read", {"file_path": two}, 5000, "absent"), batch[:-1]) is None))

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

    writes = [_post("Bash", {"command": c}, 10) for c in
              ("sed -E 's/a/b/' f", "sudo ls", "echo x > f", "git commit -m x", "find . -delete")]
    writes.append(_post("Edit", {"file_path": one}, 10))
    writes.append(_post("Agent", {"subagent_type": "general-purpose"}, 10))
    ok.append(_check("a call that may write gets no advisory, however much was read",
                     not any(advise(w, plain) for w in writes)))
    ok.append(_check("read-only Bash is classed as reading",
                     all(classify("Bash", {"command": c}) == READ for c in
                         ("git status", "grep -n x f | head -5", "sed -n 1,5p f", "ls 2>/dev/null"))))
    ok.append(_check("the removed counter line never appears",
                     not any("Budget" in (advise(w, plain) or "") for w in writes)))
    every = [advise(_post("Read", {"file_path": one}, n), plain) for n in (0, 10, 10**6)]
    ok.append(_check("no advisory ever carries a permission decision",
                     all("permissionDecision" not in (t or "") for t in every)))

    print(f"\n{sum(ok)}/{len(ok)} passed")
    return 0 if all(ok) else 1


if __name__ == "__main__":
    sys.exit(self_test())
