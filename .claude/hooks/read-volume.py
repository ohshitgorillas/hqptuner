#!/usr/bin/env python3
"""read-volume — PostToolUse advisory. Never denies, never blocks.

Reading is where the context window actually goes — the bulk of read bytes are
re-reads of files already in context, and heavy read periods often produce zero
edits. So this emits two advisories, both purely informational:

  a. **Byte advisory** — reads since the user last spoke crossed another
     multiple of THRESHOLD. Names the read-only agent types by name, because
     "delegate more" is advice nobody can act on and "spawn Explore" is.
  b. **Stale re-read advisory** — this call re-read a path the session had
     already read and nothing has written to since. A path that *was* edited
     since its last read never triggers: re-reading it is correct.

The stale advisory fires at most once per period (the user speaking starts a
new one); the byte one once per crossing. Neither can stop anything; they are
here to be read and ignored when wrong.

Statelessness is deliberate: everything is derived from the transcript on each
invocation, so there is no state file to go stale, no session id to key, and
nothing to clean up. "Has this already fired this period?" is answered by
replaying the period, not by remembering.
"""
import json
import os
import re
import shlex
import sys

THRESHOLD = 25_600      # bytes of reading per period, per advisory

HOOK_DIR = os.path.dirname(os.path.abspath(__file__))

READ, WRITE = "read", "write"

# Tools that only read, plus the harness's own bookkeeping and messaging.
READ_TOOLS = {"Read", "NotebookRead", "Grep", "Glob", "WebFetch", "WebSearch",
              "ToolSearch", "ListAgents", "TaskOutput", "AskUserQuestion",
              "EnterPlanMode", "ExitPlanMode", "SendMessage", "Skill", "Monitor", "TaskStop"}
# structured edit tools -> the input field naming their target path
EDIT_TOOLS = {"Write": "file_path", "Edit": "file_path", "NotebookEdit": "notebook_path"}
# Agent types that cannot write; exact names only, never a pattern.
READ_ONLY_AGENTS = {"Explore", "Plan", "caveman:cavecrew-investigator"}
# Agent spawns counted as reading: the project's own unbriefed reviewers.
READ_SPAWN_AGENTS = {"user-reviewer", "abuser-reviewer", "pedant-reviewer"}

# Bash commands that only read. Anything else, in any pipe stage, is a write.
READ_COMMANDS = {
    "grep", "egrep", "fgrep", "rg", "ls", "cat", "head", "tail", "wc", "stat",
    "file", "diff", "comm", "cut", "uniq", "nl", "column", "tr", "fold", "rev",
    "tac", "less", "more", "jq", "which", "whereis", "echo", "printf",
    "sha256sum", "md5sum", "b2sum", "cksum",
}
GIT_READ_SUBCMDS = {
    "log", "show", "diff", "status", "blame", "shortlog", "rev-parse", "rev-list",
    "ls-files", "ls-tree", "cat-file", "describe", "name-rev", "whatchanged", "check-ignore",
}
FIND_BAD = {"-exec", "-execdir", "-delete", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"}
# shell syntax that can run or write something a stage list cannot see
BANNED = ("`", "$(", "<(", ">(", "||", "&", ">", "--fix", "--write", "--in-place", "--output")
DEVNULL = re.compile(r"\d*>\s*/dev/null")


def _stage_reads(words, is_head):
    """True when one pipe stage only reads."""
    name, rest = os.path.basename(words[0]), words[1:]
    if name in READ_COMMANDS:
        return True
    if name == "sed":
        short = [a for a in rest if a.startswith("-") and not a.startswith("--")]
        inplace = any("i" in a for a in short)
        quiet = any(a in ("--quiet", "--silent") for a in rest) or any("n" in a for a in short)
        return quiet and not inplace
    if name == "find":
        return not any(a in FIND_BAD for a in rest)
    if not is_head:
        return False
    if name == "cd":
        return len(rest) <= 1
    if name == "git":
        return bool(rest) and rest[0] in GIT_READ_SUBCMDS
    return False


def _bash_reads(command):
    """True only for a Bash command every stage of which only reads; any doubt is a write."""
    command = DEVNULL.sub(" ", command or "")
    if not command.strip() or any(b in command for b in BANNED):
        return False
    for segment in re.split(r"&&|;", command):
        if not segment.strip():
            continue
        for index, stage in enumerate(segment.split("|")):
            words = shlex.split(stage, comments=False, posix=True)
            if not words or not _stage_reads(words, index == 0):
                return False
    return True


def classify(name, tool_input):
    """READ for calls that only read, WRITE for anything else."""
    tool_input = tool_input or {}
    if name in READ_TOOLS:
        return READ
    if name == "Agent":
        agent = tool_input.get("subagent_type")
        return READ if agent in READ_ONLY_AGENTS or agent in READ_SPAWN_AGENTS else WRITE
    if name == "Bash":
        return READ if _bash_reads(tool_input.get("command", "")) else WRITE
    return WRITE


# ---- transcript rows --------------------------------------------------------

# Wrappers the harness puts around, or instead of, what the user typed.
TAGS = ("system-reminder", "local-command-caveat", "local-command-stdout",
        "command-name", "command-message", "command-args", "command-contents",
        "task-notification")
HOOK_CONTEXT = re.compile(r"^.*hook additional context:.*$", re.M)


def _msg(row):
    # transcript rows wrap the API message under "message"; fall back to row
    m = row.get("message")
    return m if isinstance(m, dict) else row


def _rows(path):
    rows = []
    with open(path) as f:
        for line in f:
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    return rows


def _is_human_row(row):
    m = _msg(row)
    if m.get("role") != "user":
        return False
    content = m.get("content")
    if isinstance(content, str):
        return True
    return isinstance(content, list) and not any(
        isinstance(b, dict) and b.get("type") == "tool_result" for b in content)


def _is_genuine_reply(row):
    """A human row carrying prose the user typed, not a slash command or harness text."""
    if not _is_human_row(row):
        return False
    content = _msg(row).get("content")
    text = content if isinstance(content, str) else "\n".join(
        b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    for tag in TAGS:
        text = re.sub(rf"<{tag}>.*?</{tag}>", " ", text, flags=re.S)
        text = re.sub(rf"</?{tag}>", " ", text)
    text = HOOK_CONTEXT.sub(" ", text).strip()
    return bool(text) and not text.startswith("/")


def window(rows):
    """The rows since the user last spoke, oldest first."""
    for i in range(len(rows) - 1, -1, -1):
        if _is_genuine_reply(rows[i]):
            return rows[i + 1:]
    return rows


# ---- path extraction --------------------------------------------------------

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
    if name in EDIT_TOOLS:
        value = tool_input.get(EDIT_TOOLS[name])
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
        content = _msg(row).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_result" and block.get("tool_use_id"):
                sizes[block["tool_use_id"]] = len(_text(block.get("content")))
    return sizes


def _tool_uses(message):
    return [b for b in message["content"] if isinstance(b, dict) and b.get("type") == "tool_use"]


def _kinds(blocks):
    """Each tool_use block with its kind; an unparsable past command counts as nothing."""
    for b in blocks:
        try:
            kind = classify(b.get("name") or "", b.get("input") or {})
        except ValueError:
            continue
        yield b, kind


def calls_in(rows, cwd_default):
    """Every tool_use in order, with the facts the advisories need."""
    out = []
    for row in rows:
        message = _msg(row)
        if message.get("role") != "assistant" or not isinstance(message.get("content"), list):
            continue
        cwd = row.get("cwd") or cwd_default
        for block, kind in _kinds(_tool_uses(message)):
            name, tool_input = block.get("name") or "", block.get("input") or {}
            out.append({
                "id": block.get("id"),
                "name": name,
                "input": tool_input,
                "kind": kind,
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
        if call["kind"] == READ and call["name"] not in NO_PATH_TOOLS:
            if any(p in last_read and last_write.get(p, -1) < last_read[p] for p in call["paths"]):
                stale.append(index)
            for path in call["paths"]:
                last_read[path] = index
        else:
            for path in call["paths"]:
                last_write[path] = index
    return stale


# ---- advisories -------------------------------------------------------------

AGENTS = ", ".join(sorted(READ_ONLY_AGENTS))
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
    """True when this call must defer: another unfinished free call precedes it
    in its own assistant row, or that row is not in the transcript yet.

    A parallel batch fires one PostToolUse per call before the siblings' results
    land, so only the first unfinished free call speaks. A call whose row is
    absent cannot tell whether it has siblings; silence is the safe direction for
    an advisory, and the crossing is absorbed into the next multiple."""
    for row in rows:
        message = _msg(row)
        if message.get("role") != "assistant" or not isinstance(message.get("content"), list):
            continue
        blocks = _tool_uses(message)
        if not any(b.get("id") == tool_id for b in blocks):
            continue
        pending = [b["id"] for b, kind in _kinds(blocks) if b.get("id") not in sizes and kind == READ]
        return bool(pending) and pending[0] != tool_id
    return True


def advise(data, rows):
    """The advisory text for this call, or None. Never denies — there is no
    code path in this file that returns a permission decision."""
    cwd = data.get("cwd") or os.getcwd()
    name, tool_input = data.get("tool_name"), data.get("tool_input") or {}
    if classify(name, tool_input) != READ:
        return None

    period = window(rows)
    sizes = _result_sizes(rows)
    calls = calls_in(period, cwd)

    size = len(_text(data.get("tool_response")) or json.dumps(data.get("tool_response") or ""))
    # `counted` only ever sums calls that already have a result, and this call's
    # result is never one of them at PostToolUse time, so its bytes are always
    # the increment — no double counting to guard against.
    tool_id = data.get("tool_use_id")
    counted = sum(sizes.get(c["id"], 0) for c in calls if c["kind"] == READ)
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
                        "kind": READ, "paths": paths_of(name, tool_input, cwd)})
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
        rows = _rows(data.get("transcript_path") or "")
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


if __name__ == "__main__":
    main()
