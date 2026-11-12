---
phase: 6
status: complete
completed: 2026-11-11
---

# Phase 6: aclean filter entries - Summary

`poly-sinc-aclean-gauss`, `poly-sinc-aclean-ext2` and `poly-sinc-aclean-xtr` have entries in `hqptuner/data/filters.json`, ported verbatim from v1's `316d72c5`, and `engine-enums.json` carries v1's 6.2.0 capture.

## What shipped

- Three `filters.json` entries, descriptions, genre, quality, focus and phase as v1 ships them, at v1's positions - `hqptuner/data/filters.json`
- The 6.2.0 enumeration capture; the only name difference from the 6.0.4 capture is the three aclean filters in `filters_pcm` and `filters_sdm` - `hqptuner/data/engine-enums.json`
- The simplified names were already in v2 through the merge `26e68c41` - `hqptuner/data/filter-plain-names.json` (unchanged)
- The filter count comment reads 80 - `hqptuner/static/store/live/chains.js`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| - | - | cdea8189 | port v1's adaptive cleanup filter entries |

## Deviations

- [deviation] Landed directly at the owner's say-so, with no CONTEXT, PLAN or executor dispatch: the phase is a port of v1 data. The owner ruled to port v1 as is, so the entries carry v1's descriptions and simplified names; FILT-01 and this phase's goal and criteria were reworded to match, which reverses the earlier "empty description, no simplified name" wording (cdea8189).

## Open items

- `todo.txt` line 17 was reworded to the same ruling; the file is gitignored, so the edit is local only.

## Goal check

The commit delivers the goal as reworded. A read of `GET /api/enumerations` on the dev container on 2026-11-11 listed exactly the three aclean names, and each joins by name to a `filters.json` entry and a `filter-plain-names.json` entry. `PYTHONPATH=$(pwd) scripts/gate.sh make check` exited 0 and task-check passed, rebuilding hqptuner:dev. No owner look at the entries in the filter picker yet.

complete locally, not CI-verified
