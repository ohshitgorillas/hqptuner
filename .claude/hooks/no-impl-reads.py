#!/usr/bin/env python3
"""PreToolUse hook: keep a blind agent out of the implementation.

Wired from the `hooks:` frontmatter of `.claude/agents/gauntlet-arbiter.md` and
`.claude/agents/gauntlet-scrivener.md`, so it binds those subagents only. The
main agent and every other agent are untouched, deliberately: a session-wide
`permissions.deny` would blind the one agent that has to read the code to
adjudicate a failing test.

The rule those two work under is that a spec is judged, and a test written,
from the behavior contract and never from the code under test. A test shaped
against the implementation mirrors it, and goes green on an implementation
that is wrong in exactly the way the main agent was wrong. A prompt alone does not
enforce that: the agent that must not peek is the same agent deciding whether
it peeked.

**This hook is an allowlist, not a blocklist.** A blind agent may read the
spec's own sources and nothing else. That is the portable direction — a
blocklist has to know what this repo calls its source directory, and gets it
wrong the first time someone adds one — and it fails closed: an unlisted path
is denied, and the denial names the file to widen.

Allowed by default: `docs/`, `tests/`, `state/`, and documentation files at the
repo root (`*.md`, `*.txt`, `*.pdf`). `state/` is the workflow's own scratch,
never the repository's source.

`gauntlet/` is a base of its own at the repo root, and it is a denial, not a
widening. Everything the gauntlet's agents write lives there, and three of the
four kinds quote implementation citations: an approved plan resolves
`file:line` into the source, a draft does so unreviewed, and a reviewer round
quotes the plan back. So the base is denied entire, with three leaves re-allowed
inside it: `gauntlet/specs/approved/`, the approved spec block a blind agent
works from; `gauntlet/red/`, the red run a blind writer must certify; and
`gauntlet/merge/`, the evidence the bailiff is spawned to read. Denying those
two moved the certification to the main agent, which is the inversion this hook
exists to prevent. No denied subtree nests inside an allowed one: `docs/`,
`tests/` and `state/` are allowed the whole way down, and the three re-allowed
leaves sit inside the denied base, which is the harmless direction. Both tests run before the allow list below, so a fifth artifact
directory added later is blind-safe until someone deliberately opens it, and no
`blind-reads.json` entry can re-open the plans, the drafts or the rounds.

The list is not configurable. What `blind-reads.json` beside this file moves is
where the entries point, never which entries there are: `tests_dir` is the
blind writer's lane, `docs_dir` the prose, and `gauntlet_dir` the base whose
`specs/approved` subtree is the one artifact a blind agent works from. All
three are read through `shell_shapes`, which refuses any set of names that
overlap, so no value here can put the lane over the prose or the base under
either. The file itself is on the list too, because a blind agent's definition
names those directories only as `<tests dir>` and `<docs dir>` and this is
where the names resolve. A spec source that lives elsewhere belongs under the
docs directory or beside the block in the approved-specs lane, not on a list
that could grow to reach the implementation.

A suite run is a read: a traceback through the code is the cost of running
the suite at all, and running the suite is the point. `shell_shapes.is_runner`
recognizes a run by its whole invocation, which is the only way to tell `node
--test` from `node -e`, and the kit's own `scripts/blind.sh test <path>` is in
its table. An inline-script flag (`-e`, `-c`, `-p`, `--eval`, `--print`)
disqualifies any command.

Blocked for those agents:

  * `Read` of any path outside the allowlist
  * `Grep`/`Glob` rooted outside it, and `Grep`/`Glob` with no path at all
    (an unrooted search sweeps the tree and prints matching source lines)
  * a `Bash` command naming a path outside it, by any reader the tool reaches
  * a `Bash` command that reads recursively with nothing to root it — `grep
    -rn x .`, `grep -rn x`, `rg x` — which sweeps the tree the same way an
    unrooted `Grep` does
  * a `Bash` fetch of a served source file from localhost (`.js`, `.css`,
    `.map`, `.ts`, `.py`) — the same source by another road
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell_shapes as sh  # noqa: E402

#: the blind writer's lane, `tests` unless `blind-reads.json` names another
TESTS = sh.tests_dir()
#: the prose a blind agent may read, `docs` unless the file names another
DOCS = sh.docs_dir()
#: the one file that says where those are, readable by a blind agent whose
#: definition names them as `<tests dir>` and `<docs dir>` and nothing more concrete
CONFIG = ".claude/hooks/blind-reads.json"
#: the gauntlet's own artifact base at the repo root, denied entire
GAUNTLET_BASE = sh.gauntlet_dir()
#: the one subtree of it a blind agent works from: the approved spec block
GAUNTLET_SPECS = sh.specs_lane()
#: the chain's own run artifacts under that base: the red run a blind writer
#: certifies, and the merge evidence the bailiff reads
GAUNTLET_RED = GAUNTLET_BASE + "/red"
GAUNTLET_MERGE = GAUNTLET_BASE + "/merge"
#: every leaf re-allowed inside the denied base, and the whole of what is
#: readable under it
GAUNTLET_LEAVES = (GAUNTLET_SPECS, GAUNTLET_RED, GAUNTLET_MERGE)
#: repo-relative paths a blind agent may read; a trailing `/` means the subtree
DEFAULT_ALLOW = (
    DOCS + "/",
    TESTS + "/",
    "state/",
    GAUNTLET_SPECS + "/",
    GAUNTLET_RED + "/",
    GAUNTLET_MERGE + "/",
    CONFIG,
)
#: repo-root files a blind agent may read, by extension
DEFAULT_ROOT_FILES = (".md", ".txt", ".pdf")

#: commands that read a whole tree; unrooted, they sweep the implementation
RECURSIVE_ALWAYS = frozenset({"find", "rg", "tree"})
#: commands that read a whole tree only when told to
RECURSIVE_ON_FLAG = {"grep": "rR", "egrep": "rR", "fgrep": "rR", "ls": "R"}
#: path candidates that root a search at the whole tree, which is no root
UNROOTED = frozenset({".", ".."})

#: a served source file fetched from a local dev server
SERVED = re.compile(
    r"(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/[^\s\"']*\.(?:js|css|map|ts|py)\b"
)

_WHY = (
    "Blind agent: the implementation is out of bounds. Work from the approved spec "
    f"block at {GAUNTLET_SPECS}/, the rest of {DOCS}/, and {TESTS}/. If the spec does "
    "not say what the behavior is, report that gap instead of reading the code to "
    f"find out. If this path is genuinely a spec source, it belongs under {DOCS}/ or in "
    f"{GAUNTLET_SPECS}/, which is the only part of {GAUNTLET_BASE}/ that is yours: the "
    "plans, the drafts and the reviewer rounds quote implementation citations, and "
    "no list reaches them. (hooks/no-impl-reads.py)"
)
_UNROOTED = (
    f"Give Grep/Glob an explicit path ({TESTS}/, {DOCS}/, {GAUNTLET_SPECS}/): an "
    "unrooted search sweeps the whole tree and prints its source. " + _WHY
)


def repo_root(start: str) -> str | None:
    path = os.path.abspath(start or ".")
    while True:
        if os.path.exists(os.path.join(path, ".git")):
            return path
        parent = os.path.dirname(path)
        if parent == path:
            return None
        path = parent


def _under(rel: str, name: str) -> bool:
    """Is this repo-relative path that directory, or something inside it?

    The bare directory counts. A test that only asks whether the path starts
    with the directory plus a separator misses `Grep` rooted at the directory
    itself, which is the one search that returns everything in it.
    """
    prefix = name.replace("/", os.sep)
    return rel == prefix or rel.startswith(prefix + os.sep)


def readable(target: str, root: str | None, cwd: str) -> bool:
    """Is this path one of the spec's own sources?

    An allowlist entry is anchored: `docs/` is the repository's own `docs`,
    not any directory called `docs` at any depth. Matching at depth reads
    `src/docs/impl.py` as documentation, which hands the blind agent the
    implementation under a directory name it does not control.

    Outside a checkout there is no repo-relative path to test, so the path is
    anchored at the filesystem root instead and almost nothing is readable.
    Failing closed there is the point: a blind agent in an unknown tree stays
    blind.
    """
    if not target:
        return True
    resolved = os.path.abspath(os.path.join(cwd or (root or "."), target))
    #: a path inside `.claude/worktrees/<slug>` is anchored at that worktree, not
    #: at the checkout the session was started in. A blind agent is handed the
    #: absolute paths of files in its own worktree, and against the session root
    #: every one of them reads as `.claude/worktrees/<slug>/tests/...` — outside
    #: the allowlist — so its own spec block and its own tests were denied to it.
    #: `shell_shapes.root_by_name` is the rule the three lane hooks already use;
    #: this hook carried a private `repo_root` that did not know a worktree.
    base = sh.root_by_name(resolved) or root
    if base:
        rel = os.path.relpath(resolved, base)
        if rel.startswith(".."):
            return False
    else:
        rel = resolved.lstrip(os.sep)
    #: the gauntlet's own base, in the one order that works. The re-allowed
    #: leaves are tested first and are readable; the base is tested second and is
    #: denied; the
    #: allow list runs last. Reversing the first two refuses the blind writer the
    #: block it is spawned against, and putting either behind the allow list lets
    #: a `blind-reads.json` entry hand over the plans, the drafts and the rounds,
    #: every one of which carries implementation citations. The matching
    #: `DEFAULT_ALLOW` entry is therefore unreachable here, and is kept because
    #: the invariant self-test computes over that list: it is what makes the
    #: deliberate leaf visible to the case, which catches a later hand that
    #: rebases one of the two without the other.
    if any(_under(rel, leaf) for leaf in GAUNTLET_LEAVES):
        return True
    if _under(rel, GAUNTLET_BASE):
        return False
    #: the allowlist runs next: `tests` is the allowed directory itself, not a
    #: root file that happens to carry no extension
    for entry in DEFAULT_ALLOW:
        name = entry.rstrip("/").replace("/", os.sep)
        if entry.endswith("/"):
            if rel == name or rel.startswith(name + os.sep):
                return True
        elif rel == name:
            return True
    #: a documentation file sitting at the repo root, by extension
    return base is not None and os.sep not in rel and (
        os.path.splitext(rel)[1].lower() in DEFAULT_ROOT_FILES
    )


def _candidates(words: list[str]) -> list[str]:
    """The words of a command that look like paths."""
    return [
        w
        for w in words[1:]
        #: a URL is not a path: `SERVED` above rules on the ones that carry source,
        #: and an API call over HTTP reaches no file this hook is guarding
        if "://" not in w
        and ("/" in w or os.path.splitext(w)[1])
        and not w.startswith("-")
    ]


def _reads_recursively(words: list[str]) -> bool:
    """Does this command walk a whole tree?

    `find`, `tree` and `rg` always do — `rg` needs no flag for it. The grep
    family and `ls` do when told to, and they are told in three spellings: a
    standalone `-r`, a clustered short option carrying it (`-rn`), or the long
    `--recursive`.
    """
    head = os.path.basename(words[0]) if words else ""
    if head in RECURSIVE_ALWAYS:
        return True
    letters = RECURSIVE_ON_FLAG.get(head)
    if letters is None:
        return False
    return any(
        w == "--recursive"
        or (w.startswith("-") and not w.startswith("--") and any(c in w[1:] for c in letters))
        for w in words[1:]
    )


def _unrooted_sweep(words: list[str]) -> bool:
    """A recursive reader with nothing to root it is a read of the whole tree."""
    if not _reads_recursively(words):
        return False
    return all(w.rstrip(os.sep) in UNROOTED for w in _candidates(words))


def _git_subcommand(words: list[str]) -> str | None:
    """The subcommand of a git invocation, past any global option.

    `git -C <dir> show` and `git --no-pager show` put the option in `words[1]`,
    so reading `words[1]` as the subcommand misses both. A bare `git` has no
    subcommand at all.
    """
    i = 1
    while i < len(words):
        word = words[i]
        if word in ("-C", "-c", "--git-dir", "--work-tree", "--namespace"):
            i += 2
            continue
        if word.startswith("-"):
            i += 1
            continue
        return word
    return None


def _git_prints_content(words: list[str]) -> bool:
    """Does this git command print file content?

    Metadata subcommands print commits, refs and names. Everything else prints
    some of the tree, and an unrecognized subcommand is treated as content --
    the same direction the rest of this hook takes, where unlisted is denied.
    """
    sub = _git_subcommand(words)
    if sub is None:
        return True
    if sub == "log":
        return any(w in sh.GIT_PATCH_FLAGS for w in words[1:])
    return sub not in sh.GIT_METADATA


def _git_candidates(words: list[str]) -> list[str]:
    """The path-shaped words of a git command, with any `<rev>:` prefix removed.

    `git show HEAD:gauntlet/specs/approved/<slug>.txt` is the supported way for a blind
    agent to read an allowlisted spec out of history. Scored literally, the revision
    prefix makes that path a filename that exists nowhere, so the read the
    escape hatch exists for was refused.
    """
    out = []
    for word in _candidates(words):
        head, sep, tail = word.partition(":")
        out.append(tail if sep and "/" not in head else word)
    return out


def _strip_env(words: list[str]) -> list[str]:
    """Drop a leading `VAR=value` prefix, so the head word is the command.

    The suite run a blind writer is told to make is `PYTHONPATH=$(pwd) pytest
    ...`. Without this the head word is the assignment, no runner is recognized,
    and the run falls through to the path test.
    """
    i = 0
    while i < len(words) and re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*=.*", words[i]):
        i += 1
    return words[i:]


def _bash_verdict(command: str, root: str | None, cwd: str) -> str | None:
    """Why this shell command is refused, or None to let it through.

    The stages are walked in order carrying the directory a `cd` moved them to,
    because a blind agent works by `cd <its worktree> && <run>`: the tree is
    named once, as a `cd` target, and every path after it is relative to that
    tree. Scoring that target as a path to allowlist denied the whole idiom, and
    with it every run of the tests the agent had just written.
    """
    here = cwd
    for stage in sh.segments(command):
        words = _strip_env(sh.words_of(stage))
        if not words:
            continue
        target = sh.cd_target(words)
        if target is not None:
            #: `cd`, `cd -` and `cd ~...` move where this walk cannot follow
            if target in ("", "-") or target.startswith("~"):
                here = cwd
            else:
                here = os.path.abspath(os.path.join(here, target))
            continue
        head = os.path.basename(words[0])
        if sh.is_runner(words):
            continue
        if _unrooted_sweep(words):
            return _UNROOTED
        if head == "git":
            #: a git command that prints content carries no path of its own when
            #: it is spelled `git show <rev>`, so the candidate test has nothing
            #: to fail on and the implementation goes out whole
            if _git_prints_content(words):
                paths = _git_candidates(words)
                if not paths or any(not readable(w, root, here) for w in paths):
                    return _WHY
            continue
        if any(not readable(w, root, here) for w in _candidates(words)):
            return _WHY
    return None


def _verdict(name: str, tool_input: dict, root: str | None, cwd: str) -> str | None:
    """Why this call is refused, or None to let it through."""
    if name == "Read":
        return None if readable(tool_input.get("file_path", ""), root, cwd) else _WHY
    if name in ("Grep", "Glob"):
        target = tool_input.get("path")
        if target is None:
            return _UNROOTED
        return None if readable(target, root, cwd) else _WHY
    if name == "Bash":
        command = sh.command_of(tool_input)
        if SERVED.search(command):
            return _WHY
        return _bash_verdict(command, root, cwd)
    return None


#: the tools this hook decides. A call of anything else is not its subject,
#: and a malformed one is not its refusal to give -- see `sh.payload_fault`.
GUARDS = ("Read", "Grep", "Glob", "Bash")


def main() -> None:
    def verdict(name: str, tool_input: dict, payload: dict) -> str | None:
        #: inside the closure, so that a root that will not resolve is a
        #: refusal like any other rather than a crash read as one
        cwd = sh.cwd_of(payload)
        return _verdict(name, tool_input, repo_root(cwd), cwd)

    sh.hook_main(verdict, guards=GUARDS)


def _config_parses() -> bool:
    """That the per-repo config beside this hook reads, where there is one.

    `sh.config` answers a malformed file with an empty config, and that is the
    right answer at the gate: an empty config names no lane, so the lane is
    `tests`. It is also silent, so a typo in the file moves a repo's lane back
    to the default and says nothing about it. The runtime keeps the safe
    direction; this line is where the typo becomes visible instead of free.
    """
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "blind-reads.json")
    if not os.path.exists(path):
        return True  # no per-repo value here; nothing to parse
    try:
        with open(path, encoding="utf-8") as fh:
            return isinstance(json.load(fh), dict)
    except (OSError, ValueError):
        return False


def _no_denied_nesting() -> bool:
    """Is every allowed root free of a denied subtree beneath it?

    The invariant the layout exists to hold, computed rather than asserted by
    hand: a denied tree inside an allowed one is readable by a sweep rooted at
    the ancestor while its contents are denied one by one, which is the hole
    the `docs/gauntlet/` nesting opened. The other direction — the re-allowed
    leaf inside the denied base — is harmless and is excluded here.

    `DEFAULT_ALLOW` carries the directories the real `blind-reads.json` beside
    this file names, so a repo whose `tests_dir` or `docs_dir` resolved to the
    artifact base or an ancestor of it would fail this case rather than silently
    re-open the base, were `shell_shapes.dirs_from` not already refusing every
    overlapping set.
    """
    for entry in DEFAULT_ALLOW:
        root = entry.rstrip("/")
        if not root:
            continue
        #: the denied base sits at or under this allowed root
        if _under(GAUNTLET_BASE, root):
            return False
        #: the root sits inside the denied base, on a branch that is not the
        #: one re-allowed leaf, so everything it names is denied to a read
        if _under(root, GAUNTLET_BASE) and not any(
            _under(root, leaf) for leaf in GAUNTLET_LEAVES
        ):
            return False
    return True


def self_test() -> int:
    """Pin the spec lines of the blind-read allowlist."""
    root = "/repo"
    tree = f"{root}/.claude/worktrees/demo-spec"

    #: the lines below spell the kit's defaults; under a project that moved one
    #: of the three directories, the same lines run at that project's own. The
    #: respelling sits here rather than on `read` and `bash`, so the payloads
    #: built by hand below carry it too, and no string gets two passes
    PATHS = ("file_path", "path", "command")

    def call(tool: str, tool_input: dict) -> str | None:
        moved = {
            key: sh.respell(value) if key in PATHS and isinstance(value, str) else value
            for key, value in tool_input.items()
        }
        return _verdict(tool, moved, root, root)

    def read(path: str) -> str | None:
        return call("Read", {"file_path": path})

    def bash(cmd: str) -> str | None:
        return call("Bash", {"command": cmd})

    denied, allowed = sh.denied, sh.allowed
    lines = {
        "1 the spec's own sources are readable, the rest is not": all(
            (
                allowed(read(f"{root}/docs/testing.md")),
                allowed(read(f"{root}/tests/test_lane.py")),
                allowed(read(f"{root}/gauntlet/specs/approved/slug.txt")),
                allowed(read(f"{root}/README.md")),
                denied(read(f"{root}/src/core/manager.py")),
                denied(read(f"{root}/app/main.py")),
                denied(read("/etc/passwd")),
            )
        ),
        "2 an unrooted search is denied, a rooted one follows the allowlist": all(
            (
                denied(call("Grep", {"pattern": "def resolve"})),
                denied(call("Glob", {"pattern": "**/*.py"})),
                allowed(call("Grep", {"pattern": "def test_", "path": f"{root}/tests"})),
                denied(call("Grep", {"pattern": "def resolve", "path": f"{root}/src"})),
            )
        ),
        "3 shell readers follow the same list, runners and API calls pass": all(
            (
                allowed(bash(f"cat {root}/docs/testing.md")),
                denied(bash(f"cat {root}/src/core/manager.py")),
                denied(bash("sed -n '1,40p' src/core/manager.py")),
                allowed(bash("pytest tests/test_lane.py -q")),
                allowed(bash("curl -s http://127.0.0.1:8090/api/state")),
                denied(bash("curl -s http://127.0.0.1:8090/components/copy.js")),
            )
        ),
        "4 an interpreter reading source is denied, a suite run is not": all(
            (
                #: the runner question is the whole invocation, never the head
                #: word: `node -e` and `node --test` share one
                denied(bash("node -e \"console.log(require('fs').readFileSync('src/core.py','utf8'))\"")),
                denied(bash("python -c \"print(open('src/core.py').read())\"")),
                allowed(bash("pytest tests/test_lane.py -q")),
                allowed(bash("npx vitest run")),
                allowed(bash("node --test tests/t.test.js")),
            )
        ),
        "5 a recursive search with no root is denied, a rooted one is not": all(
            (
                denied(bash("grep -rn secret .")),
                denied(bash("grep -rn secret")),
                denied(bash("grep --recursive secret .")),
                denied(bash("rg secret")),
                allowed(bash("grep -rn secret docs/")),
                allowed(bash("grep -n secret README.md")),
            )
        ),
        "6 an allowlisted directory name counts at the root and nowhere else": all(
            (
                denied(read(f"{root}/src/docs/impl.py")),
                denied(read(f"{root}/src/tests/impl.py")),
                denied(call("Grep", {"pattern": "x", "path": f"{root}/src/specs"})),
                allowed(read(f"{root}/docs/testing.md")),
                allowed(read(f"{root}/tests/test_lane.py")),
            )
        ),
        "7 a blind agent's own worktree is anchored at that worktree": all(
            (
                allowed(read(f"{tree}/gauntlet/specs/approved/demo.txt")),
                allowed(read(f"{tree}/tests/test_demo.py")),
                allowed(call("Grep", {"pattern": "x", "path": f"{tree}/tests"})),
                #: the worktree carries its own copy of these, and neither is a
                #: spec source in either tree
                denied(read(f"{tree}/src/core/manager.py")),
                denied(read(f"{tree}/.claude/hooks/no-impl-reads.py")),
                #: the run the agent is told to make, from inside its own tree
                allowed(bash(f"cd {tree} && PYTHONPATH=$(pwd) .venv/bin/pytest tests/t.py -q")),
                #: a `cd` does not launder a read: the path is resolved from there
                denied(bash(f"cd {tree}/src && cat core.py")),
            )
        ),
        "8 the chain's own run artifacts are readable, so the writer certifies its run": all(
            (
                allowed(read(f"{root}/gauntlet/red/demo.txt")),
                allowed(read(f"{root}/gauntlet/merge/demo.txt")),
                allowed(read(f"{root}/state/gates/pytest.txt")),
                denied(read(f"{root}/src/state/manager.py")),
            )
        ),
        "9 the gauntlet's base is denied, three leaves re-allowed": all(
            (
                allowed(read(f"{root}/gauntlet/specs/approved/demo.txt")),
                allowed(read(f"{root}/gauntlet/red/demo.txt")),
                allowed(read(f"{root}/gauntlet/merge/demo.txt")),
                allowed(call("Grep", {"pattern": "x", "path": f"{root}/gauntlet/red"})),
                allowed(call("Grep", {"pattern": "x", "path": f"{root}/gauntlet/merge"})),
                denied(read(f"{root}/gauntlet/plans/approved/demo.txt")),
                denied(read(f"{root}/gauntlet/reviews/demo.plan.4.txt")),
                denied(read(f"{root}/gauntlet/plans/drafts/demo.txt")),
                denied(read(f"{root}/gauntlet/specs/drafts/demo.txt")),
                #: the bare directory is the one search that returns everything
                #: in it, and it is not `<dir>/` + something
                denied(call("Grep", {"pattern": "x", "path": f"{root}/gauntlet"})),
                denied(call("Grep", {"pattern": "x", "path": f"{root}/gauntlet/plans/approved"})),
                allowed(call("Grep", {"pattern": "x", "path": f"{root}/gauntlet/specs/approved"})),
                #: the leaf is the approved directory, not the stage above it:
                #: the drafts sit beside it under the same parent
                denied(call("Grep", {"pattern": "x", "path": f"{root}/gauntlet/specs"})),
                denied(call("Grep", {"pattern": "x", "path": f"{root}/gauntlet/specs/drafts"})),
                #: a path boundary, not a string prefix
                allowed(read(f"{root}/gauntlet/specs/approved/sub/x.txt")),
                denied(read(f"{root}/gauntlet/specs/approved-old/x.txt")),
                #: the rest of docs/ is untouched, and so is the same name nested
                #: under the source tree
                allowed(read(f"{root}/docs/testing.md")),
                allowed(read(f"{root}/docs/plans.md")),
                denied(read(f"{root}/src/gauntlet/specs/approved/demo.txt")),
                #: the git-object read a blind agent is told to make
                allowed(bash("git show HEAD:gauntlet/specs/approved/demo.txt")),
                denied(bash("git show HEAD:gauntlet/plans/approved/demo.txt")),
            )
        ),
        "10 no blind-reads.json value re-opens the base or overlaps another": all(
            (
                #: a usable set moves all three, which is the point of the file
                sh.dirs_from({"tests_dir": "spec", "gauntlet_dir": "work", "docs_dir": "prose"})
                == {"tests_dir": "spec", "gauntlet_dir": "work", "docs_dir": "prose"},
                #: and every unusable one moves nothing at all, together: a name
                #: at, under or over another would put one directory's hook over
                #: the other's, and a partly honoured set is the hole itself
                sh.dirs_from({"tests_dir": "gauntlet"}) == dict(sh.DEFAULT_DIRS),
                sh.dirs_from({"tests_dir": "gauntlet/plans/approved"}) == dict(sh.DEFAULT_DIRS),
                sh.dirs_from({"gauntlet_dir": "tests"}) == dict(sh.DEFAULT_DIRS),
                sh.dirs_from({"gauntlet_dir": "tests/artifacts"}) == dict(sh.DEFAULT_DIRS),
                #: a key the file omits still collides: `tests_dir` at `docs` is
                #: legal read alone and sits over the default `docs_dir`
                sh.dirs_from({"tests_dir": "docs"}) == dict(sh.DEFAULT_DIRS),
                sh.dirs_from({"docs_dir": "spec", "tests_dir": "spec"}) == dict(sh.DEFAULT_DIRS),
                #: judged by where a name lands, not by how it is spelled
                sh.dirs_from({"tests_dir": "spec/../gauntlet/reviews"}) == dict(sh.DEFAULT_DIRS),
                sh.dirs_from({"tests_dir": "."}) == dict(sh.DEFAULT_DIRS),
                sh.dirs_from({"gauntlet_dir": "/repo/work"}) == dict(sh.DEFAULT_DIRS),
                sh.dirs_from({"docs_dir": ["prose"]}) == dict(sh.DEFAULT_DIRS),
                #: there is no allow key: a path off the table stays off it
                denied(read(f"{root}/reference/protocol.md")),
            )
        ),
        "11 no denied subtree nests inside an allowed one": _no_denied_nesting(),
        "12 this repo's own blind-reads.json parses, if it is there": _config_parses(),
        #: a hook decides a tool call, so its own crash is a denial -- and a
        #: payload it cannot read is a call it cannot decide, which is a refusal
        "every payload shape is answered, and an unreadable one is refused": (
            sh.survives_hostile_payloads(__file__, guards=GUARDS)
        ),
    }
    return sh.report(lines)


if __name__ == "__main__":
    sh.entry(self_test, main)
