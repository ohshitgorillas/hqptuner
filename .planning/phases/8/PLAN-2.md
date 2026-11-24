---
phase: 8
plan: 2
requirements: []
depends_on: [1]
files: []
---

# Phase 8: Visuals stay in sync after a track starts - Plan 2: The owner hears the same lag at every rate

## Goal

After a track starts, the visuals keep the same lag behind the sound that they hold for the rest of the track, whatever the track's sample rate. This plan puts Plan 1's fix in front of the owner's eyes and ears on the rebuilt dev build. That is AC6, and it is where the phase 7 verdict ("different rates still run at different delays") is either answered or reopened.

## Must be true when done

- With music playing at the hand-back URL, the owner plays tracks at two sample rates: a start from stopped, a same-rate track change and a rate change. The meters, the spectrum and the spectrogram hold the same lag behind the sound right after each start as later in the same track (AC6, success criterion 1).
- The lag the owner sees is the same at both rates (success criterion 2, the phase 7 verdict).

## Context

- D-12: the heard clock is the stamps' settled line less the output delay. No test checks that assumption; the owner's ears are the check. A lag the owner hears differ between rates, after Plan 1's tables pass, is evidence of a cause the tables do not model. It is never absorbed or explained away (`~/dev/CLAUDE.md` 6.3).
- Host rules bind: hqplayerd is live production. The owner starts and changes the tracks. No agent sends a transport command or any write to hqplayerd (scope boundary), and no reviewer agent is dispatched (repo `CLAUDE.md`, reviewers are the owner's to commission).

## Tasks

### Task 1: The owner checks the lag after a start at two rates on the rebuilt dev build

- **Files:** none (verification only)
- **Reads:** .claude/task-check.sh, docs/spec/timing.md#The two clocks
- **Decisions:** D-02, D-08, D-12
- **Action:** Load the `hand-back` skill and the host skill before quoting any URL or touching host state. Confirm `hqptuner:dev` serves Plan 1's last commit and is healthy on `:8090`, as Plan 1 Task 3's `task-check.sh` run left it. If it does not, run `bash .claude/task-check.sh`, naming it first since the rebuild holds cores for minutes. Take your own `scripts/snap.py` captures of the Source page meters and the Source drawer's spectrogram while music plays, and read each one element by element, as the `hand-back` skill says. Then hand the owner the URL and say what to look for. The owner plays a track from stopped, changes to another track at the same rate, then changes to a track at another rate. At each start, the owner compares the lag between what is seen and what is heard, right after the start and well into the track, and compares the two rates. Probe read-only. Never click Apply, Apply & Save, Discard or Save as New, since the staging buffer is the owner's (`live-daemon` skill).
- **Verify:** human-verify: the owner, at the hand-back URL on the rebuilt `hqptuner:dev`, reports that after a start from stopped, a same-rate change and a rate change, the meters, the spectrum and the spectrogram hold the same lag right after the start as later in the track, and the same lag at both rates. The report quotes the owner's words. A start or a rate the owner says differs is a defect report and goes back to planning with the owner's words and the rates named, never a pass. Testing scope: the owner's check is the evidence, and no automated check stands in for it.
