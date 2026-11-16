---
phase: 8
plan: 4
# Phase 8 maps no requirement ID (ROADMAP: "Requirements: None"); this plan covers F-026, F-018 (the audit limit) and F-033, against CONTEXT AC4 and AC5.
requirements: []
files:
  - hqptuner/presets/names.py
  - hqptuner/presets/store/presets.py
  - hqptuner/presets/store/live.py
  - hqptuner/presets/store/matrixmode.py
  - CHANGELOG.md
  - tests/api/surface/test_preset_name_reach.py
  - hqptuner/api/routes/audit.py
  - tests/audit/test_audit_limit_cap.py
  - hqptuner/static/store/plainnames.js
  - hqptuner/static/store/narrow/match.js
  - tests/js/store/narrow/inherited-labels.test.js
  - .filepawl.toml
---

# Phase 8: Config write path and input validation - Plan 4: Names, the audit limit and the SPA lookups

## Goal

Findings F-006, F-007, F-010, F-011, F-012, F-013, F-014, F-016, F-018, F-019, F-026, F-032 and F-033 are each fixed or carry an owner ruling. This plan closes the name and read-side items: a preset path stays inside its store on every platform and the Windows build refuses NTFS stream and device names (F-026), `/api/audit` answers at most its cap (F-018), and a daemon label such as `constructor` cannot crash Simplified mode or narrowing (F-033).

## Must be true when done

- Under the Windows build `a:b` and `CON` are refused as preset, snapshot and mode names, while on Linux `a:b` saves (AC5, D-15).
- A preset name whose resolved path leaves its store is refused on every platform, and nothing outside the store is read, written or deleted (AC5, D-15).
- `/api/audit` with a `limit` over its cap answers at most the cap (AC4, D-06).
- A daemon option labelled `constructor` renders in Simplified mode and survives engaged narrowing without an error (AC5, D-07).

## Context

- Locked: D-06 (the audit cap), D-07 (own-key lookups; the `FOCUS_RE` rewrite and the error boundary declined), D-15, D-16.
- `names.validate_name` is the one rule all three stores call: `presets.canonical_name`, `live.canonical_name`, `matrixmode.MatrixModeStore.write`, and the first-connect migration through `PresetStore.import_missing`. Live snapshots and matrix modes are JSON keys, never paths, so the shared rule is what reaches them; the one path join is `PresetStore._path`.
- Its refusals read `Invalid <label> name: <reason>` under `name_invalid`, the reasons owner copy, one per check (`names._CHECKS`).
- Tests-first with bite (`docs/testing.md` rule 8); no environment coupling (rule 16), so no test patches the platform or reads it.
- Changelog binding as in Plan 1 Context: Tasks 1, 2 and 4 are marked **Changelog** and land their owner-approved `### Security` bullet in their own commit (copy item 12), unless the owner's approved copy merges two; Task 3 is internal-only (a debug-log route). The changelog gate prints `exit=0` in each marked Verify.

## Tasks

### Task 1: The Windows build refuses NTFS stream and device names

- **Files:** hqptuner/presets/names.py, hqptuner/presets/store/presets.py, hqptuner/presets/store/live.py, hqptuner/presets/store/matrixmode.py, CHANGELOG.md, tests/api/surface/test_preset_name_reach.py
- **Changelog:** yes.
- **Action:** A name being stored gains two checks that apply on Windows only (D-15): a `:` anywhere in the name, and a reserved device name, meaning `CON`, `PRN`, `AUX`, `NUL`, `COM1` to `COM9`, `LPT1` to `LPT9`, and the superscript-digit `COM¹`, `COM²`, `COM³`, `LPT¹`, `LPT²`, `LPT³` Microsoft's naming page lists, compared case-insensitively against the part of the name before its first `.` (that page: `NUL.txt` is equivalent to `NUL`, and the store adds `.xml`). Linux and macOS keep accepting both. The platform is an input the rule takes, defaulting to the running one, the way the clock and the network are handed in, so a test states the platform rather than patching `sys.platform`. The reasons are owner copy (Plan 1 Notes, copy item 10); if they are not in hand, stop and ask. The checks run only where a name is stored, never where an existing one is read, applied or deleted: `validate_name` runs today on every `read`, `delete` and `set_active` as well (`live.py:267,284`, `presets.py:249,295`), and live snapshots and matrix modes are JSON keys, never paths, so a Windows snapshot named `A:B` or `CON` saved before this phase is valid data that must stay applicable and deletable (user actions always proceed). So `validate_name` is unchanged. `names.py` already holds `validate_new_name` (`names.py:155`), the mixed-script rule `PresetStore.save` runs on a first save only, migrations and overwrites exempt (`presets.py:233-239`); it stays as it is, with its exemptions. `names.py` gains one more public function, the shared rule plus the Windows checks, and it runs on every store regardless of the first-save, migration or overwrite branch that gates `validate_new_name`, so whether `a:b` is refused never depends on that branch. It is called by the four sites that store a name: `PresetStore.save`, `PresetStore.import_missing` (the first-connect migration), `LiveStore.save` and `MatrixModeStore.write`. Caller-side delta: four call sites in three files (`presets.py`, `live.py`, `matrixmode.py`); every read, delete and `set_active` site keeps calling `validate_name`. The three stores take the platform as a constructor input defaulting to the running one and hand it to the new-name function, so a store test states the platform too. A preset read of a reserved name on Windows is still guarded by Task 2's containment.
- **Verify:** Testing scope, pure-function lane: under the Windows platform `a:b`, `D:foo`, `CON`, `con`, `NUL.txt`, `COM1` and `LPT¹` are each refused by the new-name function with the store's `name_invalid` error type (parametrized); under the Linux platform `a:b` and `CON` pass; under Windows `CONSOLE` and `COM10` pass (the reserved list's edge, one claim each). Store lane: a live-snapshot store built with the Windows platform, whose file already holds a snapshot keyed `A:B`, reads and deletes it without error (two tests, one claim each: they pin that no existing name is locked out, and fail against a version that puts the Windows checks into `validate_name`); saving a new `C:D` in that store is refused with the `name_invalid` type (the save site wired, covered by the static discharge below). On the running test platform (Linux in CI and here) a preset save of `a:b` through `POST /api/profile/save` succeeds, characterization of AC5's Linux half. Bite: the platform input is new, so the static discharge applies (rule 8): the null stub that ignores the platform and adds no check fails every Windows refusal case. `scripts/gate.sh make check` prints `exit=0`.

### Task 2: A preset path stays inside its store

- **Files:** hqptuner/presets/store/presets.py, .filepawl.toml, CHANGELOG.md, tests/api/surface/test_preset_name_reach.py
- **Changelog:** yes, unless Task 1's bullet covers it.
- **Action:** `PresetStore._path` resolves the joined path and refuses, with the store's `name_invalid` error type and the owner-approved reason (copy item 11), unless it lies inside the resolved store directory, on every platform: the check that holds whatever the name rule misses (D-15). Resolve both sides, so a store directory reached through a symlink still works. `read`, `write`, `exists` and `delete` all go through `_path`, so the refusal reaches each. If the containment decision is written as a pure function of the two paths, one case under Windows path semantics (`pathlib.PureWindowsPath`) shows `D:foo.xml` joined to `C:\store` lying outside it. Run `filepawl accept` if it prints it.
- **Verify:** Testing scope, store lane (strong area `hqptuner/presets/store/`): in a store whose directory holds `evil.xml` as a symlink to a file outside it, reading `evil` raises the `name_invalid` error type, and saving `evil` leaves the outside file's bytes unchanged (two tests, one claim each); a store whose directory is itself a symlink still saves and reads a preset (green before and after, the role check). Bite: the two refusal cases red against the commit before this one (pre-change follows the symlink). `scripts/gate.sh make check` prints `exit=0`.

### Task 3: /api/audit answers at most its cap

- **Files:** hqptuner/api/routes/audit.py, tests/audit/test_audit_limit_cap.py
- **Action:** `records` in `audit_router` clamps `limit` to a cap before `AuditLog.tail`, so a larger request answers at most the cap; it does not refuse, since AC4 reads "answers at most the cap" (D-06). The cap is one constant in the route, at least the default `limit` of 200, stated with its reason in the constant's comment. `hqptuner/audit.py` is at its filepawl allowance and is not touched.
- **Verify:** Testing scope, REST lane on the event-log app (`tests/audit/test_audit_route.py`'s pattern): with a log holding more records than the cap, written through `AuditLog`'s public recording methods, `GET /api/audit?limit=` a value far above the cap answers exactly the cap's count. The default limit and the newest-last order are already covered by `test_the_limit_bounds_how_many_records_come_back` and `test_a_limited_response_carries_the_newest_records_not_the_oldest`, which stay green unchanged. Bite: red against the commit before this one (pre-change answers every record). `scripts/gate.sh make check` prints `exit=0`.

### Task 4: The SPA's option lookups read own keys only

- **Files:** hqptuner/static/store/plainnames.js, hqptuner/static/store/narrow/match.js, CHANGELOG.md, tests/js/store/narrow/inherited-labels.test.js
- **Changelog:** yes.
- **Action:** Every lookup in these two modules keyed by a daemon-supplied label answers own keys only (`Object.hasOwn` or a `Map`), so `constructor`, `toString` or `__proto__` read as unknown (D-07). In `plainnames.js`: `plainEntry`'s `entries[name]`, `decorateOptions`' `entries[o.label]`, `overlay.families[...]` and `overlay.variants[...]`, and the `entries[label]` reads in `plainClosedLabel` and `plainTrueName`. In `narrow/match.js`: `filterFacets.value[name]` and the two `facets[o.label]` reads feeding `facetPass`. An unknown label keeps today's treatment: raw, sorted last, passing narrowing untouched. `FOCUS_RE` and an error boundary are declined (D-07) and not touched. `plainnames.js` holds two literal NUL bytes as template-string separators (lines 89 and 145, in the family-and-variant rank keys), which the agent's `Edit` and `Write` tools may refuse. Replace each with the `\0` escape inside the same template literal first, as its own step: the string value is identical, so ranks and sort keys do not change, and the file then holds no NUL. Check it with a byte count of `\x00` in the file reading 0, and the existing `plainnames` tests staying green unchanged.
- **Verify:** Testing scope, JS store lane under `node --test` with signals assigned and `globalThis.fetch` faked on real REST shapes: with Simplified on and an overlay carrying a known label, `decorateOptions` over options labelled `constructor` and that known label returns without throwing and leaves the `constructor` option without a `display` key; `plainClosedLabel` for `constructor` returns `constructor`; with genre narrowing engaged, filtering an option list holding `constructor` keeps that option. Each case captures its outcome as a value (`assert.doesNotThrow`, or the thrown error caught and asserted on), so the pre-change `TypeError` surfaces as an assertion failure, which is the only bite proof (rule 8). Bite: all three red against the commit before this one. `scripts/gate.sh make check` prints `exit=0` (it runs `test-js`).

## Notes

- **Owner rulings, 2026-11-11.** Plan 1 Notes, first bullet, holds them and supersedes every copy stop and every changelog bullet in this plan: no task here stops for copy or adds a changelog bullet.
- **Windows naming research (CONTEXT flagged assumption).** Task 1 follows Microsoft's "Naming files, paths, and namespaces" page as F-026's evidence cites it (`learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file`): the colon reserved, a reserved name followed by an extension equivalent to the bare name. Behavior on the newest Windows releases was not checked, and no task here runs these names on Windows; the tests state the platform instead.
- **D-15's "snapshot and mode paths".** Neither store builds a path from a name; Task 1's shared rule is how D-15 reaches them, and Task 2's containment is how it reaches the one store that does.
- Copy items 10 and 11 are gathered with Plan 1's request (Plan 1 Notes). Shared with other plans: `.filepawl.toml`, `CHANGELOG.md`.
