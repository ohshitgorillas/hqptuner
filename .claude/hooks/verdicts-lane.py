#!/usr/bin/env python3
"""PreToolUse hook: `<gauntlet dir>/verdicts/` is the gauntlet-juror's lane.
`Stop` hook, behind `--stop`: a red run with no verdict does not end a turn.

Wire both session-wide from `.claude/settings.json`, so they bind the main
agent and every subagent, and wire the lane again from the `hooks:` frontmatter
of `.claude/agents/gauntlet-juror.md`.

The red run is a gate, so it carries an artifact. A verdict that lives in a
transcript alone cannot be checked after the session and does not say which
hand issued it. The main agent has read the implementation: it is the one hand
that must not rule on whether a test bit, and without this lane it is free to
write the verdict, to paraphrase one, or to skip the round and report a pass.
So the verdict is a tracked file, written by exactly one hand, and a turn that
produced a red run and no verdict does not land.

Denied:

  * `Write`/`Edit`/`NotebookEdit` whose target is under a
    `<gauntlet dir>/verdicts/` directory, unless the caller's `agent_type` is
    `gauntlet-juror`
  * a `Bash` command that names a `<gauntlet dir>/verdicts/` path and is not
    read-only, except a restore from a named git object
    (`git restore --source <rev>` or `git checkout <rev> --` onto the path),
    which copies a commit and types nothing

Allowed: every read of `<gauntlet dir>/verdicts/`, by any agent and by the
shell; every write anywhere else, the other lanes included.

`agent_type` is present in the payload only for subagent calls; an absent key
is the main agent, which is denied. If a build omits the key for subagents too,
the gauntlet-juror is over-denied, which is the safe direction: no unruled
verdict reaches the tree, and the denial names this file.

The `--stop` half reads `<gauntlet dir>/red/`, where `scripts/pair.sh red` saves the run
output. Every red file there wants a verdict file of the same slug, newer than
it: `pair.sh` writes the run with `>`, so a second run overwrites the evidence
in place, and a verdict older than the file it answers ruled on output no
longer on disk. The comparison is the hook's rather than the juror's, which
holds no `Bash` and could neither stat nor hash the run it ruled on, and which
writes one verdict per line and nothing else into its file.

A zero-byte red file is not a run to rule on — `pair.sh` redirects before the
suite runs and appends `|| true`, so a crashed or killed run leaves one — and
it fails with its own message rather than demanding a verdict on nothing.

The root is resolved from this file's own path, the way
`scripts/gates/check_md_trivia.py` does it, and neither from the cwd, which
moves within a turn, nor from `CLAUDE_PROJECT_DIR`, which is the main checkout
for one session and a worktree for another. Each checkout gates its own
`<gauntlet dir>/red/`. A missing red directory is not an unruled run: a consumer project
that copies `.claude/` and never runs `pair.sh` is never blocked.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell_shapes as sh  # noqa: E402

REVIEWER = "gauntlet-juror"
LANE = sh.verdicts_lane()

ROOT = Path(__file__).resolve().parent.parent.parent
RED_DIR = sh.gauntlet_dir() + "/red"

_LANE = (
    f"{LANE}/ is the gauntlet-juror's lane. The verdict on a red run "
    "is written there by the juror that issued it, and by nothing else: it is the "
    "only evidence anyone has that the run was certified and that a blind hand "
    "certified it. Spawn a gauntlet-juror with the committed spec path and the path "
    "`scripts/pair.sh red` printed. (hooks/verdicts-lane.py)"
)
_BASH = sh.lane_denial(LANE, "a verdict", _LANE)

#: the lane's whole policy: the one writer passes, every other hand is
#: refused with the reason, and a shell write into it is refused with _BASH
_verdict = sh.sole_writer_lane(LANE, REVIEWER, _LANE, _BASH)


def main() -> None:
    sh.hook_main(_verdict)


#: one line per unruled or unrulable red run, keyed by what is wrong with it
_EMPTY = "{slug}: " + RED_DIR + "/{slug}.txt is empty. The run printed nothing, so there is "
_EMPTY += "nothing to rule on. Re-run `scripts/pair.sh red {slug}`, or delete the file."
_MISSING = "{slug}: no verdict. " + RED_DIR + "/{slug}.txt is a red run nobody ruled on. Spawn "
_MISSING += "a gauntlet-juror with " + sh.specs_lane() + "/{slug}.txt and "
_MISSING += RED_DIR + "/{slug}.txt, or delete the red file if the slug was abandoned."
_UNREADABLE = "{slug}: " + RED_DIR + "/{slug}.txt could not be read ({error}). A red run this "
_UNREADABLE += "gate cannot open is one nobody can be shown a verdict for, so it is a complaint "
_UNREADABLE += "and not a file to step over. Fix its permissions, or delete it."
_STALE = "{slug}: stale verdict. " + LANE + "/{slug}.txt is older than "
_STALE += RED_DIR + "/{slug}.txt, so the run it ruled on has been overwritten since. Spawn "
_STALE += "a fresh gauntlet-juror on the run now on disk."


def _complaints(root: Path) -> list[str]:
    """One line per red run this root cannot show a live verdict for."""
    red_dir = root / RED_DIR
    if not red_dir.is_dir():
        return []  # no red run here; a consumer project that never runs pair.sh
    out = []
    for red in sorted(red_dir.glob("*.txt")):
        slug = red.stem
        try:
            red_stat = red.stat()
        except OSError as exc:
            #: a red run that cannot be statted is not a red run that is fine.
            #: Stepping over it drops it out of the gate entirely, which is the
            #: one outcome an unruled run must never have.
            out.append(_UNREADABLE.format(slug=slug, error=exc.strerror or exc))
            continue
        if red_stat.st_size == 0:
            out.append(_EMPTY.format(slug=slug))
            continue
        verdict = root / LANE / f"{slug}.txt"
        try:
            verdict_stat = verdict.stat()
        except OSError:
            out.append(_MISSING.format(slug=slug))
            continue
        if verdict_stat.st_mtime_ns < red_stat.st_mtime_ns:
            out.append(_STALE.format(slug=slug))
    return out


def stop(root: Path = ROOT) -> int:
    complaints = _complaints(root)
    if not complaints:
        return 0
    for line in complaints:
        print(line, file=sys.stderr)
    return 2


def self_test() -> int:
    """Pin the lane's four spec lines and the `--stop` gate's four states."""
    import contextlib
    import io
    import tempfile
    import time

    root = "/repo"

    write, bash = sh.probes(_verdict, root)
    denied, allowed = sh.denied, sh.allowed

    def tree(tmp: str, *, red: str | None, verdict: str | None, order: str = "red-first") -> Path:
        """A checkout with one red run and at most one verdict, mtimes ordered."""
        base = Path(tmp)
        (base / RED_DIR).mkdir(parents=True, exist_ok=True)
        (base / LANE).mkdir(parents=True, exist_ok=True)
        writes = [(base / RED_DIR / "demo.txt", red), (base / LANE / "demo.txt", verdict)]
        if order != "red-first":
            writes.reverse()
        for index, (path, body) in enumerate(writes):
            if index:
                time.sleep(0.01)
            if body is not None:
                path.write_text(body)
        return base

    def gate(**kw) -> int:
        #: the exit code is the subject; the block's own message is line 6's
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stderr(io.StringIO()):
            return stop(tree(tmp, **kw))

    def slugs(**files) -> list[str]:
        """The slugs `--stop` names, for a tree of `slug=(red, verdict)` pairs."""
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / RED_DIR).mkdir(parents=True)
            (base / LANE).mkdir(parents=True)
            for slug, (red, verdict) in files.items():
                (base / RED_DIR / f"{slug}.txt").write_text(red)
                time.sleep(0.01)
                if verdict is not None:
                    (base / LANE / f"{slug}.txt").write_text(verdict)
            return [line.split(":", 1)[0] for line in _complaints(base)]

    lines = {
        "1 gauntlet/verdicts/ closed to every agent but the gauntlet-juror": all(
            (
                denied(write(f"{root}/gauntlet/verdicts/demo.txt")),
                denied(write("gauntlet/verdicts/demo.txt")),
                denied(write(f"{root}/gauntlet/verdicts/demo.txt", "gauntlet-arbiter")),
                denied(write(f"{root}/gauntlet/verdicts/demo.txt", "gauntlet-prosecutor")),
                denied(write(f"{root}/gauntlet/verdicts/demo.txt", "gauntlet-scrivener")),
                #: an unprefixed same-named agent in the host project is not this one
                denied(write(f"{root}/gauntlet/verdicts/demo.txt", "juror")),
                allowed(write(f"{root}/gauntlet/verdicts/demo.txt", REVIEWER)),
                #: the lane denies its own directory, and no other lane's
                denied(write("/nogit/gauntlet/verdicts")),
                allowed(write(f"{root}/gauntlet/reviews/demo.1.txt", "gauntlet-arbiter")),
                allowed(write(f"{root}/gauntlet/specs/approved/demo.txt", "gauntlet-arbiter")),
                allowed(write(f"{root}/state/verdicts/demo.txt")),
                allowed(write(f"{root}/docs/testing.md")),
            )
        ),
        "2 shell writes naming the lane denied, reads and object restores pass": all(
            (
                denied(bash("cat impl.py 1> gauntlet/verdicts/demo.txt")),
                denied(bash("echo RED > gauntlet/verdicts/demo.txt")),
                denied(bash("sed -i 's/RED/GREEN/' gauntlet/verdicts/demo.txt")),
                denied(bash("rm gauntlet/verdicts/demo.txt")),
                denied(bash("cat > gauntlet/verdicts/demo.txt <<'EOF'\nRED 1\nEOF")),
                allowed(bash("cat gauntlet/verdicts/demo.txt")),
                allowed(bash("grep -c RED gauntlet/verdicts/demo.txt")),
                allowed(bash("git restore --source abc1234 -- gauntlet/verdicts/demo.txt")),
            )
        ),
        "3 a red run with no verdict blocks the turn, a ruled one does not": all(
            (
                gate(red="1 failed", verdict=None) == 2,
                gate(red="1 failed", verdict="RED 1: assert x") == 0,
            )
        ),
        "4 a verdict older than the run it answers blocks the turn": all(
            (
                gate(red="1 failed", verdict="RED 1", order="verdict-first") == 2,
                gate(red="1 failed", verdict="RED 1", order="red-first") == 0,
            )
        ),
        "5 an empty red run blocks the turn, verdict or no verdict": all(
            (
                gate(red="", verdict="RED 1") == 2,
                gate(red="x", verdict="RED 1") == 0,
            )
        ),
        "6 every unruled slug is named, not the first": all(
            (
                slugs(alpha=("1 failed", None), bravo=("1 failed", "RED 1")) == ["alpha"],
                slugs(alpha=("1 failed", None), bravo=("1 failed", None)) == ["alpha", "bravo"],
            )
        ),
        "7 no red directory is not an unruled run": all(
            (
                stop(Path(tempfile.gettempdir()) / "gauntlet-no-such-checkout") == 0,
                _complaints(ROOT) is not None,
            )
        ),
        "8 read-only git naming the lane passes, its write forms do not": all(
            (
                allowed(bash("git grep -n foo -- gauntlet/verdicts/")),
                allowed(bash("git grep -n 'gauntlet/verdicts/' -- .claude/hooks")),
                allowed(bash("git ls-tree HEAD gauntlet/verdicts/")),
                denied(bash("git grep -Ovim foo -- gauntlet/verdicts/")),
                denied(bash("git diff --output=gauntlet/verdicts/x.txt")),
            )
        ),
        "9 the blind runner naming this lane is still denied": all(
            (
                #: the runner takes one path under the test directory, so it
                #: reaches no other lane however the argument is spelled
                denied(bash("scripts/blind.sh test gauntlet/verdicts/slug.txt")),
                denied(bash("scripts/blind.sh test tests/a/../../gauntlet/verdicts/slug.txt")),
            )
        ),
        "10 the lane is what a write targets, not what its text mentions": all(
            (
                allowed(
                    bash(
                        "cat > state/notes.txt <<EOF\n"
                        "the juror wrote gauntlet/verdicts/demo.txt\nEOF"
                    )
                ),
                allowed(bash("echo 'gauntlet/verdicts/demo.txt' >> notes.txt")),
                allowed(bash("find gauntlet/verdicts -name '*.txt'")),
                allowed(bash("grep -n 'a > b' gauntlet/verdicts/")),
                denied(bash("cat gauntlet/red/demo.txt > gauntlet/verdicts/demo.txt")),
                denied(bash("find gauntlet/verdicts -name '*.txt' -delete")),
            )
        ),
        #: a hook decides a tool call, so its own crash is a denial -- and a
        #: payload it cannot read is a call it cannot decide, which is a refusal.
        #: The `--stop` entry point decides no call, so it withholds no
        #: permission and has nothing to refuse; what it owes is the older half
        #: alone, because a non-zero exit there holds the turn open and a crash
        #: in it is a loop with no way out.
        "every payload shape is answered, and an unreadable one is refused": (
            sh.survives_hostile_payloads(__file__)
            and sh.survives_hostile_payloads(__file__, "--stop", refuses_undecidable=False)
        ),
    }
    return sh.report(lines)


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    # The `--stop` guard sits here rather than inside `stop()`, because
    # `self_test()` calls `stop()` directly for four of its lines and a guard
    # inside it would pass those four vacuously under `GAUNTLET=off`. The
    # `--self-test` branch above is reached first and is never gated at all.
    if "--stop" in sys.argv:
        sys.exit(0 if sh.bypassed() else stop())
    main()
