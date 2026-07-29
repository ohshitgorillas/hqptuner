---
description: Author tests for new or changed behaviour through the blind test-writer, then have them reviewed. Argument: what changed (module, behaviour, or "the working tree").
---

Cover this with tests: $ARGUMENTS

You are the orchestrator. You do not write these tests, because you have read (or written) the implementation, and a test written from the code mirrors the code — it passes on an implementation that is wrong in exactly the way you were wrong. Run the chain below end to end without stopping to re-ask between steps.

## 1. Build the spec block

Read whatever you need of the implementation — that is your job, not the writer's — and distil it into a **spec block**. Four parts:

**Behaviours.** What the code must do, in plain words, as a numbered list. One entry per observable outcome, including the failure modes and boundaries, not just the happy path. Phrase each as what a caller sees: *"asking for a preset that was never saved raises `PresetError` naming the missing preset"*, never *"the read path checks `exists()` first"*.

**Public entry points.** Signatures and docstrings only. Extract them — `grep -n "^def \|^class \|    def " <module>` plus the `__init__` exports, or read the module and copy out the `def` lines — and paste the signatures. Never paste a function body.

**Wire and protocol facts.** The daemon behaviour that bears on this, each with a reference into `docs/protocol.md`, `docs/architecture.md`, `hqplayerd-readme.txt` or the HQPlayer manual so the writer can check it. Include the documented quirks the behaviour has to survive.

**Applicable fixtures.** Which of `tests/conftest.py`'s fixtures and `tests/fake_*.py`'s fakes cover this, by name, with one line each on what they give.

**The spec block contains zero implementation detail.** No function bodies, no private names, no control flow, no "it loops until", no algorithm. If a behaviour cannot be stated without describing how it is implemented, that is a spec smell — it usually means the behaviour has no observable contract, or the contract is the implementation. **Stop and put that to the user** rather than leaking it into the spec; a test written against implementation shape is the thing this whole chain exists to prevent.

## 2. Spawn the test-writer

Hand the spec block to the `test-writer` subagent. It has never seen the implementation and a hook keeps it that way. Give it the spec and the target test file; do not give it the diff, the module path to read, or a hint about how anything works.

## 3. Run the new tests

`.venv/bin/pytest tests/<file> -q`, plus `make check` once the file is in place.

## 4. Adjudicate every failure yourself — before touching anything

A failing test here means the spec and the code disagree. Exactly one of three things is true, and **you** decide which, in words, before a single edit:

- **The code is wrong.** The test caught a real defect. Say what the defect is; fixing it is a separate change with its own approval.
- **The spec was ambiguous or wrong.** You mis-stated the behaviour. Say which line of the spec was wrong and what it should have said, then re-run the writer with the corrected spec — do not hand-edit the test into agreement.
- **The test misreads a correct spec.** Rare, and the burden is on you: state why the test, and not the code, is wrong, and what the test asserts that the spec does not say.

Report which one to the user before changing code or tests. Editing a test until it passes is forbidden without that statement. It is the failure mode this chain exists to catch, and it is silent: the suite goes green either way.

## 5. Bite check — prove the tests can fail

Once the new tests are green against the working tree, prove they go red without it (`docs/testing.md` rule 8). Revert the implementation but keep the tests: stash every changed non-test path (usually `hqptuner/`; add `data/` or others if the change touched them), re-run the new test file, then restore. Chain it so the restore runs even when pytest errors:

```
git stash push -- hqptuner/ && (.venv/bin/pytest tests/<file> -q; git stash pop)
```

Confirm the restore afterwards — `git stash list` empty, working-tree diff back to what it was — before doing anything else.

Read the result:

- **Red — bite confirmed.** Assertion failures are the strong form. A collection or import error is a weak bite: it proves the tests reach the new surface, not that the assertions constrain it. Report which you got.
- **Green — bite failure.** The test passes against code that lacks the change, so it constrains nothing. Do not hand-edit it into failing: name the vacuous test, work out which observable outcome the spec should have pinned, and re-run the writer with the spec tightened.

Skip the check only when there is no pre-change state to fail against — characterization tests of existing behaviour, tests accompanying a pure refactor — and say so in the report instead of skipping silently.

## 6. Spawn the test-reviewer

Fresh context, same blindness. Give it the spec block and the test files. It returns a findings block: tautologies, uncovered spec behaviours, and policy violations the mechanical gates cannot see.

## 7. Surface the findings

Paste the reviewer's findings block to the user verbatim, with your own verdict per `BLOCKER` and `MAJOR` line — agree, or say why not. Do not act on them without a go. An empty findings block is a real result; report it as one rather than dressing it up.
