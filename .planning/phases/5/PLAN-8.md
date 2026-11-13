---
phase: 5
plan: 8
requirements: [TEST-01]
files:
  - tests/js/store/faceplate/drawers-output.test.js
  - tests/js/store/faceplate/drawers-volume.test.js
  - tests/js/store/faceplate/hf.test.js
  - tests/js/store/faceplate/xref.test.js
  - tests/js/store/faceplate/engine.test.js
---

# Phase 5: Untested behaviors covered - Plan 8: Output, volume, HF, xref and engine stores

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the output, volume, hf, xref and engine claims of the "faceplate stores" bullet. The bullet's pipelines and source claims are Plan 15's.

## Must be true when done

- The Output dial hatches no tier while no device caps are known.
- The Volume drawer's needle is hidden while the engine holds the control.
- HF with no engine state, or with no enumeration, names no filter and offers no options.
- A gray reason naming no place carries no xref link.
- A stopped engine's speed and buffers, an empty speed, a -1 buffer, a non-applying output buffer and an unreadable total all read none.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: most claims here are negative (no, none, hidden); each gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage.
- D-10 and `docs/spec/testing.md` (read it first): one assertion per test; a "reads none" case needs its contrast (the same reading present under the healthy input) somewhere on the surface, or it asserts the zero value the absent feature produces (rule 10). Fakes at the wire; signals reset every case; jscpd at 2.3% (use case tables for the engine readings).
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin no tier hatched without device caps

- **Files:** tests/js/store/faceplate/drawers-output.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/output.js#dialView, hqptuner/static/store/narrow/devicecaps.js#grayRatesByDevice
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-output.test.js
- **Action:** Behavior: with no device caps known, the Output dial hatches no tier; with caps that exclude a tier, that tier is hatched (the contrast, if not already pinned). The wrong implementation it kills treats unknown caps as "carries nothing" and hatches every tier.
- **Verify:** The output store file passes under the plan's gate. Making the dial's hatch treat absent caps as an empty capability set turns the new case red on an assertion, and is reverted.

### Task 2: Pin the Volume drawer's needle hidden while the engine holds the control

- **Files:** tests/js/store/faceplate/drawers-volume.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/volume.js#volumeRangeNow, hqptuner/static/store/faceplate/drawers/volume.js#moveVolumeHandle
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-volume.test.js
- **Action:** Behavior as the bullet states it: the drawer's needle is hidden while the engine holds the control, and shown otherwise (the contrast). Read the module's header and `volumeRangeNow` first for which VolumeRange reading "holds the control" is; if the code contradicts the bullet's wording, stop and raise it rather than test either reading.
- **Verify:** The volume store file passes under the plan's gate. Making `volumeRangeNow` return the needle level whatever the engine reports for the control turns the new case red on an assertion, and is reverted.

### Task 3: Pin HF naming no filter without engine state or enumeration

- **Files:** tests/js/store/faceplate/hf.test.js
- **Reads:** hqptuner/static/store/faceplate/hf.js#hfNow, tests/js/store/faceplate/hf.test.js#test_the_hf_filter_reads_the_junk_filter_named_at_reported_index_1
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/hf.test.js
- **Action:** Two results: with no engine state, HF names no filter; with no enumeration, the same. The existing named-filter case is the contrast. The wrong implementation they kill is a name read off a stale or default index.
- **Verify:** The hf store file passes under the plan's gate. Making `hfNow` fall back to index 0's name when state is absent turns the no-state case red on an assertion, and is reverted.

### Task 4: Pin HF offering no options without engine state or enumeration

- **Files:** tests/js/store/faceplate/hf.test.js
- **Reads:** hqptuner/static/store/faceplate/hf.js#hfNow, tests/js/store/faceplate/hf.test.js
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/hf.test.js
- **Action:** Two results: with no engine state, HF offers no options; with no enumeration, the same. The existing options case is the contrast. The wrong implementation they kill is an options list built from the static data with no running enumeration (the engine is enumeration authority).
- **Verify:** The hf store file passes under the plan's gate. Building options from the static filter data when the enumeration is absent turns the no-enumeration case red on an assertion, and is reverted.

### Task 5: Pin no xref link for a reason naming no place

- **Files:** tests/js/store/faceplate/xref.test.js
- **Reads:** hqptuner/static/store/faceplate/xref.js#reasonXref, hqptuner/static/store/faceplate/xref.js#TARGETS
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/xref.test.js
- **Action:** Behavior: a gray reason that names none of the `TARGETS` places carries no link, while one naming a place links to it (the contrast). The wrong implementation it kills links every reason to a default place. Reasons in the test are invented sentences, never copy from `hqptuner/`; the place names are the `TARGETS` keys the module exports.
- **Verify:** The xref store file passes under the plan's gate. Making `reasonXref` fall back to the first target when none matches turns the new case red on an assertion, and is reverted.

### Task 6: Pin the engine readings that read none

- **Files:** tests/js/store/faceplate/engine.test.js
- **Reads:** hqptuner/static/store/faceplate/engine.js#engineReadings, tests/js/store/faceplate/engine.test.js#test_a_playing_engine_reads_its_speed
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/engine.test.js
- **Action:** Behaviors, each a case: a stopped engine's speed reads none, as do its input and output buffers; an empty speed reads none; a -1 buffer reads none; an output buffer that has not filled this track reads none; an unreadable total reads none. The existing playing-engine readings are each case's contrast. The plausible wrong implementations: a stopped engine showing the last frame's figures, `""` and an unreadable total coerced to 0, a -1 shown as 0 %, and a non-applying output buffer shown as 0 %. A case table keeps jscpd under its bar; one assertion per generated case.
- **Verify:** The engine store file passes under the plan's gate. Breaks, each alone: dropping `playing &&` from `reading` turns the stopped cases red; replacing `reading` with `Number(v) || 0` turns the empty-speed and unreadable-total cases red; dropping the -1 check turns the -1 case red; dropping the `outputApplies` check turns the non-applying case red. Each on an assertion, each reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
