---
description: Author tests for new or changed behavior through the blind test-writer, then have them reviewed. Argument: what changed (module, behavior, or "the working tree").
---

Cover this with tests: $ARGUMENTS

You are the orchestrator. You do not write these tests, because you have read (or written) the implementation, and a test written from the code mirrors the code — it passes on an implementation that is wrong in exactly the way you were wrong. Run the chain below end to end without stopping to re-ask between steps.

The chain runs tests-first and concurrently: spec at the plan gate, then the writer and the implementation run at the same time in two worktrees, and the red run happens in the writer's tree while implementation is still in flight. Section 6 is invoked from sections 3 and 5 rather than walked through in order.

Waiting on the writer before starting to implement is the thing this chain no longer does. The writer is the slow step and it constrains nothing you need in order to start, because you wrote the spec.

The pair costs two metered actions end to end (`open` and `merge`), so there is no size threshold worth arguing about: anything carrying a spec block uses it. Implement in the main checkout only for a change too small to have one.

## 1. Build the spec block

For a change that adds or alters observable behavior, the spec block is authored **during planning** and presented inside the plan for approval — the grounding gate already forces the reading it requires, so the spec costs nothing extra at that point and the writer can be spawned the moment approval lands. When `/tests` is invoked over code that already exists — characterization tests, retrofitting an untested module — build the spec here instead.

Read whatever you need of the implementation — that is your job, not the writer's — and distil it into a **spec block**. Four parts:

**Behaviors.** What the code must do, in plain words, as a numbered list. One entry per observable outcome, including the failure modes and boundaries, not just the happy path. Phrase each as what a caller sees: *"asking for a preset that was never saved raises `PresetError` naming the missing preset"*, never *"the read path checks `exists()` first"*.

**Public entry points.** Signatures and docstrings only. Extract them — `grep -n "^def \|^class \|    def " <module>` plus the `__init__` exports, or read the module and copy out the `def` lines — and paste the signatures. Never paste a function body. Where the surface does not exist yet, the signatures are the **planned** public surface: what the plan commits to shipping, in the form it will ship.

**Wire and protocol facts.** The daemon behavior that bears on this, each with a reference into `docs/protocol.md`, `docs/architecture.md`, `hqplayerd-readme.txt` or the HQPlayer manual so the writer can check it. Include the documented quirks the behavior has to survive.

**Applicable fixtures.** Which of `tests/conftest.py`'s fixtures and `tests/fake_*.py`'s fakes cover this, by name, with one line each on what they give.

**The spec block contains zero implementation detail.** No function bodies, no private names, no control flow, no "it loops until", no algorithm. If a behavior cannot be stated without describing how it is implemented, that is a spec smell — it usually means the behavior has no observable contract, or the contract is the implementation. **Stop and put that to the user** rather than leaking it into the spec; a test written against implementation shape is the thing this whole chain exists to prevent.

## 2. Open the pair, then start both sides at once

On approval, open the two worktrees this run needs — one action:

```
scripts/pair.sh open <slug>
```

`<slug>` is a short topic slug plus a few characters of the session id, because other agents are working in this repo at the same time and must not land in your trees. You get:

- `.claude/worktrees/<slug>-spec` on branch `spec/<slug>` — the writer's tree. Tests only; no implementation reaches it until section 5.
- `.claude/worktrees/<slug>-impl` on branch `impl/<slug>` — yours. Implementation, docs, `CHANGELOG.md`; never `tests/`.

Both are cut from dev's committed tip. The main checkout is the user's and is never an agent workspace.

Then, **in a single message**, do both:

- spawn the `test-writer` with the spec block and the **absolute path** of its target file inside the spec tree — `.claude/worktrees/<slug>-spec/tests/<file>`. Give it the spec and that path, nothing else.
- enter the impl tree and start implementing (section 4).

From here the writer and the implementation run concurrently. Blindness holds by construction: the implementation does not exist yet, and when it does it is in a different tree the writer never opens. The writer's no-implementation-reads hook still applies.

**The lanes are enforced, not trusted.** `pair.sh merge` refuses if the spec tree wrote outside `tests/` or the impl tree wrote inside it. That rule is what makes the two branches combine without conflict, so treat a lane failure as a misplaced file, never as something to argue with.

## 3. Red run — prove the tests bite

When the writer returns, run its file in the spec tree. That tree has no implementation in it and will not until section 5, so this costs no waiting — the implementation is still in flight in the other tree.

```
cd .claude/worktrees/<slug>-spec && PYTHONPATH=$(pwd) .venv/bin/pytest tests/<file> -q
```

The `PYTHONPATH` is not optional. A worktree borrows the main checkout's `.venv`, which has `hqptuner` installed editable against the main checkout — without it you are testing the wrong tree's code.

Expected result is **red**. That is the bite proof (`docs/testing.md` rule 8), and it is the strongest form available: nothing has been written anywhere in this tree for the tests to have been shaped around, and no revert is involved.

Read the result:

- **Red — bite confirmed.** Assertion failures are the strong form. A collection or import error is a weak bite: it proves the tests reach the new surface, not that the assertions constrain it. Report which you got.
- **Green — bite failure.** The test passes against a tree that lacks the change, so it constrains nothing. Do not hand-edit it into failing: name the vacuous test, work out which spec behavior failed to pin the outcome, tighten that line, and re-run the writer **as a delta** — the corrected behavior lines and the affected tests only, not a rewrite of the whole file. Implementation keeps running in its own tree while you do; the retry is concurrent too.

Skip the check only when there is no pre-change state to fail against — characterization tests of existing behavior, tests accompanying a pure refactor, both expected green here — and say so in the report instead of skipping silently.

## 4. Implement — in the impl tree

Write the change in `.claude/worktrees/<slug>-impl`, starting as soon as the pair is open. You implement it; that is settled, because you wrote the spec and you are the one who will adjudicate a failing test, which is impossible against code you have not read.

**Rote work goes to a builder, not into your own context.** A rename across N files, one edit applied down a list of call sites, boilerplate that follows a pattern already in the tree — if you can state the change as a rule and check the result by reading a diff, hand it out. See the Delegation section of `CLAUDE.md`; it is a rule there, not a suggestion. The line is decisions, not size.

You do not touch `tests/` here. If implementing shows a test needs to change, that is adjudication (section 6), and it happens after the merge, in the combined tree.

If implementing surfaces a spec that was wrong, do not quietly diverge from it — also section 6.

## 5. Converge, then fan out

One action brings the two trees together, gates the result, and lands it:

```
scripts/pair.sh merge <slug>
```

It lane-checks both trees, commits them, rebases onto dev if dev moved underneath, merges `impl/<slug>` into the spec tree so that tree holds tests plus implementation, runs `make check` there, and only then fast-forwards dev and removes both worktrees. A red gate stops it with dev untouched and both trees left standing — the combined tree is where you adjudicate.

**Green** — in a single message, both of:

- spawn the `test-reviewer` (spec block + test files, brief unchanged), and
- run `/task-check`, from the main checkout.

They are independent; there is no reason to serialize them.

`/task-check` binds the one container and `:8090`, host-wide, which the worktrees do not isolate. It stays post-merge and stays in the main checkout.

Abandoning the work instead: `scripts/pair.sh abort <slug>` removes both trees and branches. `scripts/pair.sh list` shows the open pairs and is free.

**Red** — adjudicate first, per section 6. Spawn the reviewer only once the tests are final: a reviewer running against tests that adjudication is about to change is a wasted spawn, and green is the common case.

## 6. Adjudicate every failure yourself — before touching anything

A failing test here means the spec and the code disagree. Exactly one of three things is true, and **you** decide which, in words, before a single edit:

- **The code is wrong.** The test caught a real defect. Say what the defect is; fixing it is a separate change with its own approval.
- **The spec was ambiguous or wrong.** You mis-stated the behavior. Say which line of the spec was wrong and what it should have said, then re-run the writer with the corrected spec as a delta — the corrected behavior lines and affected tests only — do not hand-edit the test into agreement.
- **The test misreads a correct spec.** Rare, and the burden is on you: state why the test, and not the code, is wrong, and what the test asserts that the spec does not say.

Report which one to the user before changing code or tests. Editing a test until it passes is forbidden without that statement. It is the failure mode this chain exists to catch, and it is silent: the suite goes green either way.

**Spec discoveries made mid-implementation take this same path.** Report which spec line was wrong, correct it, re-run the writer as a delta, and red-check that delta against the pre-change state of the behavior it covers where one exists.

## 7. Surface the findings

Paste the reviewer's findings block to the user verbatim, with your own verdict per `BLOCKER` and `MAJOR` line — agree, or say why not. Do not act on them without a go. An empty findings block is a real result; report it as one rather than dressing it up.
