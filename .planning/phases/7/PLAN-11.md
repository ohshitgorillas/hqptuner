---
phase: 7
plan: 11
requirements: []
files:
  - tests/e2e/support/fit.py
  - tests/e2e/test_auto_plate_fills_real_height.py
  - tests/e2e/test_drawer_popover_shows_whole.py
  - tests/e2e/test_drawers_fit_every_format.py
  - tests/e2e/test_output_format_fill.py
  - tests/e2e/test_output_format_fits.py
  - tests/e2e/test_output_pin_glass_look.py
  - tests/e2e/test_plate_page_scrolls_or_centers.py
  - tests/e2e/test_popovers_fit_every_format.py
  - tests/e2e/test_see_more_popover_bounds.py
  - tests/e2e/test_sheet_top_tracks_plate_line.py
  - tests/e2e/test_views_fit_every_format.py
  - tests/gates/css/test_check_css_cards.py
  - tests/gates/css/test_check_css_tokens.py
  - tests/gates/test_check_field_structure_enumerations.py
  - tests/gates/test_check_lifecycle_names.py
  - tests/gates/test_check_spelling.py
  - tests/gates/test_check_static_clocks.py
  - tests/gates/test_check_store_flags.py
  - tests/gates/test_config_copies_paths.py
  - tests/gates/test_config_copies_xenon.py
  - tests/gates/test_container_env.py
  - tests/gates/test_gates_wired.py
  - tests/gates/testing/test_coverage_floor.py
  - tests/gates/testing/test_suite_time.py
  - tests/support/gate_scripts.py
  - tests/live/test_live_after_write_reads.py
  - tests/live/test_live_apply_split.py
  - tests/live/test_live_batch_refusals.py
  - tests/live/test_live_stop_report.py
  - tests/live/test_live_unloaded_chain_routing.py
  - tests/live/conftest.py
  - tests/matrix/test_profile_backfill.py
  - tests/matrix/test_profile_fanout.py
  - tests/matrix/test_profile_post_process.py
  - tests/matrix/conftest.py
  - tests/presets/narrowing/test_narrowing_lossy.py
  - tests/presets/narrowing/test_narrowing_quality_default.py
  - tests/presets/narrowing/test_narrowing_src_format.py
  - tests/presets/narrowing/test_narrowing_store.py
  - tests/presets/narrowing/test_narrowing_store_modes.py
  - tests/presets/stores/test_description_store.py
  - tests/presets/stores/test_favorites.py
  - tests/presets/stores/test_first_save_name_outcomes.py
  - tests/presets/stores/test_preset_names.py
  - tests/presets/test_backup_persist.py
  - tests/presets/test_description_routes.py
  - tests/presets/test_matrix_mode_routes.py
  - tests/presets/test_settings_archive_flows.py
  - tests/presets/conftest.py
  - tests/support/narrow.py
  - tests/support/fixtures_clients.py
---

# Phase 7: One time base - Plan 11: No duplicated browser, gate, lane and store test rigs

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- `npx jscpd --format python` reports no clone with a side under `tests/e2e/`, `tests/gates/`, `tests/live/`, `tests/matrix/`, `tests/presets/` or `tests/fields/`, except import lists and module docstrings repeated across split test files and type declarations that cannot share a field list.
- Every test in these directories still runs and passes or fails exactly as at commit `503ddec8`, under the same count.

## Context

- D-03 binds this plan, with the clone rules, `docs/spec/testing.md` constraints and gates of Plan 10's Context. Shared helpers go in `tests/support/` (imported bare) or a directory `conftest.py`; a new support module's basename is unique in `tests/`. `filepawl accept` runs whenever filepawl prints it.
- `tests/live/` is the apply lane's live half, offline, not the daemon. `tests/e2e/` drives a browser; its `fit.py` already holds the shared fit preludes.
- Common Verify for every task, over the task's files: (a) `scripts/gate.sh npx jscpd --format python`, then the log: no clone with both sides in the task's files except the stays its Action names; (b) `scripts/gate.sh .venv/bin/pytest -m "not live" -q` over the task's test files (`-m e2e --no-cov` for Task 1) gives the same passed, failed and skipped counts as before the task; (c) `scripts/gate.sh make lint` passes. Testing scope for each: no behavior changes; the suites are their own check; no new test; testing stops there.

## Tasks

### Task 1: The browser suites share their page scripts and settle wait

- **Files:** tests/e2e/support/fit.py, tests/e2e/test_auto_plate_fills_real_height.py, tests/e2e/test_drawer_popover_shows_whole.py, tests/e2e/test_drawers_fit_every_format.py, tests/e2e/test_output_format_fill.py, tests/e2e/test_output_format_fits.py, tests/e2e/test_output_pin_glass_look.py, tests/e2e/test_plate_page_scrolls_or_centers.py, tests/e2e/test_popovers_fit_every_format.py, tests/e2e/test_see_more_popover_bounds.py, tests/e2e/test_sheet_top_tracks_plate_line.py, tests/e2e/test_views_fit_every_format.py
- **Reads:** tests/e2e/support/fit.py, tests/e2e/test_output_format_fill.py
- **Decisions:** D-03
- **Action:** Clones removed: fit~output_format_fits, the gap-below page script (auto_plate_fills_real_height~plate_page_scrolls_or_centers), the popover bounds script (drawer_popover_shows_whole~see_more_popover_bounds), the open-drawer script (drawers_fit_every_format~popovers_fit_every_format and its self-clone), the settle wait and its ceiling (output_format_fill against output_format_fits, output_pin_glass_look and sheet_top_tracks_plate_line), the Output drawer layout step (output_format_fill~output_format_fits), the context selector (popovers_fit_every_format~views_fit_every_format). Shared code goes in `fit.py`. Expected to stay: auto_plate_fills_real_height~plate_page_scrolls_or_centers lines 20-31, a module docstring.
- **Verify:** The plan's common Verify, with (b) as `scripts/gate.sh make test-e2e` where the host can launch the browser (name its footprint first, `~/dev/CLAUDE.md` 3.1), or else the required `e2e` job passing on this commit.

### Task 2: The gate suites share their fixture layers and script loaders

- **Files:** tests/gates/css/test_check_css_cards.py, tests/gates/css/test_check_css_tokens.py, tests/gates/test_check_field_structure_enumerations.py, tests/gates/test_check_lifecycle_names.py, tests/gates/test_check_spelling.py, tests/gates/test_check_static_clocks.py, tests/gates/test_check_store_flags.py, tests/gates/test_config_copies_paths.py, tests/gates/test_config_copies_xenon.py, tests/gates/test_container_env.py, tests/gates/test_gates_wired.py, tests/gates/testing/test_coverage_floor.py, tests/gates/testing/test_suite_time.py, tests/support/gate_scripts.py
- **Reads:** tests/gates/test_check_field_structure_enumerations.py#lay, tests/gates/test_check_spelling.py#tracked, tests/gates/test_config_copies_paths.py
- **Decisions:** D-03
- **Action:** Clones removed: the stylesheet writer (css_cards~css_tokens), the `lay` fixture layer and its loop case (field_structure_enumerations against lifecycle_names twice, store_flags twice, static_clocks), the `tracked` file writer (spelling~static_clocks), the `importlib` gate-script loader (config_copies_paths against config_copies_xenon, gates_wired, coverage_floor and suite_time), the `test_container_env.py` self-clone unless on reading it is a dataclass declaration that cannot share its fields. Shared code goes in `tests/support/gate_scripts.py` (planner's name). Expected to stay: field_structure_enumerations against lifecycle_names and store_flags lines 13-27, a module docstring.
- **Verify:** The plan's common Verify over this task's files.

### Task 3: The live-lane suites share their hooks and modes

- **Files:** tests/live/test_live_after_write_reads.py, tests/live/test_live_apply_split.py, tests/live/test_live_batch_refusals.py, tests/live/test_live_stop_report.py, tests/live/test_live_unloaded_chain_routing.py, tests/live/conftest.py
- **Reads:** tests/live/test_live_apply_split.py, tests/live/test_live_unloaded_chain_routing.py
- **Decisions:** D-03
- **Action:** Clones removed: the command hooks rig (after_write_reads~stop_report), the mode tables (apply_split~unloaded_chain_routing), batch_refusals~unloaded_chain_routing unless on reading it is an import list only.
- **Verify:** The plan's common Verify over this task's files.

### Task 4: The matrix profile suites share their readers

- **Files:** tests/matrix/test_profile_backfill.py, tests/matrix/test_profile_fanout.py, tests/matrix/test_profile_post_process.py, tests/matrix/conftest.py
- **Reads:** tests/matrix/test_profile_post_process.py, tests/matrix/test_profile_fanout.py
- **Decisions:** D-03
- **Action:** Clones removed: `running_profiles` (profile_backfill~profile_post_process), the byte-identical snapshot check helper (profile_fanout~profile_post_process), the `profile_fanout.py` self-clone (near-identical tests folded into one parametrized case, every case kept).
- **Verify:** The plan's common Verify over this task's files.

### Task 5: The preset store suites share their store builders

- **Files:** tests/presets/narrowing/test_narrowing_lossy.py, tests/presets/narrowing/test_narrowing_quality_default.py, tests/presets/narrowing/test_narrowing_src_format.py, tests/presets/narrowing/test_narrowing_store.py, tests/presets/narrowing/test_narrowing_store_modes.py, tests/presets/stores/test_description_store.py, tests/presets/stores/test_favorites.py, tests/presets/stores/test_first_save_name_outcomes.py, tests/presets/stores/test_preset_names.py, tests/presets/test_backup_persist.py, tests/presets/test_description_routes.py, tests/presets/test_matrix_mode_routes.py, tests/presets/test_settings_archive_flows.py, tests/presets/conftest.py, tests/support/narrow.py, tests/support/fixtures_clients.py
- **Reads:** tests/support/narrow.py, tests/presets/narrowing/test_narrowing_quality_default.py#store_at, tests/presets/narrowing/test_narrowing_store.py
- **Decisions:** D-03
- **Action:** Clones removed: the facets fixture (narrowing_lossy~narrowing_src_format), `store_at` and `stored` (narrowing_quality_default against narrowing_store_modes and narrowing_store), the stamped app client (narrowing_store against favorites and matrix_mode_routes), the description `seed` (description_store~description_routes, the second pair), the live preset store builder (first_save_name_outcomes~preset_names), the engine apply rig (backup_persist~settings_archive_flows). Expected to stay as import lists or module docstrings across split test files: field_at_location~field_kept_at_codec, narrowing_quality_default~narrowing_store_modes lines 15-20, description_store~description_routes lines 11-16, store_first_save~store_read_recovers.
- **Verify:** The plan's common Verify over this task's files and `tests/fields/`.
