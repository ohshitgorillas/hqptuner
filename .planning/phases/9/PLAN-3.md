---
phase: 9
plan: 3
depends_on: [1, 2]
# Phase 9 maps no requirement ID (ROADMAP: "Requirements: None"); this plan closes F-031's interrupted-write half (CONTEXT AC4).
requirements: []
files:
  - hqptuner/atomicwrite.py
  - hqptuner/core/connection.py
  - hqptuner/presets/store/live.py
  - hqptuner/presets/store/favorites.py
  - hqptuner/presets/store/descriptions.py
  - hqptuner/presets/store/autopilot.py
  - hqptuner/presets/store/narrowing.py
  - hqptuner/presets/store/matrixmode.py
  - hqptuner/presets/store/presets.py
  - hqptuner/presets/store/filterpark.py
  - hqptuner/presets/presetops.py
  - tests/test_atomic_write.py
  - tests/presets/integrity/test_atomic_writes.py
  - .filepawl.toml
---

# Phase 9: Apply and store integrity - Plan 3: The atomic store writes

## Goal

Findings F-029, F-030 and F-031 are each fixed or carry an owner ruling. This plan closes F-031's interrupted-write half: every JSON store, the preset files, the park, the safety copy and `connection.json` are written through one fsynced temp-and-rename helper, so a write killed partway leaves the previous file whole.

## Must be true when done

- A store write that fails between writing its temporary file and the rename leaves the previous file whole and readable, for every JSON store, the preset XML, `store.json`, `active.json`, a parked filter, the safety copy and `connection.json` (AC4, D-06).
- No temporary file is left behind by a failed write, and a temporary file left by a killed process is never listed as a preset, carried as a parked filter or counted against the park's ceiling (D-06).
- `connection.json` is mode 0600, also when an older crash left a wider-mode temp file beside it (AC4, D-06, phase 6 guarantee).
- An unparseable store file is still refused with the existing `StoreCorruptError`, and writes still read first (D-11).
- `scripts/gate.sh make check` prints `exit=0`, and `smoke-windows` passes on the phase's last `dev` commit (AC6).

## Context

- Locked: D-06 (one shared helper: uniquely named temp file in the target's directory, fsync it, `os.replace` over the target, fsync the directory; owner choice "fsync file and dir"), D-11 (corrupt-store refusal unchanged), D-13 (top-level `hqptuner/` has one module slot left; this plan uses it).
- The helper is a new top-level module, `hqptuner/atomicwrite.py`, importing nothing from any `hqptuner` subpackage, so it is a leaf outside the import-linter layers like `hqptuner/unwritable.py` (`pyproject.toml` `[tool.importlinter]` comment). Every layer that writes (`core`, `presets`) can then import it.
- Every caller keeps its own `unwritable.saving(...)` block, so a refused write still reads `store_unwritable` with the existing wording.
- Out: `hqptuner/core/login.py`'s link write (scope boundary); no path that overwrites a corrupt store (D-11).

## Tasks

### Task 1: One fsynced temp-and-rename helper, adopted by the connection store

- **Files:** hqptuner/atomicwrite.py, hqptuner/core/connection.py, tests/test_atomic_write.py
- **Reads:** hqptuner/core/connection.py#ConnectionStore.write, hqptuner/unwritable.py, hqptuner/presets/store/presets.py#PresetStore.__init__, pyproject.toml#tool.importlinter
- **Decisions:** D-06, D-13
- **Pins:** tests/api/login/test_connection_file_mode.py::test_a_written_record_is_owner_only, tests/api/login/test_connection_file_mode.py::test_a_leftover_temp_file_with_a_wider_mode_does_not_pass_it_to_the_record
- **Action:** Create `hqptuner/atomicwrite.py` with one write function taking the target path, the bytes, and the file mode. It creates a uniquely named temp file in the target's own directory with an exclusive create (never reopening a leftover or a planted link), at the mode given, and opens it in binary mode on every platform (`os.O_BINARY` where `os` defines it): on Windows a descriptor from `os.open` is text mode without it, and the CRT would rewrite every LF in a zip, a WAV or preset XML. It writes the bytes, flushes and fsyncs the file, `os.replace`s it over the target, then fsyncs the directory. On any failure before the replace, it removes its temp file, leaves the target untouched, and lets the `OSError` propagate unchanged to the caller's `saving` block. The temp name carries a fixed marker and never ends in a suffix a store lists by: it never ends in `.xml` (the preset store globs `*.xml`), and never matches Plan 2's dated safety-copy pattern. The module also exposes one predicate saying whether a filename is one of its temp files, for the listings Task 4 changes. The directory fsync runs on POSIX. On Windows a directory cannot be opened for fsync, so that step is skipped there; the platform is a parameter defaulting to `sys.platform`, the way `PresetStore` takes `platform`, so both branches run offline. No `pragma: no cover`, which is a gate exemption. Callers other than the connection store pass the mode `write_text` gives today (0o666 under the umask); the connection store passes 0o600. `ConnectionStore.write` writes through the helper, dropping its fixed `connection.json.tmp`: unique names replace it (D-06 rejected the fixed name because concurrent writers unlink each other's temp). The module imports nothing from any `hqptuner` subpackage.
- **Verify:** Testing scope: the helper's contract at the pure-function lane, and the 0600 guarantee (pinned, both tests stay green). Add in `tests/test_atomic_write.py`: (a) a write whose rename fails, injected by patching `os.replace` (a stdlib call, not HQPTuner code, `docs/testing.md` rule 4), leaves the previous bytes at the target, (b) that failure leaves no temp file in the directory, (c) a write with the platform given as `win32` lands its bytes, so the Windows branch runs. Against the pre-change tree these fail at collection, since the module is new; the bite run states that, and a null-stub helper fails (a) and (b) (phase 8's practice for a new function). Stop there. `scripts/gate.sh make check` prints `exit=0` (`lint-imports` green, per-file coverage of the new module at or above its floor).

### Task 2: The six JSON stores write through the helper

- **Files:** hqptuner/presets/store/live.py, hqptuner/presets/store/favorites.py, hqptuner/presets/store/descriptions.py, hqptuner/presets/store/autopilot.py, hqptuner/presets/store/narrowing.py, hqptuner/presets/store/matrixmode.py, tests/presets/integrity/test_atomic_writes.py, .filepawl.toml
- **Reads:** hqptuner/presets/store/live.py#LivePresetStore._write, hqptuner/presets/store/favorites.py#FavoriteStore._write_kind, hqptuner/presets/store/descriptions.py#DescriptionStore._save, hqptuner/presets/store/autopilot.py#AutopilotStore._write, hqptuner/presets/store/narrowing.py#NarrowingStore.write, hqptuner/presets/store/matrixmode.py#MatrixModeStore._save, hqptuner/presets/store/jsonfile.py#read_stamped
- **Decisions:** D-06, D-11
- **Pins:** tests/presets/test_jsonfile.py, tests/presets/test_filesystem_refusals_report_unwritable.py
- **Action:** Each store's single `write_text` site becomes one call to the helper with the same JSON text, encoded as `write_text` encodes it today, inside the same `saving(...)` block. Each store still reads first, and `read_stamped` still refuses an unparseable file with `StoreCorruptError` (D-11). No store gains a repair path. The JSON each store writes is unchanged.
- **Verify:** Testing scope: AC4's interrupted-write clause for the JSON stores. Covered already: corrupt-file refusal (`test_jsonfile.py`) and the `store_unwritable` wording (`test_filesystem_refusals_report_unwritable.py`), both staying green. Add one check in `tests/presets/integrity/test_atomic_writes.py`, parametrized over the six stores: after one good write, a second write whose rename fails (patched `os.replace`) leaves the store reading the first write's value. Each case goes red against the pre-change in-place write. Stop there. `scripts/gate.sh make check` prints `exit=0`; `filepawl accept` was run if filepawl printed it.

### Task 3: The preset store writes its XML, `store.json` and `active.json` through the helper

- **Files:** hqptuner/presets/store/presets.py, tests/presets/integrity/test_atomic_writes.py, .filepawl.toml
- **Reads:** hqptuner/presets/store/presets.py#PresetStore.save, hqptuner/presets/store/presets.py#PresetStore._ensure_dir, hqptuner/presets/store/presets.py#PresetStore.set_autosave, hqptuner/presets/store/presets.py#PresetStore.set_active, hqptuner/presets/store/presets.py#PresetStore.names
- **Decisions:** D-06, D-11
- **Pins:** tests/presets/test_autosave.py
- **Action:** The four write sites of `PresetStore` (the stamp in `_ensure_dir`, the XML in `save`, `store.json` in `set_autosave`, `active.json` in `set_active`) go through the helper, each inside its existing `saving(...)` block. `names()` lists `*.xml` files and must never list a helper temp file. The helper's temp names never end in `.xml` (Task 1), so the glob stays as it is. Audit records are unchanged. `delete`'s unlink is not a write and stays as it is.
- **Verify:** Testing scope: AC4 for the preset store. Add to `tests/presets/integrity/test_atomic_writes.py`, parametrized over a preset save, `set_autosave` and `set_active`: a write whose rename fails leaves the store answering the previous value (the preset bytes, the flag, the active name). Each goes red against the pre-change code. Stop there. `scripts/gate.sh make check` prints `exit=0`; `filepawl accept` was run if filepawl printed it.

### Task 4: The park and the safety copy write through the helper, and the park never lists a temp file

- **Files:** hqptuner/presets/store/filterpark.py, hqptuner/presets/presetops.py, tests/presets/integrity/test_atomic_writes.py, .filepawl.toml
- **Reads:** hqptuner/presets/store/filterpark.py#FilterPark.park, hqptuner/presets/store/filterpark.py#FilterPark.files, hqptuner/presets/store/filterpark.py#FilterPark._parked_bytes, hqptuner/presets/presetops.py#PresetOps._write_backup
- **Decisions:** D-06, D-09
- **Pins:** tests/matrix/test_filter_upload.py::test_colliding_upload_name_gets_a_serial_suffix, tests/matrix/test_filter_upload.py::test_parked_filter_rides_the_restore_archive
- **Action:** `FilterPark.park` writes the upload through the helper, and `_write_backup` (Plan 2's dated copy) writes the safety copy through it. `FilterPark.files` and `_parked_bytes` skip files the helper's predicate names as its temp files. Without that, a temp file left by a killed process would ride the next restore archive as a `data/<name>` member to the daemon, and would count against `PARK_MAX_BYTES`. Plan 1's carried-set release reads through `files`, so it never sees one either. The serial-suffix collision rule is unchanged.
- **Verify:** Testing scope: AC4 for the park and the copy. Add to `tests/presets/integrity/test_atomic_writes.py`: (a) a safety-copy write whose rename fails leaves no new copy and every earlier copy byte-identical, (b) a park write whose rename fails leaves no parked file, (c) a file the helper's predicate names as a temp file, planted in the park, is not among the parked members. (a) and (b) go red against the pre-change in-place writes; (c) goes red against the pre-change `files`, which lists every file. Stop there. `scripts/gate.sh make check` prints `exit=0`; `filepawl accept` was run if filepawl printed it.

## Notes

- **Flagged, unresolved (CONTEXT assumptions).** On Windows, `os.replace` onto a file another handle holds open can fail with `PermissionError`, since Python's `open` there does not share delete access. A store read on one threadpool thread overlapping a write on another could then refuse the write as `store_unwritable`. No task adds a retry: D-06 does not ask for one, and adding one is scope the owner has not ruled on. `smoke-windows` exercises the stores but not that overlap. This is reported in the return marker for the owner.
- The directory fsync is skipped on Windows (Task 1). That is the per-platform branch CONTEXT's third flagged assumption anticipated, since `os.open` refuses a directory there.
- fsync on every store write costs disk flushes. The offline suite writes under `tmp_path` (tmpfs on this host), and the suite-time gate catches a regression locally; CI runners write to disk.
