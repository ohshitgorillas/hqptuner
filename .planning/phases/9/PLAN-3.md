---
phase: 9
plan: 3
requirements: [SPEC-02]
files:
  - docs/spec/faceplate.md
---

# Phase 9: No trace on the other visualizer effects - Plan 3: The faceplate spec states the trace rule

## Goal

The trace is drawn on the spectrum only, and on none of the other visualizer effects. `docs/spec/faceplate.md`, which owns the Spectrum style rule, says so (AC6).

## Must be true when done

- The Source section's entry in `docs/spec/faceplate.md` states that the trace shows under the Trace style only, under every color suite, and that the grid, the scales and the Range keys show as each style already shows them (AC6). Ridges already hides its dB grid lines and dB scale labels (`hqptuner/static/css/meter.css:50`), so the sentence must not claim they show under every style.

## Context

- D-11: the rule goes in `docs/spec/faceplate.md` and in the commit message. No user-facing text changes, and there is no `CHANGELOG.md` entry.
- CONTEXT flagged assumption (Likely): the sentence is the owner's to approve before it lands, as the Phase 7 spec amendment was. The sentence below is a proposal. The owner's approved wording is what lands, character for character.
- Out of scope: the missing Flames in the style list on the same entry's first line, and every other line of the doc.

## Tasks

### Task 1: Add the trace rule to the Source section's spec

- **Files:** docs/spec/faceplate.md
- **Reads:** docs/spec/faceplate.md#Page
- **Decisions:** D-01, D-03, D-11
- **Action:** In the Page section's **Source** list item, the one opening "**Source** (Auto, Spectrum, or bypassed)", add one new indented paragraph line. It goes between that item's first line and the "The Range control sits in the spectrum's top-right corner" paragraph, with a blank line on each side, indented four spaces like its sibling paragraphs. The item's first line already runs about 607 characters, and `scripts/gates/check_docs.py` holds every spec line to 700, so the sentence cannot be appended to it. Proposed wording, landing only as the owner approves it: "The trace (its line, the filled area under it and its slower-falling shadow) shows under the Trace style only; under every other style, whatever the color suite, the spectrum draws no trace, and its grid, scales and Range keys show as that style already shows them (Ridges shows no dB grid lines or dB scale labels)." If the owner rewords it, land the owner's text verbatim. Write it with `Edit`, never from the shell, as one soft-wrapped line. Use no em dash and no backticked path.
- **Verify:** `grep -n "Trace style only" docs/spec/faceplate.md` prints exactly one line, and nothing before the task. `python3 .claude/hooks/md-softwrap.py --check docs/spec/faceplate.md` exits 0. `.venv/bin/python scripts/gates/check_docs.py .` exits 0. `grep -c "—" docs/spec/faceplate.md` prints `0`. The landed line matches the owner-approved wording character for character. Testing scope: a doc edit, so its own gates are the evidence. No code test and no rebuild apply (repo `CLAUDE.md`).

## Notes

- Owner approval of the sentence is due before this plan executes. The plan shares no file with Plans 1 and 2, so it may run beside them.
