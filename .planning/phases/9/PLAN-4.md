---
phase: 9
plan: 4
requirements: [SPEC-02]
depends_on: [1, 2, 3]
files: []
---

# Phase 9: No trace on the other visualizer effects - Plan 4: The owner sees no trace under the other styles

## Goal

The trace is drawn on the spectrum only, and on none of the other visualizer effects. This plan puts Plan 2's painter in front of the owner's eyes on the rebuilt dev build. That is AC7, and for Aurora it is the only check the browser can make, since node lacks WebGL2 (D-10).

## Must be true when done

- At the hand-back URL, with music playing, under Bars, Ridges, Aurora, Fade and Flames, with the Borealis colors and one other color suite, no trace line, fill or shadow shows. Under Trace, all three show (AC7, success criteria 1 and 2).
- Under every style, the spectrum's grid, scales and Range keys show as they did before the phase (Ridges already hides its dB grid lines and dB scale labels, `hqptuner/static/css/meter.css:50`, which is correct and not a defect), and Fade still shows its own line on its glow (D-03, D-04).

## Context

- D-10: Aurora rests on Plan 2's style table and the owner's eyes.
- Host rules bind: hqplayerd is live production. The owner plays the music. No agent sends a transport command or any write to hqplayerd, and no reviewer agent is dispatched (repo `CLAUDE.md`, reviewers are the owner's to commission).

## Tasks

### Task 1: The owner checks every style under two color suites on the rebuilt dev build

- **Files:** none (verification only)
- **Reads:** .claude/task-check.sh
- **Decisions:** D-01, D-03, D-04, D-10
- **Action:** Load the `hand-back` skill and the host skill before quoting any URL or touching host state. Confirm that `hqptuner:dev` serves Plan 2's last commit and is healthy on `:8090`, as Plan 2 Task 2's `task-check.sh` run left it. If it does not, run `bash .claude/task-check.sh`, and say first that the rebuild holds cores for minutes. While music plays, take your own `scripts/snap.py` captures of the page Source section under each of the six styles, under Borealis and under one other suite. Read each capture element by element, as the `hand-back` skill says. Then hand the owner the URL and say what to look for: under Trace, the line, the fill and the shadow; under every other style, none of the three, with the grid, scales and Range keys as that style showed them before (Ridges shows no dB grid lines or dB scale labels, before and after). Probe read-only. Picking a style or a color suite in the Display popover is a browser preference, not a daemon write. Never click Apply, Apply & Save, Discard or Save as New, since the staging buffer is the owner's (`live-daemon` skill).
- **Verify:** human-verify: the owner, at the hand-back URL on the rebuilt `hqptuner:dev`, reports what shows under Bars, Ridges, Aurora, Fade and Flames with Borealis and with one other suite: no trace line, fill or shadow. Under Trace, all three show. The report quotes the owner's words. A trace the owner sees under any non-Trace style, or a part missing under Trace, is a defect report that goes back to planning with the style and suite named, never a pass. Testing scope: the owner's eyes are the evidence, and no automated check stands in for them.
