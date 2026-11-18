---
phase: 7
plan: 7
requirements: []
files:
  - hqptuner/api/push.py
  - hqptuner/api/routes/meter.py
  - hqptuner/lanes/__init__.py
  - hqptuner/presets/store/live.py
  - hqptuner/presets/store/presets.py
  - hqptuner/presets/store/jsonfile.py
  - hqptuner/presets/store/narrowing.py
  - hqptuner/presets/store/narrowingjson.py
  - hqptuner/engine/metering.py
  - scripts/junkcal/junkcal_view.py
  - scripts/probes/meter/capture_meter_start.py
---

# Phase 7: One time base - Plan 7: No duplicated production Python

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- `npx jscpd --format python` reports no clone with a side under `hqptuner/` except type declarations that cannot share a field list and the `blockstats.py` mirror of the junkburst scoring.
- Scripts that copied engine code import it from the engine instead.
- Every route, store and error the server answers with behaves and reads as before, character for character.

## Context

- D-03 binds this plan. Clone rules: a clone is gone when its code lives once and every former copy calls it; a forwarder or rename that leaves the same token run in two places removes nothing. Behavior is unchanged. Each removed clone turns its two copies into calls of one shared copy: two call sites per clone, in the files the task lists. A clone of a justified kind stays and is named, with its kind, in the commit message.
- Import layering `api > core > presets > lanes > engine > conf`, enforced by `lint-imports`; a move that would invert an edge is fixed by splitting the function, never by loosening the contract. Absolute imports only.
- Error copy stays exactly as it reads, em dashes included where they already are; moving owner copy is not rewording it. `blockstats.py` and its mirror under `scripts/junkburst/` stay (`.claude/skills/junkburst/SKILL.md`, "Engine port").

## Tasks

### Task 1: One relay serves both server-sent event streams

- **Files:** hqptuner/api/push.py, hqptuner/api/routes/meter.py
- **Reads:** hqptuner/api/push.py#_events, hqptuner/api/routes/meter.py#_events
- **Decisions:** D-03
- **Pins:** tests/api/test_push_config_reading.py, tests/api/test_push_heartbeat_reading.py, tests/api/test_metering_dial.py
- **Action:** The two `_events` generators, which subscribe inside the generator, relay the queue and unsubscribe however the stream ends, become one, typed on what both feeds offer (subscribe and unsubscribe), and both routes use it. Caller-side delta: two call sites, one in each file.
- **Verify:** Testing scope: no behavior changes; the push and meter feed suites pin the relay; no new test; testing stops there. (1) `scripts/gate.sh npx jscpd --format python`, then the log: no clone between `push.py` and `routes/meter.py`. (2) `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api` passes with the same count as before the task. (3) `scripts/gate.sh make lint` passes. (4) `bash .claude/task-check.sh` passes.

### Task 2: The lane readings' file fields are declared once

- **Files:** hqptuner/lanes/__init__.py
- **Reads:** hqptuner/lanes/__init__.py#LaneFileFields
- **Decisions:** D-03
- **Pins:** tests/lanes
- **Action:** `LaneFileFields` and the larger reading type below it repeat the same nine file fields. Where the two `TypedDict`s can share the field list by inheritance with the same totality, the larger one takes it from `LaneFileFields`; where their totality or meaning differs so that they cannot, the clone stays as a type declaration that cannot share a field list, and the commit says why. Caller-side delta: none outside this file.
- **Verify:** Testing scope: no behavior changes; strict mypy and the lane suites check it; no new test; testing stops there. (1) `scripts/gate.sh make lint` passes, strict mypy included. (2) `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/lanes tests/core` passes with the same count as before the task. (3) `scripts/gate.sh npx jscpd --format python` shows the `lanes/__init__.py` self-clone gone, or the commit message names it as a kept type declaration and why.

### Task 3: One too-new-store error serves both preset stores

- **Files:** hqptuner/presets/store/live.py, hqptuner/presets/store/presets.py, hqptuner/presets/store/jsonfile.py
- **Reads:** hqptuner/presets/store/live.py#LivePresetSchemaError, hqptuner/presets/store/presets.py#PresetSchemaError, hqptuner/presets/store/jsonfile.py
- **Decisions:** D-03
- **Pins:** tests/presets
- **Action:** The two schema-too-new errors share their code, their constructor and the shape of their message; that lives once, and each store's error keeps its own class, its own base (`LivePresetError`, `PresetError`) and its own store name in the message, so every message a route returns reads exactly as before. Caller-side delta: the two error classes.
- **Verify:** Testing scope: no behavior changes; the preset store and route suites pin the refusals; no new test; testing stops there. (1) `scripts/gate.sh npx jscpd --format python`, then the log: no clone between `live.py` and `presets.py`. (2) `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/presets tests/api` passes with the same count as before the task. (3) `scripts/gate.sh make lint` passes. (4) `bash .claude/task-check.sh` passes.

### Task 4: The narrowing facets' field lists

- **Files:** hqptuner/presets/store/narrowing.py, hqptuner/presets/store/narrowingjson.py
- **Reads:** hqptuner/presets/store/narrowing.py#FacetsFile, hqptuner/presets/store/narrowing.py#Facets, hqptuner/presets/store/narrowingjson.py
- **Decisions:** D-03
- **Pins:** tests/presets/narrowing
- **Action:** `FacetsFile` (a `TypedDict`), `Facets` (a frozen dataclass) and the `TypedDict` in `narrowingjson.py` repeat one field list. A `TypedDict` and a dataclass cannot share a field list, so that clone stays as a type declaration. The two `TypedDict`s share theirs where their value types agree; where `narrowingjson.py` types its values otherwise on purpose (its docstring says so), that clone stays too and the commit says why.
- **Verify:** Testing scope: no behavior changes; the narrowing suites and strict mypy check it; no new test; testing stops there. (1) `scripts/gate.sh make lint` passes. (2) `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/presets/narrowing` passes with the same count as before the task. (3) The commit message names each narrowing clone kept and its kind.

### Task 5: Scripts that copied engine code import it

- **Files:** scripts/junkcal/junkcal_view.py, scripts/probes/meter/capture_meter_start.py, hqptuner/engine/metering.py
- **Reads:** hqptuner/engine/junkcurve.py#median_smooth, hqptuner/engine/metering.py#_read_frame, scripts/junkcal/junkcal_view.py, scripts/probes/meter/capture_meter_start.py#read_frame
- **Decisions:** D-03, D-08
- **Pins:** tests/core/test_junkcal.py
- **Action:** `junkcal_view.py` uses the engine's median smoothing from `hqptuner/engine/junkcurve.py` instead of its own copy, and `capture_meter_start.py` reads a frame through `hqptuner/engine/metering.py` instead of its own copy of the header read. The engine's `_read_frame` is private; the one change allowed in `metering.py` is making that function public for its new caller, with its body unchanged, and `junkcurve.py` does not change. Neither script is run against the daemon to prove it: `capture_meter_start.py` reads the production metering stream. Caller-side delta: the call sites of each copy in its own script.
- **Verify:** Testing scope: no behavior changes; lint and type checks cover both scripts, and the junkcal suite covers the view's helpers; no live run; testing stops there. (1) `scripts/gate.sh npx jscpd --format python`, then the log: no clone between `hqptuner/engine/` and these two scripts. (2) `scripts/gate.sh make lint` passes, mypy included. (3) `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/core/test_junkcal.py` passes with the same count as before the task. (4) `bash .claude/task-check.sh` passes.
