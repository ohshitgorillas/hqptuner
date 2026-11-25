---
phase: 9
plan: 2
requirements: [SPEC-02]
files:
  - docs/spec/faceplate.md
---

# Phase 9: No trace on the other visualizer effects - Plan 2: The faceplate spec states which parts of the trace each style shows

## Goal

The trace is drawn whole on the spectrum, its line and fill on Fade, and on none of the other visualizer effects. `docs/spec/faceplate.md`, which owns the Spectrum style rule, says so (AC6).

## Must be true when done

- The Source section's entry in `docs/spec/faceplate.md` states, as D-05 lists them, which parts of the trace show under which style: Trace the line, the filled area and the shadow; Fade the line and the filled area; every other style none, whatever the color suite (AC6).
- It no longer says the trace shows under the Trace style only.
- It still says the grid, scales and Range keys show as each style already shows them, Ridges showing no dB grid lines or dB scale labels.

## Context

- At HEAD the Source item's paragraph beginning "The trace (its line, the filled area under it and its slower-falling shadow) shows under the Trace style only" states the rule the owner reversed for Fade at UAT (D-04). That paragraph is the one this plan rewords; it runs 320 characters, under the 700 that `scripts/gates/check_docs.py` allows a spec line.
- D-11: the rule goes in `docs/spec/faceplate.md` and in the commit message; no user-facing text and no `CHANGELOG.md` entry. CONTEXT flagged assumption (Likely): the sentence is the owner's to approve before it lands, as the shipped sentence was. The wording below is a proposal; the owner's approved wording lands character for character.
- Out: the missing Flames in the style list on the same item's first line, and every other line of the doc.

## Tasks

### Task 1: Reword the trace rule in the Source section's spec

- **Files:** docs/spec/faceplate.md
- **Reads:** docs/spec/faceplate.md#Page
- **Decisions:** D-01, D-03, D-04, D-05, D-11
- **Action:** Replace the Source item's indented paragraph that begins "The trace (its line, the filled area under it and its slower-falling shadow) shows under the Trace style only" with one indented paragraph line, four spaces in like its siblings, blank lines kept on each side. Proposed wording, landing only as the owner approves it: "The trace (its line, the filled area under it and its slower-falling shadow) shows whole under the Trace style, and its line and filled area without the shadow under Fade; under every other style the spectrum draws no trace. This holds whatever the color suite, and the grid, scales and Range keys show as each style already shows them (Ridges shows no dB grid lines or dB scale labels)." If the owner rewords it, land the owner's text verbatim. Write it with `Edit`, never from the shell, as one soft-wrapped line, with no em dash and no backticked path. Touch no other line.
- **Verify:** `grep -c "Trace style only" docs/spec/faceplate.md` prints `0` (it prints `1` before the task). `grep -n "under Fade" docs/spec/faceplate.md` prints exactly one line, inside the Source item, whose text matches the owner-approved wording character for character. `python3 .claude/hooks/md-softwrap.py --check docs/spec/faceplate.md` exits 0. `.venv/bin/python scripts/gates/check_docs.py .` exits 0. `grep -c "—" docs/spec/faceplate.md` prints `0`. `git diff --stat` for the task's commit names only `docs/spec/faceplate.md` with one line changed. Testing scope: a doc edit, so its own gates are the evidence; no code test and no rebuild apply (repo `CLAUDE.md`).

## Notes

- Owner approval of the wording is due before this plan executes. The plan shares no file with Plan 1, so it may run beside it.
