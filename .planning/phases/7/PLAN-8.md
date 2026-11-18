---
phase: 7
plan: 8
requirements: []
files:
  - scripts/junkburst/features/jbcurves.py
  - scripts/junkburst/features/jbtilt.py
  - scripts/junkburst/features/jbflip.py
  - scripts/junkburst/jbpolicy.py
  - scripts/junkburst/features/jbloao.py
  - scripts/junkburst/features/jbmirror.py
  - scripts/junkburst/features/jbveto.py
  - scripts/junkburst/features/jbquiet.py
  - scripts/junkburst/features/jbcandidates.py
  - scripts/junkburst/jbrunning.py
  - scripts/junkburst/jbscore.py
  - scripts/junkburst/jbderived.py
  - scripts/junkburst/views/jbframeonly.py
  - scripts/junkburst/views/jbframeonlyscore.py
  - scripts/junkburst/views/jbframestep.py
  - scripts/junkburst/views/jbframesteprun.py
  - scripts/junkburst/views/jbimagesrun.py
  - scripts/junkburst/views/jblabeled.py
  - scripts/junkcal/junkburst_print.py
  - scripts/junkcal/junkburst_blocks.py
  - scripts/junkcal/junkcal_eval.py
  - scripts/junkcal/junkcal_seq.py
---

# Phase 7: One time base - Plan 8: No duplicated junk-burst and junkcal tooling

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- `npx jscpd --format python` reports no clone with both sides under `scripts/junkburst/` or `scripts/junkcal/` except per-script entry points.
- The `blockstats.py` mirror of the junkburst scoring stays exactly as it is.
- Every junk-burst and junkcal tool prints the same report from the same corpus as before.

## Context

- D-03 binds this plan. Clone rules: a clone is gone when its code lives once and every former copy calls it; a forwarder or rename that leaves the same token run in two places removes nothing. Each removed clone turns its two copies into calls of one shared copy: two call sites per clone, in the files the task lists. A clone of a justified kind stays and is named, with its kind, in the commit message.
- Load `.claude/skills/junkburst/SKILL.md` first; its "Engine port" section is why `hqptuner/engine/blockstats.py` and its mirror under `scripts/junkburst/features/` stay apart. Nothing under `hqptuner/` changes here.
- The tools import each other bare (the pytest `pythonpath` and mypy path name `scripts/junkburst`, `features`, `views` and `scripts/junkcal`); a shared function goes in the module the others already import for that job (`jbderived.py` loads bursts, `jbcurves.py` holds grid and band helpers, `jbpolicy.py` the policy sweeps).

## Tasks

### Task 1: The junk-burst feature helpers live once

- **Files:** scripts/junkburst/features/jbcurves.py, scripts/junkburst/features/jbtilt.py, scripts/junkburst/features/jbflip.py, scripts/junkburst/jbpolicy.py, scripts/junkburst/features/jbloao.py, scripts/junkburst/features/jbmirror.py, scripts/junkburst/features/jbveto.py, scripts/junkburst/features/jbquiet.py
- **Reads:** scripts/junkburst/features/jbflip.py, scripts/junkburst/jbpolicy.py, scripts/junkburst/features/jbmirror.py, .claude/skills/junkburst/SKILL.md
- **Decisions:** D-03
- **Pins:** tests/test_jbderived.py
- **Action:** Clones removed: jbcurves~jbtilt (the band span read), the `jbflip.py` self-clone and jbflip~jbpolicy (the flip-sweep scoring loop), jbloao~jbpolicy (the leave-one-album-out wrong-count table), jbmirror~jbveto twice and jbmirror~jbquiet (the per-label value gathering and the by-album grouping). Every feature keeps its numbers.
- **Verify:** Testing scope: no behavior changes; the tools have no suite beyond `tests/test_jbderived.py`, so the evidence is the lint and type gates plus one offline report diffed before and after; testing stops there. (1) `scripts/gate.sh npx jscpd --format python`, then the log: no clone with both sides in this task's files. (2) `scripts/gate.sh make lint` passes, mypy included. (3) `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/test_jbderived.py` passes. (4) Where the skill names an offline run that prints a policy or feature report from the labeled corpus, that report is byte-identical before and after the task; name the run and its footprint before it starts (`~/dev/CLAUDE.md` 3.1).

### Task 2: One burst loader and one scorer serve the junk-burst views

- **Files:** scripts/junkburst/features/jbcandidates.py, scripts/junkburst/jbrunning.py, scripts/junkburst/jbscore.py, scripts/junkburst/jbderived.py, scripts/junkburst/views/jbframeonlyscore.py, scripts/junkburst/views/jbframestep.py, scripts/junkburst/views/jbframesteprun.py, scripts/junkburst/views/jbimagesrun.py, scripts/junkburst/views/jblabeled.py, scripts/junkcal/junkburst_print.py
- **Reads:** scripts/junkburst/jbscore.py, scripts/junkburst/jbderived.py#load_burst, scripts/junkburst/jbrunning.py
- **Decisions:** D-03
- **Pins:** tests/test_jbderived.py
- **Action:** Clones removed: the read of one derived burst into its content masks and header (jbscore~jbframesteprun, jbscore~jbimagesrun, jbscore~jblabeled, jbframesteprun~jbimagesrun), the raw-frame scoring of one burst (jbrunning~jbframeonlyscore, jbrunning~jbscore), the band power and candidate span reads (jbcandidates~junkburst_print, jbcandidates~jbframestep).
- **Verify:** Testing scope: as Task 1. (1) `scripts/gate.sh npx jscpd --format python`, then the log: none of the clone pairs named in the Action remains. (2) `scripts/gate.sh make lint` passes. (3) `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/test_jbderived.py` passes. (4) Each changed view's offline report from the labeled corpus is byte-identical before and after, footprint named first.

### Task 3: The two corpus runners share their tallies and their report

- **Files:** scripts/junkburst/jbrunning.py, scripts/junkburst/views/jbframeonly.py, scripts/junkburst/views/jbframeonlyscore.py, scripts/junkburst/views/jbframesteprun.py, scripts/junkburst/views/jbimagesrun.py
- **Reads:** scripts/junkburst/views/jbframesteprun.py#_engages, scripts/junkburst/views/jbframesteprun.py#_tally, scripts/junkburst/views/jbimagesrun.py
- **Decisions:** D-03
- **Pins:** tests/test_jbderived.py
- **Action:** Clones removed: jbframesteprun~jbimagesrun for the graded-burst read, the engage rule, the tally and the report headings (five pairs), jbframeonlyscore~jbimagesrun (the steady-burst collapse), the `jbrunning.py` self-clone and jbrunning~jbframeonly (the per-track table lines). Each runner keeps its own title and candidate; only the shared code moves.
- **Verify:** Testing scope: as Task 1. (1) `scripts/gate.sh npx jscpd --format python`, then the log: no clone with both sides in this task's files. (2) `scripts/gate.sh make lint` passes. (3) Each runner's report from the labeled corpus is byte-identical before and after, footprint named first.

### Task 4: The junkcal evaluators share their fill reading

- **Files:** scripts/junkcal/junkcal_eval.py, scripts/junkcal/junkcal_seq.py, scripts/junkcal/junkburst_blocks.py, scripts/junkcal/junkburst_print.py
- **Reads:** scripts/junkcal/junkcal_eval.py, scripts/junkcal/junkcal_seq.py, scripts/junkcal/junkburst_blocks.py
- **Decisions:** D-03
- **Pins:** tests/core/test_junkcal.py
- **Action:** Clone removed: junkcal_eval~junkcal_seq (the band-fill statistic read). Expected to stay: junkburst_blocks~junkburst_print, the `sys.path` setup at the head of each runnable script, a per-script entry point.
- **Verify:** Testing scope: as Task 1. (1) `scripts/gate.sh npx jscpd --format python`, then the log: no clone between `junkcal_eval.py` and `junkcal_seq.py`. (2) `scripts/gate.sh make lint` passes. (3) `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/core/test_junkcal.py` passes with the same count as before.
