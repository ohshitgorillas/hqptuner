---
phase: 7
plan: 2
requirements: []
depends_on: [1]
files:
  - docs/spec/timing.md
---

# Phase 7: Visuals stay in sync after a track starts - Plan 2: The owner's ruling on the lag after a start

## Goal

After a track starts, the visuals keep the same lag behind the sound that they hold for the rest of the track, whatever the track's sample rate. This plan turns the capture into the owner's ruling. It states how the playhead's lag is set after a start, and that ruling becomes the spec the fix is held to.

## Must be true when done

- `docs/spec/timing.md` states the owner's ruling on how the playhead's lag is set after a start, in the owner's approved words. The ruling sits in "The two clocks" and Rule 1.
- The ruling says what the lag is measured against in playback terms, so a replay test can check it against an independently determined expectation.
- The commit that changes `timing.md` cites `.planning/phases/7/CAPTURE.md` and carries the decision.
- If the capture refutes the rush, the spec says so in the owner's words, and no anchor change is ruled.

## Context

- D-01 binds this plan. Today the lag is set once, at the first paint after a restart, to the newest frame end less the delay, and moves only on wall `dt` afterward. Any correction after the anchor changes the owner's v2.0.0 rule (`.planning/_archive-v2.0.0/5/CONTEXT.md` D-01: "drift and stall handling only if a measurement shows them needed"). So the owner rules on the capture's evidence first.
- D-02 states what a ruled fix must deliver: one shared playhead whose lag after a start is the same at every rate and wherever the reader or loop connected. It allows no per-rate offset and no per-view correction.
- `docs/spec/timing.md` is normative and owned by the owner's rulings. Its words are the owner's, verbatim.

## Tasks

### Task 1: Write the owner's ruling on the lag after a start into the timing spec

- **Files:** docs/spec/timing.md
- **Reads:** .planning/phases/7/CAPTURE.md, docs/spec/timing.md#The two clocks, docs/spec/timing.md#Rules, .planning/_archive-v2.0.0/5/CONTEXT.md
- **Decisions:** D-01, D-02
- **Action:** Put a decision request to the owner. It states the cause the capture shows, the evidence (numbers quoted from `CAPTURE.md` with their commands), and your confidence. Each candidate rule it lays out must keep three things from the v2.0.0 law that D-02 does not reopen: the stamps stay the only authority for where the music is, `pacePaint` stays pure with `dt` its only time input, and there are no per-rate offsets or per-view corrections.

  Each candidate rule also states, in playback terms, what "the lag behind the sound" is measured against. Plan 3's replay tests need an expectation that does not come from the implementation's own arithmetic (`docs/spec/testing.md` rule 10).

  If the capture refuted the rush, the request says so, and the candidate rules include ruling no anchor change.

  The request also states where the connect-timing cause sits. Stamp 0 is the reader's connect moment (D-03), so that cause may sit on the server, in `hqptuner/engine/meterfeed.py` or `hqptuner/engine/metering.py`, rather than in the browser playhead. If the capture or the ruling places any part of the fix outside Plan 3's five leased files, the orchestrator sends Plan 3 back for revision before it executes.

  The owner rules. Write the ruling into "The two clocks" paragraph and Rule 1 of `docs/spec/timing.md`, verbatim as the owner approves it, with `Edit`, soft-wrapped, and with no em dashes. Change no other rule's meaning. Text the ruling makes false elsewhere in the file is shown to the owner as part of the same approval, not reworded silently.

  The commit message carries the decision and cites `.planning/phases/7/CAPTURE.md`. The orchestrator commits.

  Do not draft a `CHANGELOG.md` entry, because the v2 changelog is the owner's alone. Do not touch code here; the code follows the ruling in Plan 3.
- **Verify:** human-verify. The owner approves the changed `timing.md` text character for character. `scripts/gate.sh make lint` prints `exit=0`, which covers `check_docs.py`, `check_doc_refs.py` and spelling. `.claude/hooks/md-softwrap.py --check docs/spec/timing.md` passes. `git diff docs/spec/timing.md` touches only the ruling's text and the approved consequential lines. Testing scope: none; this is a spec change.

## Notes

- Plan 3's design follows this ruling. If the ruling needs an input the playhead model does not take today, or a file Plan 3 does not lease, Plan 3 goes back for revision before it executes. Examples would be a Status-derived stamp, or a change on the server side of the feed.
- If the owner rules no anchor change for the rush, AC2 holds and no anchor fix lands this phase. D-02 still requires the connect-timing cause fixed, and Plan 3 Task 3 carries that.
