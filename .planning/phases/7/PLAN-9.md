---
phase: 7
plan: 9
requirements: []
files:
  - scripts/probes/kit/probekit.py
  - scripts/probes/absent_plugin/probe_absent_plugin.py
  - scripts/probes/probe_cleanup_profiles.py
  - scripts/probes/probe_daemon_save_post.py
  - scripts/probes/probe_iir_q.py
  - scripts/probes/probe_post_reassert.py
  - scripts/probes/probe_profile_post_process.py
  - scripts/probes/probe_switch_post_effect.py
  - scripts/probes/restore_pristine.py
  - scripts/probes/rate/probe_rate_effect.py
  - scripts/probes/rate/probe_rate_playing.py
  - scripts/probes/rate/probe_rate_source_effect.py
  - scripts/snap.py
  - scripts/sweepslide.py
---

# Phase 7: One time base - Plan 9: No duplicated probe and page-capture plumbing

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- The daemon probes share one module for their connection, settle, retry, restart and error plumbing, and each probe keeps only its own question and its own entry point.
- `npx jscpd --format python` reports no clone with a side under `scripts/probes/`, `scripts/snap.py` or `scripts/sweepslide.py` except per-script entry points.
- No probe is run to prove the change.

## Context

- D-03 and D-08 bind this plan. Clone rules: a clone is gone when its code lives once and every former copy calls it; a forwarder or rename that leaves the same token run in two places removes nothing. Each removed clone turns its two copies into calls of one shared copy: two call sites per clone, in the files the task lists. A clone of a justified kind stays and is named, with its kind, in the commit message.
- Host safety: every probe here writes to or restarts the production hqplayerd. None is executed in this plan, `--help` included; proof is static (lint, types, byte-compile). `scripts/probes/meter/arrival_patterns.py` and `scripts/probes/capture_meter_feed.py` keep their own samples-to-ms arithmetic (D-08) and are not touched.
- The shared module's name, `scripts/probes/kit/probekit.py`, is the planner's choice. Probes under `rate/` and `absent_plugin/` reach it the way the repo's runnable scripts already reach a sibling directory (`scripts/junkcal/junkburst_blocks.py` puts the path on `sys.path`).

## Tasks

### Task 1: The probes' daemon plumbing lives once

- **Files:** scripts/probes/kit/probekit.py, scripts/probes/absent_plugin/probe_absent_plugin.py, scripts/probes/probe_cleanup_profiles.py, scripts/probes/probe_daemon_save_post.py, scripts/probes/probe_iir_q.py, scripts/probes/probe_post_reassert.py, scripts/probes/probe_profile_post_process.py, scripts/probes/probe_switch_post_effect.py, scripts/probes/restore_pristine.py
- **Reads:** scripts/probes/probe_post_reassert.py, scripts/probes/probe_cleanup_profiles.py#_settle, scripts/probes/probe_cleanup_profiles.py#_rpc, scripts/probes/probe_profile_post_process.py
- **Decisions:** D-03
- **Action:** Into `probekit.py` go the host and port read from the environment, the reconnect-and-retry loop, `_settle`, `_rpc`, the daemon restart, the `CliError` refusal, the post-process row reads and the profile restore that several probes repeat. Every probe keeps its idle gate, its restore of what it changed and its `State` readback exactly as each does now (`CLAUDE.md`, Host). Expected to stay as per-script entry points: the `main()` and result-printing tails (absent_plugin against cleanup_profiles, daemon_save_post, post_reassert and restore_pristine; daemon_save_post~iir_q; post_reassert~profile_post_process and ~switch_post_effect) and the usage docstrings (post_reassert~profile_post_process). Caller-side delta: two call sites per removed clone, across the probes listed.
- **Verify:** Testing scope: no behavior changes, and no probe may run; proof is static; testing stops there. (1) `scripts/gate.sh npx jscpd --format python`, then the log: every clone left between these files is an entry point or usage docstring named in the commit message. (2) `scripts/gate.sh make lint` passes. (3) `scripts/gate.sh .venv/bin/python -m py_compile` over each file in this task passes. (4) `git diff` shows no change to any idle gate, restore or readback call's arguments.

### Task 2: The rate probes share their slot lookup and their restore

- **Files:** scripts/probes/kit/probekit.py, scripts/probes/rate/probe_rate_effect.py, scripts/probes/rate/probe_rate_playing.py, scripts/probes/rate/probe_rate_source_effect.py
- **Reads:** scripts/probes/rate/probe_rate_effect.py#_index_of, scripts/probes/rate/probe_rate_source_effect.py
- **Decisions:** D-03
- **Action:** Clones removed: `_index_of` (rate_effect~rate_playing), the explicit-PCM probe body and the `SetRate` restore (rate_effect~rate_source_effect twice, rate_effect~rate_playing). Expected to stay: the usage docstrings (rate_effect~rate_source_effect), a per-script entry point.
- **Verify:** As Task 1, over this task's files.

### Task 3: One console recorder serves the page captures

- **Files:** scripts/snap.py, scripts/sweepslide.py
- **Reads:** scripts/snap.py#attach_console, scripts/sweepslide.py
- **Decisions:** D-03
- **Action:** `attach_console` and the failed-request record it writes live once; the other script imports it (both import siblings bare, as `sweepslide.py` already does `sweepplots`).
- **Verify:** Testing scope: no behavior changes; static proof; testing stops there. (1) `scripts/gate.sh npx jscpd --format python`, then the log: no clone between `snap.py` and `sweepslide.py`. (2) `scripts/gate.sh make lint` passes. (3) `scripts/gate.sh .venv/bin/python -m py_compile scripts/snap.py scripts/sweepslide.py` passes.
