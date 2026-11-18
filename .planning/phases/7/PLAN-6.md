---
phase: 7
plan: 6
requirements: []
files:
  - hqptuner/static/components/faceplate/Popover.js
  - hqptuner/static/components/faceplate/SeeMore.js
  - hqptuner/static/components/faceplate/page/DisplayOptions.js
  - hqptuner/static/components/faceplate/page/FilterPresets.js
  - hqptuner/static/components/faceplate/bottom/Switcher.js
  - hqptuner/static/components/faceplate/lists/FacetPopover.js
  - hqptuner/static/components/faceplate/drawers/pipelines/parts.js
  - hqptuner/static/components/faceplate/Header.js
  - hqptuner/static/components/faceplate/HfFilter.js
  - hqptuner/static/components/faceplate/Volume.js
  - hqptuner/static/components/faceplate/settings/VisualBlocks.js
  - hqptuner/static/components/faceplate/settings/visual.js
  - hqptuner/static/components/matrix/plot-traces.js
---

# Phase 7: One time base - Plan 6: No duplicated production JavaScript

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- `npx jscpd --format javascript` reports no clone with a side under `hqptuner/static/`.
- Every popover the faceplate parks under its trigger is placed by one shared routine, and the pages look and behave as before.

## Context

- D-03 binds this plan. Clone rules: a clone is gone when its code lives once and every former copy calls it; a forwarder, rename or reformat that leaves the same token run in two places removes nothing. Behavior is unchanged. Each removed clone turns its two copies into calls of one shared copy: two call sites per clone, in the files the task lists. A second copy of the same code that jscpd does not report is in scope too (`~/dev/CLAUDE.md` 10.2).
- Copy: a label or list of labels that moves keeps every character; moving owner copy is not rewording it.
- `docs/spec/design-system.md` binds any layout touch; none is planned.

## Tasks

### Task 1: One routine parks a popover under its trigger

- **Files:** hqptuner/static/components/faceplate/Popover.js, hqptuner/static/components/faceplate/SeeMore.js, hqptuner/static/components/faceplate/page/DisplayOptions.js, hqptuner/static/components/faceplate/page/FilterPresets.js, hqptuner/static/components/faceplate/bottom/Switcher.js, hqptuner/static/components/faceplate/lists/FacetPopover.js, hqptuner/static/components/faceplate/drawers/pipelines/parts.js, hqptuner/static/components/faceplate/Header.js, hqptuner/static/components/faceplate/HfFilter.js, hqptuner/static/components/faceplate/Volume.js
- **Reads:** hqptuner/static/components/faceplate/Popover.js#parkAt, hqptuner/static/components/faceplate/SeeMore.js#park, hqptuner/static/components/faceplate/bottom/Switcher.js#park, hqptuner/static/components/faceplate/HfFilter.js#park
- **Decisions:** D-03
- **Pins:** tests/js/components/faceplate/switcher.test.js, tests/js/components/faceplate/hf-filter.test.js, tests/js/components/faceplate-lists/default-mark.test.js, tests/js/components/faceplate-page/presets.test.js
- **Action:** Seven components carry a `park(panel)` (`Header.js` also a `parkNote`) and two more a `parkBeside` or `parkLeft`, each of which calls `parkAt` and writes the rounded `left` and `top` onto the panel. That placement lives once, beside `parkAt` in `Popover.js`, and every copy calls it, keeping its own `how` and any focus it hands after placing (`HfFilter.js`, `Volume.js`). Clones removed: SeeMore~DisplayOptions, SeeMore~FilterPresets, Switcher~FacetPopover, Switcher~parts; the `Header.js`, `HfFilter.js` and `Volume.js` copies go by the same rule. Caller-side delta: about ten call sites, one in each file listed.
- **Verify:** Testing scope: no behavior changes; the popover suites already pin where each panel opens; no new test; testing stops there. (1) `grep -rnE "function park[A-Za-z]*\(panel\)" hqptuner/static` lists no function whose body is the shared placement; each one left only adds its own focus or `how` around a call to the shared routine. (2) `scripts/gate.sh npx jscpd --format javascript`, then the log: no clone with a side in this task's files. (3) `scripts/gate.sh make test-js` passes with the same test count as before the task. (4) `bash .claude/task-check.sh` passes; the owner opens each popover at the hand-back URL and sees it where it was.

### Task 2: The remaining production JavaScript clones go

- **Files:** hqptuner/static/components/faceplate/HfFilter.js, hqptuner/static/components/faceplate/Volume.js, hqptuner/static/components/faceplate/settings/VisualBlocks.js, hqptuner/static/components/faceplate/settings/visual.js, hqptuner/static/components/matrix/plot-traces.js
- **Reads:** hqptuner/static/components/faceplate/settings/visual.js#HIDEABLE, hqptuner/static/components/faceplate/settings/VisualBlocks.js#HIDEABLE, hqptuner/static/components/matrix/plot-traces.js
- **Decisions:** D-03
- **Pins:** tests/js/components/faceplate-settings/visual.test.js
- **Action:** Clones removed: HfFilter~Volume (what remains of it after Task 1), VisualBlocks~visual (the hideable stages list, owned once and imported by the other, every label unchanged), and the self-clone in `plot-traces.js` (the two band-frequency trace builders, folded into one). Caller-side delta: two call sites per clone in these files.
- **Verify:** Testing scope: no behavior changes; the settings, matrix and faceplate suites already pin these; no new test; testing stops there. (1) `scripts/gate.sh npx jscpd --format javascript`, then the log: no clone with a side under `hqptuner/static/`. (2) `scripts/gate.sh make test-js` passes with the same test count as before the task. (3) `bash .claude/task-check.sh` passes; the owner sees the Visual settings drawer and the matrix plot as before at the hand-back URL.
