---
phase: 9
plan: 3
requirements: [SPEC-02]
depends_on: [1, 2]
files: []
---

# Phase 9: No trace on the other visualizer effects - Plan 3: The owner sees each style's trace parts

## Goal

The trace is drawn whole on the spectrum, its line and fill on Fade, and on none of the other visualizer effects. This plan puts Plan 1's painter in front of the owner's eyes on the rebuilt dev build. That is AC7, and for Aurora it is the only check the browser can make, since node lacks WebGL2 (D-10).

## Must be true when done

- At the hand-back URL, with music playing, with the Borealis colors and one other named color suite: under Bars, Ridges, Aurora and Flames no trace line, fill or shadow shows; under Fade the line and the fill show and the shadow does not; under Trace all three show (AC7, success criteria 1 and 2).
- Under every style the grid, scales and Range keys show as before (Ridges shows no dB grid lines or dB scale labels, before and after), and Fade still shows its own line on its glow (D-03, D-04).

## Context

- The first owner check of this phase passed Bars, Ridges, Aurora, Flames and Trace and failed Fade, and did not name the second color suite (`UAT.md` item 7). This check covers all six styles again under two named suites, since Plan 1 changes the painter every style runs through.
- Flagged assumption, out of phase: under Fade the owner has seen no crisp canvas line, or a very fat one. If the SVG line and fill show and Fade still reads fat, that is recorded with the owner's words and goes to the owner; it does not fail AC7 on its own and is not worked on here.
- Host rules bind: hqplayerd is live production. The owner plays the music. No agent sends a transport command or any write to hqplayerd, and no reviewer agent is dispatched (repo `CLAUDE.md`).

## Tasks

### Task 1: The owner checks every style under two named color suites on the rebuilt dev build

- **Files:** none (verification only)
- **Reads:** .claude/task-check.sh
- **Decisions:** D-01, D-03, D-04, D-10
- **Action:** Load the `hand-back` skill and the host skill before quoting any URL or touching host state. Confirm that `hqptuner:dev` serves Plan 1's last commit and is healthy on `:8090`, as Plan 1 Task 2's `task-check.sh` run left it, by comparing the served `/components/faceplate/page/sourcepaint.js` with the working tree file; if they differ, run `bash .claude/task-check.sh`, saying first that the rebuild holds cores for minutes. Take your own `scripts/snap.py` captures of the page Source section under each of the six styles, under Borealis and under one other suite you name, and read each element by element as the `hand-back` skill says. Then hand the owner the URL, name the second suite, and say what to look for: under Trace the line, the fill and the shadow; under Fade the line and the fill without the shadow, beside Fade's own glow; under Bars, Ridges, Aurora and Flames none of the three; the grid, scales and Range keys as each style showed them before. Probe read-only: picking a style or a color suite in the Display popover is a browser preference, not a daemon write. Never click Apply, Apply & Save, Discard or Save as New, since the staging buffer is the owner's (`live-daemon` skill).
- **Verify:** human-verify: the owner, at the hand-back URL on the rebuilt `hqptuner:dev`, with Borealis and the second suite named in the hand-back, reports: under Bars, Ridges, Aurora and Flames no trace line, fill or shadow; under Fade the line and the fill and no shadow; under Trace all three. The report quotes the owner's words and names both suites. A part seen where the rule withholds it, or missing where the rule shows it, under any style or suite, is a defect report that goes back to planning with the style and suite named, never a pass. Testing scope: the owner's eyes are the evidence, and no automated check stands in for them.
