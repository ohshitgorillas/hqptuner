---
description: Author tests for new or changed behaviour through the blind test-writer, then have them reviewed. Argument: what changed (module, behaviour, or "the working tree").
---

Cover this with tests: $ARGUMENTS

You are the orchestrator. You do not write these tests, because you have read (or written) the implementation, and a test written from the code mirrors the code — it passes on an implementation that is wrong in exactly the way you were wrong. Run the chain below end to end without stopping to re-ask between steps.

The chain runs tests-first: spec at the plan gate, writer before implementation, red run as the bite proof. Section 6 is invoked from sections 3 and 5 rather than walked through in order.

## 1. Build the spec block

For a change that adds or alters observable behaviour, the spec block is authored **during planning** and presented inside the plan for approval — the grounding gate already forces the reading it requires, so the spec costs nothing extra at that point and the writer can be spawned the moment approval lands. When `/tests` is invoked over code that already exists — characterization tests, retrofitting an untested module — build the spec here instead.

Read whatever you need of the implementation — that is your job, not the writer's — and distil it into a **spec block**. Four parts:

**Behaviours.** What the code must do, in plain words, as a numbered list. One entry per observable outcome, including the failure modes and boundaries, not just the happy path. Phrase each as what a caller sees: *"asking for a preset that was never saved raises `PresetError` naming the missing preset"*, never *"the read path checks `exists()` first"*.

**Public entry points.** Signatures and docstrings only. Extract them — `grep -n "^def \|^class \|    def " <module>` plus the `__init__` exports, or read the module and copy out the `def` lines — and paste the signatures. Never paste a function body. Where the surface does not exist yet, the signatures are the **planned** public surface: what the plan commits to shipping, in the form it will ship.

**Wire and protocol facts.** The daemon behaviour that bears on this, each with a reference into `docs/protocol.md`, `docs/architecture.md`, `hqplayerd-readme.txt` or the HQPlayer manual so the writer can check it. Include the documented quirks the behaviour has to survive.

**Applicable fixtures.** Which of `tests/conftest.py`'s fixtures and `tests/fake_*.py`'s fakes cover this, by name, with one line each on what they give.

**The spec block contains zero implementation detail.** No function bodies, no private names, no control flow, no "it loops until", no algorithm. If a behaviour cannot be stated without describing how it is implemented, that is a spec smell — it usually means the behaviour has no observable contract, or the contract is the implementation. **Stop and put that to the user** rather than leaking it into the spec; a test written against implementation shape is the thing this whole chain exists to prevent.

## 2. Spawn the test-writer — before implementing

On approval, spawn the writer first, ahead of any implementation work. Hand the spec block to the `test-writer` subagent; give it the spec and the target test file, nothing else.

Blindness holds by construction here: the implementation does not exist yet, so there is no diff to leak and no module to read even by accident. The writer's no-implementation-reads hook still applies.

## 3. Red run — prove the tests bite

Run the new test file against the still-unchanged tree:

```
.venv/bin/pytest tests/<file> -q
```

Expected result is **red**. That is the bite proof (`docs/testing.md` rule 8), and it is stronger than reverting an implementation after the fact, because nothing has been written for the tests to have been shaped around.

Read the result:

- **Red — bite confirmed.** Assertion failures are the strong form. A collection or import error is a weak bite: it proves the tests reach the new surface, not that the assertions constrain it. Report which you got.
- **Green — bite failure.** The test passes against a tree that lacks the change, so it constrains nothing. Do not hand-edit it into failing: name the vacuous test, work out which spec behaviour failed to pin the outcome, tighten that line, and re-run the writer **as a delta** — the corrected behaviour lines and the affected tests only, not a rewrite of the whole file.

Skip the check only when there is no pre-change state to fail against — characterization tests of existing behaviour, tests accompanying a pure refactor, both expected green here — and say so in the report instead of skipping silently.

## 4. Implement

Write the change. If implementing surfaces a spec that was wrong, do not quietly diverge from it — that is adjudication, section 6.

## 5. Green run, then fan out

Run the new tests plus the offline suite:

```
.venv/bin/pytest tests/<file> -q && make check
```

**Green** — in a single message, both of:

- spawn the `test-reviewer` (spec block + test files, brief unchanged), and
- run `/task-check`.

They are independent; there is no reason to serialise them.

**Red** — adjudicate first, per section 6. Spawn the reviewer only once the tests are final: a reviewer running against tests that adjudication is about to change is a wasted spawn, and green is the common case.

## 6. Adjudicate every failure yourself — before touching anything

A failing test here means the spec and the code disagree. Exactly one of three things is true, and **you** decide which, in words, before a single edit:

- **The code is wrong.** The test caught a real defect. Say what the defect is; fixing it is a separate change with its own approval.
- **The spec was ambiguous or wrong.** You mis-stated the behaviour. Say which line of the spec was wrong and what it should have said, then re-run the writer with the corrected spec as a delta — the corrected behaviour lines and affected tests only — do not hand-edit the test into agreement.
- **The test misreads a correct spec.** Rare, and the burden is on you: state why the test, and not the code, is wrong, and what the test asserts that the spec does not say.

Report which one to the user before changing code or tests. Editing a test until it passes is forbidden without that statement. It is the failure mode this chain exists to catch, and it is silent: the suite goes green either way.

**Spec discoveries made mid-implementation take this same path.** Report which spec line was wrong, correct it, re-run the writer as a delta, and red-check that delta against the pre-change state of the behaviour it covers where one exists.

## 7. Surface the findings

Paste the reviewer's findings block to the user verbatim, with your own verdict per `BLOCKER` and `MAJOR` line — agree, or say why not. Do not act on them without a go. An empty findings block is a real result; report it as one rather than dressing it up.
