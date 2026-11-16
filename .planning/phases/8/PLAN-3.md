---
phase: 8
plan: 3
# Phase 8 maps no requirement ID (ROADMAP: "Requirements: None"); this plan covers F-010 and F-014, against CONTEXT AC1 and AC4.
requirements: []
files:
  - hqptuner/engine/control.py
  - hqptuner/engine/controlerrors.py
  - CHANGELOG.md
  - .filepawl.toml
  - docs/architecture.md
  - tests/support/fake_control.py
  - tests/engine/http/test_control_attr_quote.py
  - hqptuner/api/routes/volume.py
  - hqptuner/lanes/writer.py
  - tests/api/surface/test_volume_level.py
  - hqptuner/lanes/matrixlane.py
  - hqptuner/api/routes/matrix/matrix.py
  - docs/matrix-spec.md
  - tests/matrix/test_profile_switch_known.py
---

# Phase 8: Config write path and input validation - Plan 3: The Control API and the profile switch

## Goal

Findings F-006, F-007, F-010, F-011, F-012, F-013, F-014, F-016, F-018, F-019, F-026, F-032 and F-033 are each fixed or carry an owner ruling. This plan closes the 4321 half: a Control API command refuses an attribute value containing `"` and sends every other value unchanged (F-010), `POST /api/volume` refuses a level that is not a number (F-010), and a matrix profile switch names only a profile the daemon lists (F-014).

## Must be true when done

- A Control API command carrying `&`, `<` or `'` in an attribute value sends it unchanged, so `Bob's EQ` reaches the daemon as `Bob's EQ`; a value containing `"`, `x"/><Stop/` included, is refused and nothing is written to the socket (AC1, D-13).
- `POST /api/volume` with a level that is not a number is refused and no `Volume` command is sent (D-13).
- A profile switch naming a profile absent from a fresh `MatrixListProfiles` read is refused and no `MatrixSetProfile` is sent; the empty name (`[Default]`) always switches (AC4, D-14).

## Context

- Locked: D-13, D-14, D-16. D-13 is an owner ruling: the 4321 parser does not decode `&quot;`, `&amp;` or `&apos;`, so no value sent on 4321 is entity-escaped, and `engine` imports no escape helper from `conf`.
- `ControlClient.send` builds `f' {k}="{v}"'` with no escaping; every setter, `set_matrix_profile` and `send_volume` included, goes through it. `get_matrix_profiles` returns names decoded by the XML parser, the form D-14 compares in.
- `engine/control.py` sits at its filepawl allowance (404 lines): run `filepawl accept` when filepawl prints it (D-16).
- Refusals reuse `invalid_input`; no new code. Tests-first with bite (`docs/testing.md` rule 8); 4321 fakes over the in-process socketpair (rule 18).
- Changelog binding as in Plan 1 Context: every task here is marked **Changelog** and lands its owner-approved `### Security` bullet in its own commit (copy item 12), unless the owner's approved copy merges two; the changelog gate prints `exit=0` in each Verify.

## Tasks

### Task 1: A Control API attribute value containing `"` is refused

- **Files:** hqptuner/engine/control.py, hqptuner/engine/controlerrors.py, .filepawl.toml, docs/architecture.md, CHANGELOG.md, tests/support/fake_control.py, tests/engine/http/test_control_attr_quote.py
- **Changelog:** yes.
- **Action:** `ControlClient.send` checks every attribute value before building the command and, when one contains `"`, raises a new `ControlError` subclass added to `hqptuner/engine/controlerrors.py` before writing a byte, so every caller's existing `ControlError` path handles it and none surfaces as a 500 (D-16). No existing class there fits: each names a connection, timeout, parse or daemon-refusal failure, under `daemon_unavailable` or `daemon_refused`, which would blame the daemon for a value HQPTuner refused. The new class carries `code = "invalid_input"`, the code already in `STATUS`, and its docstring states it is HQPTuner's own refusal of a value, made before the socket is touched. `controlerrors.py` is an existing module, so D-16's no-new-module rule holds. Every other value is sent exactly as today, with no entity escaping: the daemon does not decode entities on 4321 (D-13), and inside the double quotes `send` writes, `"` is the only character that closes the attribute. Attribute names and element names are HQPTuner's own literals and stay as they are. The receive side is unchanged. Add one sentence to `docs/architecture.md` §2.1 (Control API lane) stating that attribute values on 4321 are sent raw because the daemon does not decode entities, and that a value containing `"` is refused, with `Edit`, soft-wrapped. If the fake 4321 cannot hand a test the raw bytes of a command it received, add that to `tests/support/fake_control.py` as a recorded value, never as logic (rule 13). Any message the new refusal carries that reaches a user is owner copy (Plan 1 Notes, copy item 14); if it is not in hand, stop and ask. Run `filepawl accept` when it prints it.
- **Verify:** Testing scope, engine lane over the in-process socketpair (strong area `hqptuner/engine/`): `set_matrix_profile` with `Bob's EQ & <Co>` puts `value="Bob's EQ & <Co>"` on the wire byte for byte, the expected bytes written by hand (characterization: green before and after, the guard against a later escape); `set_matrix_profile` with `x"/><Stop/` raises the new `ControlError` subclass, whose `code` reads `invalid_input`, and the fake records no bytes for that command. Bite: the `x"/><Stop/` case red against the commit before this one. The existing 4321 suites stay green unchanged, and they are where testing stops for the other setters, since every setter shares `send`. `scripts/gate.sh make check` prints `exit=0`.

### Task 2: POST /api/volume refuses a level that is not a number

- **Files:** hqptuner/api/routes/volume.py, hqptuner/lanes/writer.py, CHANGELOG.md, tests/api/surface/test_volume_level.py
- **Changelog:** yes.
- **Action:** `volume_set` refuses a level the writer's existing number check rejects (`writer._NUMBER`, today reached only through `_malformed` on the staged path), before `ApplyOps.set_volume` runs, so nothing is sent and no volume write is traced (D-13: "goes through the existing number check"). Make that check reachable from the route without a second pattern, by exposing it from `writer.py` as public and having `_malformed` use the same function; caller-side delta: `_malformed` and `volume_set`, two call sites in two files. The refusal is an `ErrorBody` with code `invalid_input` and the owner-approved sentence (Plan 1 Notes, copy item 8; the proposal is the writer's existing reason, reused unchanged); if it is not in hand, stop and ask.
- **Verify:** Testing scope, REST lane: `POST /api/volume` with `-3"/><Stop/` answers `invalid_input` and the fake 4321 records no `Volume` command; with `abc` the same (parametrized). A numeric level setting the volume is already covered by the existing volume tests, which stay green unchanged. Bite: both cases red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 3: A profile switch names only a profile the daemon lists

- **Files:** hqptuner/lanes/matrixlane.py, hqptuner/api/routes/matrix/matrix.py, docs/matrix-spec.md, CHANGELOG.md, tests/matrix/test_profile_switch_known.py
- **Changelog:** yes.
- **Action:** `matrixlane.switch_profile` reads `client.get_matrix_profiles()` fresh before `set_matrix_profile` and refuses a non-empty name absent from that list, compared in the decoded form the read returns (D-14); `docs/matrix-spec.md` records that the daemon answers `result="OK"` for an unknown name and then loops at the next engine reinit, so the switch's own readback is no evidence. The empty name is `[Default]` and always switches, with no list read. A failing list read is a `ControlError` and takes the route's existing `MatrixSwitchRefusedError` path. The refusal is an error the route maps to `invalid_input` with the owner-approved sentence (Plan 1 Notes, copy item 9); no `MatrixSetProfile` is sent. In `docs/matrix-spec.md`, the sentence saying `matrixlane.switch_profile` does not check the name and forwards whatever the route was given becomes false: rewrite it to say the switch checks against a fresh `MatrixListProfiles` read, with `Edit`, soft-wrapped.
- **Verify:** Testing scope, REST lane over the fake 4321, whose default `_profile_names` lists `Default` and `Mch-to-Stereo mixdown`: a switch to `Ghost` answers `invalid_input` and the fake records no `MatrixSetProfile`; a switch to `Mch-to-Stereo mixdown` (a listed name with spaces) answers 200 with that name active; a switch to the empty name answers 200. The existing switch tests (`tests/api/test_api_routes.py`, `tests/api/test_matrix_profile_errors.py`, `tests/api/test_control_failure_reads.py`) name listed profiles and stay green unchanged. Bite: the `Ghost` case red against the commit before this one; the two accepted cases are characterization. `scripts/gate.sh make check` prints `exit=0`.

## Notes

- **Owner rulings, 2026-11-11.** Plan 1 Notes, first bullet, holds them and supersedes every copy stop and every changelog bullet in this plan: no task here stops for copy or adds a changelog bullet.
- **D-13 owner ruling.** The 4321 parser does not decode `&quot;`, `&amp;` or `&apos;`. Entity-escaping on send would rename every profile containing `'`, `&` or `"` in the daemon's eyes, so Task 1 refuses `"` and sends everything else raw. A profile whose name contains `"` cannot be selected from HQPTuner; today selecting one corrupts the command.
- Copy items 8, 9 and 14 are gathered with Plan 1's request (Plan 1 Notes). Shared with other plans: `.filepawl.toml`, `docs/architecture.md`, `CHANGELOG.md`.
