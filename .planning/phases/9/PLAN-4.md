---
phase: 9
plan: 4
depends_on: [1, 2, 3]
# Phase 9 maps no requirement ID (ROADMAP: "Requirements: None"); this plan closes F-031's concurrent-writer half (CONTEXT AC4).
requirements: []
files:
  - hqptuner/presets/store/live.py
  - hqptuner/presets/store/favorites.py
  - hqptuner/presets/store/descriptions.py
  - hqptuner/presets/store/autopilot.py
  - hqptuner/presets/store/narrowing.py
  - hqptuner/presets/store/matrixmode.py
  - hqptuner/presets/store/presets.py
  - hqptuner/presets/store/filterpark.py
  - hqptuner/presets/presetops.py
  - hqptuner/core/connection.py
  - docs/architecture.md
  - tests/presets/integrity/test_store_locks.py
  - .filepawl.toml
  - CHANGELOG.md
---

# Phase 9: Apply and store integrity - Plan 4: The store locks

## Goal

Findings F-029, F-030 and F-031 are each fixed or carry an owner ruling. This plan closes F-031's concurrent-writer half: each store instance serializes its own read-modify-write behind one `threading.Lock`, so two writers to one store both land.

## Must be true when done

- Two concurrent writers to one JSON store both land, and the file parses after each (AC4, D-07).
- Two concurrent preset-store writes (for example a first save and an auto-save toggle) both land (D-07).
- Two concurrent filter uploads under one name both stay parked, under distinct names (D-07).
- `scripts/gate.sh make check` prints `exit=0`.

## Context

- Locked: D-07 (each store instance holds one `threading.Lock` around its whole read-modify-write; `PresetStore` takes one lock for its directory; one instance per process makes a per-instance lock enough; moving the store routes to `async def` with `asyncio.Lock` was rejected), D-11, D-13 (race proofs force overlap with injected seams, never sleeps or thread timing).
- `threading.Lock` is not reentrant. Where a locked method calls another locked method of the same store (`PresetStore.delete` calls `set_active`, `import_missing` calls `save`, `save` and `set_autosave` call `_ensure_dir`), the inner work moves to an unlocked private step, so the lock is taken once per public call. D-07 names `threading.Lock`; substituting an `RLock` is a deviation to report, not a choice.
- Reads that are not part of a read-modify-write take no lock (D-07 locks the read-modify-write only).
- Flagged (CONTEXT): `PresetStore` is also written from event-loop code (`presetops.fanout_profiles` and `backfill_profiles` on the loop, `presetlane` saves) while threadpool `def` routes (`POST /api/autosave`) write it too. A hold is one small file write, so a loop-side wait is short. Reported, not engineered around.

## Tasks

### Task 1: Each JSON store serializes its read-modify-write

- **Files:** hqptuner/presets/store/live.py, hqptuner/presets/store/favorites.py, hqptuner/presets/store/descriptions.py, hqptuner/presets/store/autopilot.py, hqptuner/presets/store/narrowing.py, hqptuner/presets/store/matrixmode.py, tests/presets/integrity/test_store_locks.py, .filepawl.toml, CHANGELOG.md
- **Reads:** hqptuner/presets/store/live.py#LivePresetStore.save, hqptuner/presets/store/live.py#LivePresetStore.delete, hqptuner/presets/store/favorites.py#FavoriteStore._write_kind, hqptuner/presets/store/descriptions.py#DescriptionStore.write, hqptuner/presets/store/descriptions.py#DescriptionStore.merge, hqptuner/presets/store/autopilot.py#AutopilotStore.set_for_preset, hqptuner/presets/store/narrowing.py#NarrowingStore.write, hqptuner/presets/store/matrixmode.py#MatrixModeStore.write, hqptuner/presets/store/matrixmode.py#MatrixModeStore.forget, hqptuner/api/factory.py
- **Decisions:** D-07, D-11, D-13
- **Pins:** tests/presets/test_favorites.py, tests/presets/test_live_preset_store.py, tests/presets/test_description_store.py, tests/presets/test_matrix_mode_store.py, tests/presets/test_narrowing_store.py
- **Action:** Each of the six stores creates one `threading.Lock` in its constructor and holds it around every public method that reads the file and writes it back: from the read through the helper's rename (Plan 3). For example, `FavoriteStore._write_kind` reads the other kind and keeps it, `LivePresetStore.save` and `delete` read every snapshot and write them back, and `MatrixModeStore.forget` and `write`, `DescriptionStore.write` and `merge`, the `AutopilotStore` setters and `NarrowingStore.write` do the same. Nested locked calls are restructured as Context says. Validation that refuses before the read may stay outside the hold. `StoreCorruptError` and too-new refusals are unchanged (D-11). In the same commit, land Plan 4's owner-approved `### Security` bullet in `CHANGELOG.md` verbatim (Plan 1 Notes).
- **Verify:** Testing scope: AC4's concurrent-writer clause. Not covered today. Add in `tests/presets/integrity/test_store_locks.py`, parametrized over the stores where two different writes to one instance must both survive (two favorites kinds, two live snapshots, two descriptions, two matrix modes, two auto-pilot per-preset flags; the test writer drops a store whose write replaces the whole document, where last-wins is the contract): after two writers overlap, both writes are read back. Overlap is forced by an injected seam, for example the path object the store is constructed with (a `pathlib.Path` subclass, standard library, not HQPTuner code), with no sleep and no wall-clock wait (D-13). Each case goes red against the pre-change code, with a lost update. At least one store must carry a case proven red this way; a store locked by the Action with no red case of its own is named in the commit message and in Plan 5's disposition as held by the Action, never left silent. If no deterministic seam proves this for any store through the public surface without a timeout, the task stops before the lock lands and goes to the owner as a blocking question (`~/dev/CLAUDE.md` 6.1) naming the stores and the seams tried, never writing a timing test. Stop there. `scripts/gate.sh make check` prints `exit=0`; `filepawl accept` was run if filepawl printed it.

### Task 2: The preset store takes one lock for its directory

- **Files:** hqptuner/presets/store/presets.py, tests/presets/integrity/test_store_locks.py, .filepawl.toml
- **Reads:** hqptuner/presets/store/presets.py#PresetStore
- **Decisions:** D-07, D-13
- **Pins:** tests/presets/test_autosave.py
- **Action:** `PresetStore` creates one `threading.Lock` and holds it across each public write: `save` (with `_ensure_dir`'s stamp), `delete` (with its pointer clear), `set_autosave`, `set_active` and `import_missing`. Its XML files, `store.json` and `active.json` share that one lock (D-07). Nested calls are restructured so the lock is taken once per public call. Audit records keep their current order relative to the writes.
- **Verify:** Testing scope: D-07's directory lock. Add to `tests/presets/integrity/test_store_locks.py`: on a store directory with no `store.json` yet, a first preset save overlapping `set_autosave(enabled=True)` leaves auto-save on. The save's `_ensure_dir` stamp would otherwise write `{"schema": 1}` over the flag. Overlap is forced by an injected seam, no sleep. It goes red against the pre-change code. Stop there. `scripts/gate.sh make check` prints `exit=0`; `filepawl accept` was run if filepawl printed it.

### Task 3: The park, the safety copy and the connection store each hold their own lock

- **Files:** hqptuner/presets/store/filterpark.py, hqptuner/presets/presetops.py, hqptuner/core/connection.py, tests/presets/integrity/test_store_locks.py, .filepawl.toml
- **Reads:** hqptuner/presets/store/filterpark.py#FilterPark.park, hqptuner/presets/store/filterpark.py#FilterPark.clear, hqptuner/presets/presetops.py#PresetOps._write_backup, hqptuner/core/connection.py#ConnectionStore.write
- **Decisions:** D-07, D-13
- **Pins:** tests/matrix/test_filter_upload.py::test_colliding_upload_name_gets_a_serial_suffix, tests/api/login/test_connection_file_mode.py::test_a_written_record_is_owner_only
- **Action:** `FilterPark` holds one lock from its name-collision check through the write in `park`, and around `clear` and Plan 1's carried-set release. `PresetOps` holds one lock around the safety copy's write and prune (Plan 2). `ConnectionStore` holds one lock around `write`. Each is a `threading.Lock` created with its instance (D-07).
- **Verify:** Testing scope: the park's check-then-write is the case with an observable lost write. Add to `tests/presets/integrity/test_store_locks.py`: two uploads under one name, overlapped by an injected seam (no sleep), both stay parked under distinct names. It goes red against the pre-change code, where both pass the existence check and the second overwrites the first. The safety-copy and connection locks are held by the Action: two whole-file replaces end with last-wins either way, so a test of them cannot bite (`docs/testing.md` rule 8). Stop there. `scripts/gate.sh make check` prints `exit=0`; `filepawl accept` was run if filepawl printed it.

### Task 4: The architecture records the store write rules

- **Files:** docs/architecture.md
- **Reads:** docs/architecture.md
- **Decisions:** D-06, D-07, D-11
- **Action:** `docs/architecture.md` states, beside the paragraph naming the stores (`state/*.json`, `presets/`, `backups/`), that every store write goes through `hqptuner/atomicwrite.py`'s fsynced temp-and-rename, that each store instance serializes its read-modify-write behind one lock (one per preset directory), and that an unparseable store is refused, never overwritten. State rules, not history. Soft-wrapped, written with `Edit`.
- **Verify:** `.venv/bin/python .claude/hooks/md-softwrap.py --check docs/architecture.md` exits 0; the `triviajudge` Stop hook raises no flag on the added lines. A `docs/` edit runs its own gate only.
