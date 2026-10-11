# Contributing to HQPTuner

## Bug reports

To report a bug, please reach out with the following information:

* HQPTuner version (System → About) and hqplayerd version (top bar, next to the daemon name)
* What you changed, what you expected, what happened
* Browser and OS, for anything visual
* Relevant lines from HQPTuner's log (System tab) — the failure detail that doesn't fit on screen goes there

## Setup

Clone with `git clone --recurse-submodules`. In an existing clone, run `git submodule update --init`.

Run:

```sh
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
npm install
.venv/bin/pre-commit install
```

CI runs Python 3.14. `requires-python` still admits 3.12+, but 3.14 is what is actually exercised.

## Before you open a PR

`make check` must be green. It is the same set the pre-commit hooks run, plus the JS test suite. See the Development section of `README.md` for what each target covers.

I am extremely strict about what tests make it into the codebase, so please review `docs/spec/testing.md` for the binding testing policy.

Every user-visible change lands with a `CHANGELOG.md` entry under `[Unreleased]`, in the same commit as the change. Write it for the person hitting the bug, not for the person who fixed it: what went wrong from their side, what it does now.

The shape is one line, a bold lead first:

```
- **What it does now.** What went wrong before, and anything the reader has to know to recognize it.
```

Write it before the change, not after. The entry is part of the plan and is approved there, alongside every other piece of user-facing text; the approved line is what lands, unreworded. An entry drafted at the end, by someone an hour deep in the fix, is the one that reaches for enum ids and file paths, because that is what is in front of them — and the fix is to write the line while the change is still only a description of what it will do.

`scripts/gates/check_changelog.py` enforces the mechanical half of that on `[Unreleased]` — released sections are history and are never rewritten. It refuses an entry over 75 words, an entry running to a second paragraph, an entry not opening with a bold lead, second person (`you`, `your`), marketing register (`simply`, `seamless`, `finally`, `quietly`, `significantly`, `under the hood`, …), narration by negation (`is unchanged`, `unaffected`, `untouched`, `nothing else changes`, …), and a duplicate or out-of-order `###` heading. It runs in `make check`, in pre-commit, and on every write to the file.

Two refusals come from the judge rather than the pattern gate. `triviajudge-changelog` reads the bullets a commit adds and refuses one that repeats or supersedes an entry already in the section, at every commit touching `CHANGELOG.md`. The same judge reads the whole `[Unreleased]` section at the release bump, where it refuses duplicates, superseded entries and entries filed under the wrong kind, and the bump stops before anything is written.

Narration by negation is worth its own note, because it is the one an author reaches for while trying to be helpful. "What the settings do is unchanged", "the selection is unaffected either way", "everything else works as before" — a changelog says what changed, and a reader already assumes anything it does not mention stayed put, so the clause carries nothing. Where it is load-bearing it is really a scope boundary, and a scope boundary reads positively: "only chainless profiles are filled in", not "profiles that already carry a chain are untouched".

What it cannot check is tone, and that is where entries actually go wrong. Three rules the gate will never catch:

- **No implementation archaeology.** Enum ids, file paths, the order the daemon does things in, the two things you had to discover to fix it — none of that helps someone reading a release note. It is in the commit and in `docs/`.
- **State the change; do not sell it.** "its settings moved to where they belong" is a verdict on your own work. "its settings moved" is the change.
- **One entry per change, not one per commit.** Three commits fixing one bug are one entry.

## Splits

No gate can see the thing that actually matters in a split, which is whether any caller changed. A split that moved a method and left a one-line forwarder in its place has changed nothing for anyone, and the only reliable tell is the caller-side count. State it before you start: how many call sites move, and in which files. A split that claims to move three of a class's jobs and touches five call sites is not a split.

`dev` is where work lands. `beta` publishes `ghcr.io/ohshitgorillas/hqptuner:beta` for testers, `main` publishes `:latest`. Open PRs against `dev`.

