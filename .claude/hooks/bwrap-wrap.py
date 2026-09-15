#!/usr/bin/env python3
"""PreToolUse hook: every `Bash` command runs inside `bwrap`, unread.

This is the mechanism that stands in place of reading command text. Deciding a
`Bash` call by parsing the string -- does this command write, and where -- is
undecidable on a string: an env prefix, a here-document, a command
substitution, a shell function, a `find -exec`, an `xargs`. A list of spellings
leaves the next spelling open.

So nothing here parses. The command text is carried into the replacement byte
for byte and what changes is not the command but the filesystem it sees. A
write the sandbox refuses comes back as an ordinary errno rather than as a hook
denial with a paragraph of prose, which is a real loss of explanation and the
price of the mechanism. The `Write` and `Edit` paths keep their prose, and those
are the tools an agent should be using for a write.

The command is delivered on stdin through a here-document rather than as a
quoted argument. Quoting is the thing this hook exists not to do: a quoter has
to know the shape of what it is quoting, and `echo $(cat /etc/hostname) <<'X'`
survives `shlex.quote` only by being rewritten. A here-document carries any byte
sequence unaltered, so the caller's text appears in the replacement exactly as
typed, whatever it is.

Three profiles, chosen by `agent_type`, the same payload field the lane hooks
read. Only the kit's own agents -- an `agent_type` starting `gauntlet-` -- are
wrapped at all. The main agent's call carries no `agent_type` and comes back
untouched: `bwrap` sets NO_NEW_PRIVS, so `sudo` inside the wrap fails with
"The \"no new privileges\" flag is set", and every script that calls `sudo`
internally dies with it, which no command-text carve-out can reach.

  * **passthrough** for the two blind agents that keep a shell. `blind.sh` runs
    its own `bwrap`, and wrapping a wrapper gains nothing while costing a nested
    mount setup on the one command those agents have.
  * **reviewer** for the blind reviewers: the whole filesystem read-only, plus a
    tmpfs over the reviewers' own lane. A reviewer's shell cannot change the
    checkout it was spawned to judge.
  * **default** for every other `gauntlet-` agent. Everything readable.
    Writable: the repository, the session's own `/tmp`, and `~/.cache`.
    Read-only again inside the repository: every lane directory in every
    checkout, `<gauntlet dir>/red`, `<gauntlet dir>/merge`, `.claude/`, `scripts/`,
    `.git/hooks` and `.git/config`. `~/.gitconfig` is read-only. `/run/user` is masked with an
    empty tmpfs, which closes the D-Bus route to `systemd --user` -- a socket
    rather than a spelling, so no string classifier could ever have caught it.

`--unshare-pid` is taken, and what it buys is narrower than it looks. The route
out through an outer process's `/proc/<pid>/cwd` is closed either way, because
that process is outside the sandbox's user-namespace mapping; the flag removes
the entry rather than denying it, which is defense in depth against a future
kernel or mapping that would make the denial a permission rather than an
absence.

The worktree list is rebuilt on every call and never cached. `.claude/worktrees`
is itself read-only and each tree that exists is bound back writable, so a tree
cut since the last call is writable and a tree removed since the last call is
simply absent. A cached list would name a path that is gone, and `bwrap` fails
the whole invocation on a missing bind source -- every `Bash` call in the
session would error until the session restarted.

That failure mode is the hazard this hook has to answer, and `--ro-bind-try` is
not the answer: the `-try` suffix forgives a source that is *absent* and
nothing else. A source whose parent is a file, not a directory, comes back
`ENOTDIR` and kills the whole invocation -- which is exactly `.git/hooks` in a
git worktree, where `.git` is a pointer file rather than a directory. So every
bind source is resolved against the tree before it is emitted, by `_source`,
and a path that does not resolve is not named at all. `-try` stays on the
optional binds for the race between the check and the exec; it is a second
line, never the first.

Nothing about a checkout is assumed. A worktree's `.git/hooks` and `.git/config`
simply drop out of its profile, and the protection still holds, because a
worktree shares both with the main checkout whose copies are bound read-only.

`bwrap` being on `PATH` is not the same as `bwrap` working. A host with user
namespaces disabled, or a seccomp policy that refuses the setup, has the binary
and fails at exec -- and since every `Bash` call is rewritten into that
invocation, every `Bash` call in the session dies with `bwrap`'s own one-line
complaint and no statement of what refused it. So the binary is run once, on a
trivial profile, before anything is rewritten, and a host where it does not run
gets a named denial instead of a session of broken commands.

One shape escapes the wrap: `scripts/pair.sh`, which writes lane files by
design. `pair_passthrough.is_pair_command` holds that decision, in its own file,
because a wrapper that decided for itself which commands to skip would be a
classifier again.
"""

from __future__ import annotations

import functools
import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell_shapes as sh  # noqa: E402

pair_passthrough = importlib.import_module("pair-passthrough")

#: the two blind agents that keep a shell. `scripts/blind.sh` is their one
#: command and it runs its own `bwrap`, so this hook leaves them alone.
PASSTHROUGH_AGENTS = ("gauntlet-scrivener", "gauntlet-bailiff")

#: the kit's own agents all carry this prefix; any other caller, the main agent
#: included, is left unwrapped
AGENT_PREFIX = "gauntlet-"

#: the blind reviewers: read-only everywhere, with a tmpfs over their own lane
REVIEWER_AGENTS = ("gauntlet-arbiter", "gauntlet-juror")

#: read-only again inside every checkout, on top of a writable repository. The
#: lane directories come from the one place they are defined.
PROTECTED_IN_CHECKOUT = sh.LANE_DIRS + (
    sh.gauntlet_dir() + "/red",
    sh.gauntlet_dir() + "/merge",
    ".claude",
    "scripts",
    ".git/hooks",
    ".git/config",
)

#: the reviewers' own lane, which their profile answers with a tmpfs
REVIEWS_DIR = sh.reviews_lane()

WORKTREES = ".claude/worktrees"

_NO_BWRAP = (
    "This kit runs every Bash command inside `bwrap`, and `bwrap` is not on this host. "
    "Install `bubblewrap` (Fedora/RHEL: `sudo dnf install bubblewrap`; Debian/Ubuntu: "
    "`sudo apt install bubblewrap`). The hook fails closed rather than running the "
    "command unconfined. (hooks/bwrap-wrap.py)"
)


_BWRAP_BROKEN = (
    "This kit runs every Bash command inside `bwrap`. `bwrap` is installed on this host "
    "but will not run here, so every wrapped command would die at exec. `bwrap` said: "
    "{said}. Usual causes: unprivileged user namespaces off "
    "(`sysctl kernel.unprivileged_userns_clone`, `user.max_user_namespaces`), or a "
    "seccomp/LSM policy refusing the setup. The hook fails closed rather than running "
    "the command unconfined. (hooks/bwrap-wrap.py)"
)

#: the smallest profile that still does what every real profile does: make a
#: user namespace, bind a root, mount `/dev` and `/proc`, unshare the pid
#: namespace. A host that refuses any of those refuses every profile here.
_PROBE = (
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--unshare-pid",
    "--die-with-parent",
    "--", "true",
)


def _first_line(text: str) -> str:
    return (text or "").strip().split("\n")[0].strip()


@functools.lru_cache(maxsize=1)
def bwrap_fault() -> str | None:
    """Why `bwrap` cannot be used on this host right now, or None if it can.

    Installed is not the same as working: user namespaces can be off and a
    seccomp policy can refuse the setup, and both leave a binary on `PATH` that
    dies at exec. Nothing but running it answers that, so it is run -- once per
    process, on `true`, which costs one process for the first `Bash` call of a
    session and nothing for the rest.
    """
    if shutil.which("bwrap") is None:
        return _NO_BWRAP
    try:
        done = subprocess.run(
            ["bwrap", *_PROBE], capture_output=True, text=True, timeout=30
        )
    except (OSError, subprocess.SubprocessError) as error:
        return _BWRAP_BROKEN.format(said=_first_line(str(error)) or type(error).__name__)
    if done.returncode == 0:
        return None
    said = _first_line(done.stderr) or f"exit status {done.returncode}"
    return _BWRAP_BROKEN.format(said=said)


def _answer(payload: dict) -> dict | None:
    """The hook's answer for this payload, or None to say nothing at all."""
    if payload.get("tool_name") != "Bash":
        return None
    command = (payload.get("tool_input") or {}).get("command")
    if not isinstance(command, str):
        return None

    agent = payload.get("agent_type") or ""
    # only the kit's own agents are wrapped. The main agent's shell is left
    # alone: `bwrap` sets NO_NEW_PRIVS, so `sudo` inside the wrap dies with
    # "The \"no new privileges\" flag is set", and so does every script that
    # calls it internally -- a route no command-text carve-out can reach. An
    # absent `agent_type` is the main agent; a foreign one is not this kit's.
    if not agent.startswith(AGENT_PREFIX):
        return None
    if agent in PASSTHROUGH_AGENTS:
        return None
    if pair_passthrough.is_pair_command(command):
        return None

    fault = bwrap_fault()
    if fault is not None:
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": fault,
            }
        }

    root = sh.cwd_of(payload)
    wrapped = wrap(command, root, agent)
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "updatedInput": {"command": wrapped},
        }
    }


def worktrees(root: str) -> list[str]:
    """The worktrees that exist under `root` right now, absolute, sorted.

    Rebuilt per call on purpose. A cached list outlives the tree it names, and
    `bwrap` fails the whole invocation on a bind source that is not there.
    """
    parent = os.path.join(root, WORKTREES)
    try:
        names = sorted(os.listdir(parent))
    except OSError:
        return []
    trees = [os.path.join(parent, name) for name in names]
    return [tree for tree in trees if os.path.isdir(tree)]


def _base(root: str) -> list[str]:
    """The mounts every profile takes: readable world, live /dev, masked /run/user."""
    return [
        "bwrap",
        "--ro-bind", "/", "/",
        "--dev", "/dev",
        "--proc", "/proc",
        # the D-Bus route to `systemd --user`, which starts a unit outside
        # anything the calling process was confined by
        "--tmpfs", "/run/user",
        "--tmpfs", "/tmp",
        "--unshare-pid",
        "--die-with-parent",
        # a `--chdir` onto a directory that is not there fails the invocation,
        # and a caller's `cwd` can name a tree that has since been cut
    ] + (["--chdir", root] if _source(root) else [])


def _source(path: str) -> bool:
    """Whether `path` is a bind source `bwrap` will accept, right now.

    `os.path.exists` answers False for every reason a bind would fail on the
    source -- absent, a component that is a file (`ENOTDIR`), a dangling
    symlink, a directory that cannot be traversed -- which is the whole of what
    this needs to know. `--ro-bind-try` forgives only the first of those.
    """
    return os.path.exists(path)


def _bind(flag: str, path: str) -> list[str]:
    """One bind of `path` onto itself, or nothing if the source is not there."""
    return [flag, path, path] if _source(path) else []


def _checkout_readonly(checkout: str) -> list[str]:
    """Bind back read-only the directories no shell writes, in one checkout.

    A path that does not resolve is not named. In a worktree that drops
    `.git/hooks` and `.git/config`, which the worktree shares with the main
    checkout and which the main checkout's own profile has already bound.
    """
    args: list[str] = []
    for relative in PROTECTED_IN_CHECKOUT:
        args += _bind("--ro-bind-try", os.path.join(checkout, relative))
    return args


def wrap(command: str, root: str, agent: str) -> str:
    """The `bwrap` invocation that runs `command`, as one shell command string.

    The caller's text is carried on stdin through a here-document, so it appears
    in the result byte for byte however it is spelled.
    """
    args = _profile(root, agent)
    return " ".join(_quote(a) for a in args) + " " + _heredoc(command)


def _profile(root: str, agent: str) -> list[str]:
    """The full `bwrap` argument list for one agent in one checkout."""
    home = os.environ.get("HOME") or root
    args = _base(root)

    if agent in REVIEWER_AGENTS:
        # nothing writable but the reviewer's own lane, and that only as a
        # tmpfs: a reviewer's shell cannot change the checkout it judges
        # a tmpfs needs its mountpoint to exist: everything else is bound
        # read-only, so `bwrap` cannot create one. A checkout without the
        # reviews lane gives the reviewer a wholly read-only filesystem, which
        # errs in the safe direction.
        reviews = os.path.join(root, REVIEWS_DIR)
        if _source(reviews):
            args += ["--tmpfs", reviews]
    else:
        args += _bind("--bind", root)
        args += _bind("--bind-try", os.path.join(home, ".cache"))
        args += _bind("--ro-bind-try", os.path.join(home, ".gitconfig"))

        # the repository is writable, so the lanes inside it are bound back
        # read-only, in the main checkout and in every worktree
        args += _checkout_readonly(root)
        args += _bind("--ro-bind-try", os.path.join(root, WORKTREES))
        for tree in worktrees(root):
            # `--bind`, not `--bind-try`, would stake the whole invocation on a
            # tree surviving the microseconds between the listing above and the
            # exec. A tree cut in that window costs its own writability and
            # nothing else; under `--bind` it killed the command outright.
            args += _bind("--bind-try", tree)
            args += _checkout_readonly(tree)

    return args + ["--", "bash", "-s"]


def _quote(argument: str) -> str:
    """Quote one `bwrap` argument. Never the caller's command -- see `_heredoc`."""
    if argument and all(c.isalnum() or c in "-_/.:=" for c in argument):
        return argument
    return "'" + argument.replace("'", "'\\''") + "'"


def _heredoc(command: str) -> str:
    """`command` as a quoted here-document, so every byte of it survives.

    The delimiter is extended until it appears on no line of the command, so a
    command that happens to contain the delimiter cannot terminate it early.
    """
    delimiter = "GAUNTLET_COMMAND_EOF"
    lines = command.split("\n")
    while any(line.strip() == delimiter for line in lines):
        delimiter += "_"
    return f"<<'{delimiter}'\n{command}\n{delimiter}"


def main() -> None:
    #: a command is the only thing this hook wraps, so a `Bash` call is the only
    #: one it refuses for being unreadable. A wrap that cannot be built is a
    #: denial and not a shrug: the shrug runs the command outside the sandbox.
    sh.answer_main(_answer, guards=("Bash",))


def self_test() -> int:
    """Pin what the wrap carries, what it binds, and every way it can go wrong.

    Every profile is built against a real directory tree, not an invented path.
    The bug this pins was a path that resolved to something other than the
    profile assumed, and no assertion over a `/repo` that has never existed can
    see that class at all.
    """
    with tempfile.TemporaryDirectory() as tmp:
        return _self_test_in(tmp)


def _make_tree(root: str, worktree_git_is_a_file: bool) -> None:
    """A checkout shaped like this kit's: lanes, scripts, and a `.git`.

    `worktree_git_is_a_file` spells the difference between a main checkout and
    a git worktree. In a worktree `.git` is a pointer file, so `.git/hooks`
    resolves `ENOTDIR` rather than simply missing -- the shape that took every
    `Bash` call in a session down.
    """
    for relative in PROTECTED_IN_CHECKOUT + (WORKTREES,):
        if relative.startswith(".git/") and worktree_git_is_a_file:
            continue
        os.makedirs(os.path.join(root, relative), exist_ok=True)
    dot_git = os.path.join(root, ".git")
    if worktree_git_is_a_file:
        with open(dot_git, "w", encoding="utf-8") as handle:
            handle.write("gitdir: /elsewhere/.git/worktrees/tree\n")


def _runs(wrapped: str) -> tuple[bool, str]:
    """Whether the shell command a profile produced actually runs. Decisive.

    No inspection of an argument list can answer this: `bwrap` is the authority
    on which of its own sources it will accept, so the test asks it. The
    command inside the sandbox is `true`, so the cost is one process.
    """
    done = subprocess.run(
        ["bash", "-c", wrapped], capture_output=True, text=True, timeout=60
    )
    return done.returncode == 0, (done.stderr or "").strip().split("\n")[0]


def _answer_with_path(where: str, root: str) -> dict | None:
    """`_answer` for one Bash call, with `where` as the whole of `PATH`.

    The probe is cached for the life of the process, so the cache is cleared on
    both sides: a stale answer here would test the previous case twice.
    """
    was = os.environ.get("PATH", "")
    os.environ["PATH"] = where
    bwrap_fault.cache_clear()
    try:
        return _answer(
            {
                "tool_name": "Bash",
                "cwd": root,
                "agent_type": "gauntlet-prosecutor",
                "tool_input": {"command": "echo hi"},
            }
        )
    finally:
        os.environ["PATH"] = was
        bwrap_fault.cache_clear()


def _fake_bwrap(where: str, body: str) -> str:
    """A real executable named `bwrap` in `where`, running `body`. Returns `where`."""
    os.makedirs(where, exist_ok=True)
    path = os.path.join(where, "bwrap")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("#!/bin/sh\n" + body + "\n")
    os.chmod(path, 0o755)
    return where


def _reason(answer: dict | None) -> str:
    """The denial text of an answer, or "" if it is not a denial."""
    out = (answer or {}).get("hookSpecificOutput") or {}
    if out.get("permissionDecision") != "deny":
        return ""
    return out.get("permissionDecisionReason") or ""


def _self_test_in(tmp: str) -> int:
    root = os.path.join(tmp, "checkout")
    _make_tree(root, worktree_git_is_a_file=False)
    tree = os.path.join(root, WORKTREES, "demo-spec")
    _make_tree(tree, worktree_git_is_a_file=True)

    semicolon = "echo hi; cat /etc/hostname"
    heredoc = "echo $(cat /etc/hostname) <<'X'"

    default = wrap(semicolon, root, "gauntlet-prosecutor")
    reviewer = wrap(semicolon, root, "gauntlet-arbiter")
    awkward = wrap(heredoc, root, "gauntlet-prosecutor")

    #: not `shutil.which`: a binary that will not run is the case below
    have_bwrap = bwrap_fault() is None
    gone = os.path.join(tmp, "cut-since-the-call-began")

    #: an installed `bwrap` that dies at exec -- user namespaces off, a seccomp
    #: policy refusing the setup. A real executable, so the probe is a real run.
    broken = _fake_bwrap(
        os.path.join(tmp, "broken-bin"),
        'echo "bwrap: No permissions to creating new namespace" >&2\nexit 1',
    )
    empty = os.path.join(tmp, "empty-bin")
    os.makedirs(empty, exist_ok=True)

    lines = {
        "the caller's text survives the wrap byte for byte, whatever it is": (
            semicolon in default and heredoc in awkward
        ),
        "a command carrying the delimiter cannot close the here-document early": (
            "<<'GAUNTLET_COMMAND_EOF_'" in wrap("a\nGAUNTLET_COMMAND_EOF\nb", root, "")
        ),
        "the default profile makes the repository writable": (
            f"--bind {root} {root}" in default
        ),
        "the lane directories are bound back read-only under it": all(
            f"--ro-bind-try {root}/{lane} {root}/{lane}" in default for lane in sh.LANE_DIRS
        ),
        "the reviewer profile binds no writable repository": (
            f"--bind {root} {root}" not in reviewer
            and f"--tmpfs {root}/{REVIEWS_DIR}" in reviewer
        ),
        "/run/user is masked and the pid namespace is unshared": (
            "--tmpfs /run/user" in default and "--unshare-pid" in default
        ),
        "a blind agent with its own bwrap is left alone": all(
            _answer(
                {
                    "tool_name": "Bash",
                    "cwd": root,
                    "agent_type": agent,
                    "tool_input": {"command": "scripts/blind.sh status demo"},
                }
            )
            is None
            for agent in PASSTHROUGH_AGENTS
        ),
        "a whole pair.sh subcommand call escapes the wrap, and nothing else does": (
            _answer(
                {
                    "tool_name": "Bash",
                    "cwd": root,
                    "agent_type": "gauntlet-prosecutor",
                    "tool_input": {"command": "scripts/pair.sh red demo"},
                }
            )
            is None
            and _answer(
                {
                    "tool_name": "Bash",
                    "cwd": root,
                    "agent_type": "gauntlet-prosecutor",
                    "tool_input": {"command": "scripts/pair.sh red demo; rm -rf state"},
                }
            )
            is not None
        ),
        "the main agent's command, carrying no agent_type, comes back untouched": (
            _answer(
                {
                    "tool_name": "Bash",
                    "cwd": root,
                    "tool_input": {"command": "sudo -n true"},
                }
            )
            is None
        ),
        "a tool that is not Bash is not this hook's business": (
            _answer({"tool_name": "Write", "tool_input": {"command": "x"}}) is None
        ),
        "the worktree list is read from disk rather than carried": (
            worktrees("/nonexistent-by-construction") == []
            and worktrees(root) == [tree]
        ),
        #: the bug: `.git` is a pointer file in a worktree, so `.git/hooks`
        #: resolves ENOTDIR, and `--ro-bind-try` forgives absence only
        "a worktree's `.git` pointer file is never named as a bind source": (
            f"{tree}/.git/hooks" not in default and f"{tree}/.git/config" not in default
        ),
        #: the gap the probe closes: on `PATH` and unable to run is a host where
        #: every rewritten `Bash` call dies at exec with no statement of why
        "a bwrap that is installed but will not run is denied, by its own words": (
            "No permissions to creating new namespace"
            in _reason(_answer_with_path(broken, root))
        ),
        "a host with no bwrap at all is denied for that, and not for the other": (
            _reason(_answer_with_path(empty, root)) == _NO_BWRAP
        ),
        "the worktree binds survive the tree going away under them": (
            f"--bind-try {tree} {tree}" in default and f"--bind {tree} {tree}" not in default
        ),
        "a bind source cut between the profile and the exec is not named": (
            gone not in wrap("true", gone, "gauntlet-prosecutor")
            or not os.path.exists(gone)
            and f"--chdir {gone}" not in wrap("true", gone, "gauntlet-prosecutor")
        ),
        #: a hook decides a tool call, so its own crash is a denial -- and a
        #: payload it cannot read is a call it cannot decide, which is a refusal
        "every payload shape is answered, and an unreadable one is refused": (
            sh.survives_hostile_payloads(__file__, guards=("Bash",))
        ),
    }

    if have_bwrap:
        for label, profile in (
            ("the default profile runs, against this very tree", default),
            ("the reviewer profile runs, against this very tree", reviewer),
            (
                "the profile for the real checkout this gate runs in runs",
                wrap("true", os.path.dirname(os.path.dirname(os.path.dirname(
                    os.path.abspath(__file__)))), "gauntlet-prosecutor"),
            ),
        ):
            #: `true` inside the sandbox, so a failure is the mount setup and
            #: nothing else
            ran, first = _runs(profile.replace(_heredoc(semicolon), _heredoc("true")))
            lines[label] = ran
            if not ran:
                lines[label + f"  [bwrap said: {first}]"] = False

        #: the race the listing cannot close: the profile names a tree that is
        #: gone by the time `bwrap` reads it. Under `--bind` this killed the
        #: whole command; the test removes the tree for real and runs it.
        vanishing = wrap("true", root, "gauntlet-prosecutor")
        shutil.rmtree(tree)
        ran, first = _runs(vanishing)
        label = "a worktree cut after the profile was built does not kill the command"
        lines[label] = ran
        if not ran:
            lines[label + f"  [bwrap said: {first}]"] = False
        _make_tree(tree, worktree_git_is_a_file=True)
    else:
        lines["bwrap is absent, so the profiles could not be run"] = True

    return sh.report(lines)


if __name__ == "__main__":
    sh.entry(self_test, main)
