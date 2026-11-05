# Phase 2 baseline: failure routes

Baseline: `rebuild/integrate` at `082346ffcc11303f511bbade18aa6b0f9367370b`, 195 failing tests in 53 files of 4904 (`base.txt`, `files.txt`, `failures.log`). Every path under `tests/js/` or `hqptuner/static/` is relative to `.claude/worktrees/integrate`.

Each failing test has one entry: file and title, the decisive failing line from the log, one route and the cause it cites. A cause is evidence shared by the entries that cite it; no entry carries two routes. Routes: `repair` (wrong test machinery, claims and asserts unchanged), `builder` (a valid claim the production code fails, with the `hqptuner/static/` path the failing line implicates), `contract-mismatch` (the assertion and the approved behavior disagree; both quotations, or `unresolved` with the owner question).

## Causes

- **R1** (repair): The test renders `<Header />` with no `panel` prop. The built `Header` takes `{ panel }` (`hqptuner/static/components/faceplate/Header.js:211`) and the knob tap calls `panel.openPanel()` (`Header.js:82`). Wrong test machinery: the claim and the assert stay.
- **R2** (repair): The test seeds field values (including a `file` half or `rows`) through `config.value` / `matrixConfig.value`. Production reads a value only from `readings.value.fields` through `field()` (`hqptuner/static/store/core/readings.js:61-62`), so the seeded value never reaches the control and the read comes back empty. Wrong test machinery: the values go through `seedReadings`, the claim and the assert stay.
- **R3** (repair): The test sets `active`, `live_active` or `live_profiles` in the form signals. Production reads the loaded station from `activePreset`, the `active_preset` reading (`hqptuner/static/store/resolve.js:73-76`), and the running matrix profile from `field("matrix_profile")` (`hqptuner/static/store/matrix/profiles.js:32`); no production line reads the `active` or `live_*` keys. Wrong test machinery: the loaded station and profile go through `seedReadings`, the claim and the assert stay.
- **R4** (repair): The mark, dot or restart tab asserted comes from `field(key).value.restart` (`hqptuner/static/store/faceplate/drawer.js:175,184-186`), which is the served `restarts` of the field's reading. The test seeds no reading carrying `restarts: true` (it seeds a form value, or nothing). Wrong test machinery: the restart-class reading is seeded through `seedReadings` / `fieldReading`, the claim and the assert stay.
- **R5** (repair): The test setup assigns `speakers.value`, a `computed` over `speakerForm.base` (`hqptuner/static/store/matrix/speakers.js:50`), which has only a getter. Wrong test machinery: the speakers form is loaded through `loadSpeakers()` over the wire, the claim and the assert stay.
- **R6** (repair): The test sets the `applying` / `engineBusy` signals directly. The built `connState` reads `inFlight` (`hqptuner/static/store/faceplate/conn.js:15`, `hqptuner/static/store/core/ops.js:123`), the count of running engine operations, which a direct write to `applyOp.busy` or `engineBusy` never moves. Wrong test machinery: the in-flight state is produced by running an engine operation, the claim and the assert stay.
- **R7** (repair): The test sets `health.value = { ready: true }` (or `{ reachable, ready, info }`). The built transport reads `phase.value !== "Ready"` (`hqptuner/static/store/faceplate/path.js:61`), so the rail never reads playing and its lamp and value stay off. Wrong test machinery: the health reading carries `phase: "Ready"`, the claim and the assert stay.
- **R8** (repair): The test seeds the pipeline set or the matrix rows through `config.value.file.matrix_pipelines` or `matrixConfig.value.rows`. Production reads the set from `field("matrix_pipelines")` (`hqptuner/static/store/resolve.js:66-71`). Wrong test machinery: the rows go through `seedReadings`, the claim and the assert stay.
- **R9** (repair): The test seeds the `file` half through `config.value` and its live wire fake answers `/api/config` in the same retired payload; production adopts the body of that answer as `readings.value` (`hqptuner/static/store/core/readings.js:136`). Wrong test machinery: the seed and the wire answer carry served readings, the claim and the assert stay.
- **R10a** (repair): Shared helper `tests/js/support/rendered/pipelines-fixture.js`: its `loadPipelines` seeds `matrix_pipelines` as a reading without `restarts: true`, and a dotted tab needs `restartLane(k) && isDirty(k)` (`hqptuner/static/store/faceplate/drawer.js:184-186`). Checked in a scratch copy outside the repo: with `restarts: true` on that one reading, `drawers-pipelines-schema.test.js` and `drawers-pipelines.test.js` pass 7 of 7, asserts untouched.
- **R10b** (repair): Shared helper `tests/js/support/easy/easytiles.js` (`resetLive`, with `configPayload` in `easy/easyrate.js`): it assigns `mode`, `backend` and the `any_dsd` switches in the `file` half of `config.value`, and none reaches `readings.value`, so the narrowing sees no backend. Checked in a scratch copy outside the repo: seeding those four as file-store readings after `discardAll()` makes `store/faceplate-page/presets.test.js`, `components/faceplate-page/presets.test.js`, `store/easy/*.test.js` and `components/matrix/library-clear.test.js` pass 377 of 377, asserts untouched.
- **B1** (builder): Valid claim: a modulator or ditherer below its rate floor raises the shaper-fit alert (`docs/spec/api.md` line 35: the engine reading's `value` is the list index, its `name` the engine name, and clients "compare no Engine indices with File enum IDs"). `shaperName` in `hqptuner/static/store/alerts/shaperfit.js` matches the shown value, an engine list index on the loaded chain, against the config form's enum IDs, so the name comes back empty and `conflict()` returns null. The shaper-fit fixtures serve the loaded chain as the spec shapes it. Checked in a scratch copy outside the repo: taking the name from the served reading first makes `store/faceplate-alerts/alerts.test.js`, `store/guards/shaperfit-alerts.test.js`, `components/faceplate-alerts/rail.test.js` and the two staged-auto cases of `shaperfit-mode-gate.test.js` pass with tests untouched.
- **C1** (contract-mismatch): unresolved. The test premise is that a previewed preset's saved values become what the editor shows (`previewConfig`). Production still writes `previewConfig` (`hqptuner/static/store/actions.js:188`) and reads it nowhere: the grounding was removed with `previewedValue` from `resolve.js` in commit `38b7e28e`, and `docs/spec/faceplate.md` and `docs/spec/api.md` state no such behavior. Owner question Q1: does a previewed preset still change the values a control shows before Apply? If yes, the route becomes builder (read `previewConfig` in `store/core/readings.js` `field`); if no, the claims are retired and `previewConfig` is dead production.
- **C2** (contract-mismatch): unresolved. The test premise is that a catalog row of a daemon form outside `/api/config` (`multicore`, `ecores`, `cuda`, the speakers switch `spken`) shows the form's value with the drawer's draft over it. `hqptuner/static/store/schema/hardware.js` and `schema/speakers.js` say so in their headers, and `docs/spec/faceplate.md` line 70 says a switch is lit on the value its owner holds, but a control's value is only `field(key).value.value` (`hqptuner/static/store/faceplate/drawer/control.js:164`), which reads `readings.value.fields` and never `hardwareDraft()` or `speakers`. Owner question Q2: do these rows read their form through `field()` (a builder fix in `store/core/readings.js`) or through the form's own store (the tests then read it the same way)?

## Helper section

- `tests/js/support/shaperfit-fixtures.js` (8 importers): blamed for no failure. Its `reset` already strips values from the form signal and seeds through one `seedReadings`, and serves the loaded chain as `docs/spec/api.md` shapes it. Importer failures: 15 are builder (B1, production `hqptuner/static/store/alerts/shaperfit.js`), 3 are contract-mismatch (C1, the preview cases of `store/guards/shaperfit-mode-gate.test.js`); none is a repair of the fixture. Plan 1 Task 6 makes no change.
- `tests/js/support/rendered/pipelines-fixture.js` (2 importers): blamed for 1 failure, `components/faceplate-drawers/drawers-pipelines-schema.test.js:62` (cause R10a). The other importer, `drawers-pipelines.test.js`, passes at baseline.
- `tests/js/support/easy/easytiles.js` and `easy/easyrate.js` (4 importers, 6 files run): blamed for 1 failure, `store/faceplate-page/presets.test.js:254` (cause R10b). The other importers pass at baseline.
- `tests/js/support/field-harness.js` (6 importers): blamed for no failure; all six importers pass at baseline. Plan 1 Task 3 is an INTG-02 seed migration with no failure to cure.
- `tests/js/support/profile-fixtures.js` (8 importers): blamed for no failure; all eight importers pass at baseline. Plan 1 Task 4 is an INTG-02 seed migration with no failure to cure.

## Entries

### tests/js/components/faceplate-alerts/header.test.js

- `test_tapping_the_knob_opens_one_line_per_alert_homed_on_it` (tests/js/components/faceplate-alerts/header.test.js:116). Decisive: `"Cannot read properties of undefined (reading 'openPanel')"`. Route: repair. Cause: R1.
- `test_the_knobs_first_line_carries_its_alerts_severity` (tests/js/components/faceplate-alerts/header.test.js:123). Decisive: `"Cannot read properties of undefined (reading 'openPanel')"`. Route: repair. Cause: R1.

### tests/js/components/faceplate-alerts/rail.test.js

- `test_a_modulator_below_its_floor_blinks_the_shaping_stage_red` (tests/js/components/faceplate-alerts/rail.test.js:100). Decisive: `Expected values to be strictly equal:+ undefined - 'crit' `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.

### tests/js/components/faceplate-alerts/xref.test.js

- `test_the_fixed_volume_reason_on_the_gain_tab_links_the_level_tab` (tests/js/components/faceplate-alerts/xref.test.js:135). Decisive: `Expected values to be strictly equal:+ 'volume-range' - 'volume-level' ^ `. Route: repair. Cause: R2.
- `test_the_fixed_volume_reason_on_the_range_tab_links_the_level_tab` (tests/js/components/faceplate-alerts/xref.test.js:140). Decisive: `Expected values to be strictly equal:+ undefined - 'volume-level' `. Route: repair. Cause: R2.

### tests/js/components/faceplate-builders/rail.test.js

- `test_only_the_loaded_station_folds_current` (tests/js/components/faceplate-builders/rail.test.js:199). Decisive: `Expected values to be strictly deep-equal:[ +   true, false, -   true ] `. Route: repair. Cause: R3.

### tests/js/components/faceplate-builders/rows.test.js

- `test_the_take_button_is_disabled_unless_the_row_can_take` (tests/js/components/faceplate-builders/rows.test.js:303). Decisive: `Expected values to be strictly deep-equal:{ '1x': false, adaptive: false, +   mode: false, -   mode: true, nx: true, profile: true, sh: false } `. Route: repair. Cause: R3.
- `test_the_profile_rows_live_cell_names_the_engines_active_profile` (tests/js/components/faceplate-builders/rows.test.js:348). Decisive: `The input did not match the regular expression /Room EQ/. Input:  '[Default]' `. Route: repair. Cause: R3.

### tests/js/components/faceplate-drawers-output/drawers-output-dsdrow.test.js

- `test_picking_an_option_on_the_dsd_rates_control_stages_dsd_rates_only` (tests/js/components/faceplate-drawers-output/drawers-output-dsdrow.test.js:180). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'net_anydsd' - ] `. Route: repair. Cause: R2.

### tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js

- `test_under_auto_the_rate_row_carries_the_restart_mark` (tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js:352). Decisive: `Expected values to be strictly deep-equal:  false !== true `. Route: repair. Cause: R4.
- `test_picking_auto_after_a_family_puts_the_restart_mark_back_on_the_rate_row` (tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js:357). Decisive: `Expected values to be strictly deep-equal:  false !== true `. Route: repair. Cause: R4.
- `test_turning_allow_pinned_rates_off_puts_the_restart_mark_back_on_the_rate_row` (tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js:363). Decisive: `Expected values to be strictly deep-equal:  false !== true `. Route: repair. Cause: R4.

### tests/js/components/faceplate-drawers/drawers-fft-catalog.test.js

- `test_a_bare_fft_length_row_shows_only_on_the_tab_whose_nx_filter_is_fft_family` (tests/js/components/faceplate-drawers/drawers-fft-catalog.test.js:99). Decisive: `Expected values to be strictly deep-equal:[ false, +   false -   true ] `. Route: repair. Cause: R2.
- `test_a_bare_fft_length_row_shows_only_on_the_tab_whose_1x_filter_is_fft_family` (tests/js/components/faceplate-drawers/drawers-fft-catalog.test.js:104). Decisive: `Expected values to be strictly deep-equal:[ -   true, false, +   false ] `. Route: repair. Cause: R2.

### tests/js/components/faceplate-drawers/drawers-hf-schema.test.js

- `test_staging_pre_process_before_metering_dots_the_title` (tests/js/components/faceplate-drawers/drawers-hf-schema.test.js:93). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.

### tests/js/components/faceplate-drawers/drawers-loudness.test.js

- `test_staging_the_low_bound_leaves_the_high_box_on_the_high_bound` (tests/js/components/faceplate-drawers/drawers-loudness.test.js:125). Decisive: `Expected values to be strictly equal:  '0' !== '-20' `. Route: repair. Cause: R2.
- `test_the_loudness_low_level_row_carries_the_restart_mark_before_any_edit` (tests/js/components/faceplate-drawers/drawers-loudness.test.js:168). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.
- `test_the_loudness_low_freq_row_carries_the_restart_mark_before_any_edit` (tests/js/components/faceplate-drawers/drawers-loudness.test.js:168). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.
- `test_the_loudness_low_steep_row_carries_the_restart_mark_before_any_edit` (tests/js/components/faceplate-drawers/drawers-loudness.test.js:168). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.
- `test_the_loudness_low_type_row_carries_the_restart_mark_before_any_edit` (tests/js/components/faceplate-drawers/drawers-loudness.test.js:168). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.
- `test_the_bounds_block_carries_the_restart_mark_on_its_header_before_any_edit` (tests/js/components/faceplate-drawers/drawers-loudness.test.js:173). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.
- `test_only_the_band_rows_and_the_bounds_header_carry_the_restart_mark` (tests/js/components/faceplate-drawers/drawers-loudness.test.js:177). Decisive: `Expected values to be strictly equal:  0 !== 5 `. Route: repair. Cause: R4.

### tests/js/components/faceplate-drawers/drawers-matrix-schema.test.js

- `test_a_staged_matrix_gate_dots_the_basic_tab` (tests/js/components/faceplate-drawers/drawers-matrix-schema.test.js:94). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'basic' - ] `. Route: repair. Cause: R4.
- `test_a_staged_iir_to_fir_dots_the_advanced_tab` (tests/js/components/faceplate-drawers/drawers-matrix-schema.test.js:99). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'advanced' - ] `. Route: repair. Cause: R4.
- `test_a_staged_dac_model_dots_the_dac_correction_title` (tests/js/components/faceplate-drawers/drawers-matrix-schema.test.js:110). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.

### tests/js/components/faceplate-drawers/drawers-modes-schema.test.js

- `test_the_fft_length_row_shows_on_the_tab_whose_filter_is_fft_family` (tests/js/components/faceplate-drawers/drawers-modes-schema.test.js:128). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.
- `test_a_staged_dsd_source_gain_dots_the_pcm_tab_of_dsd_processing` (tests/js/components/faceplate-drawers/drawers-modes-schema.test.js:164). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'pcm' - ] `. Route: repair. Cause: R4.
- `test_a_staged_rate_conversion_dots_the_sdm_tab_of_resampling` (tests/js/components/faceplate-drawers/drawers-modes-schema.test.js:169). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'sdm' - ] `. Route: repair. Cause: R4.
- `test_shapings_pcm_tab_notes_the_dac_bits_the_output_holds` (tests/js/components/faceplate-drawers/drawers-modes-schema.test.js:190). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.

### tests/js/components/faceplate-drawers/drawers-pipelines-schema.test.js

- `test_a_staged_pipeline_set_dots_the_tab_it_shows` (tests/js/components/faceplate-drawers/drawers-pipelines-schema.test.js:62). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R10a.

### tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js

- `test_the_switch_row_lights_the_daemons_switch_while_nothing_is_drafted` (tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js:124). Decisive: `Expected values to be strictly deep-equal:[ +   '0' -   '1' ] `. Route: contract-mismatch. Cause: C2. Unresolved, owner question Q2 (see C2).

### tests/js/components/faceplate-settings/about-state-import-stores.test.js

- `test_a_station_looked_at_after_an_import_takes_the_matrix_mode_the_import_recorded` (tests/js/components/faceplate-settings/about-state-import-stores.test.js:223). Decisive: `Expected values to be strictly equal:+ 'speakers' - 'headphones' `. Route: repair. Cause: R3.

### tests/js/components/faceplate-settings/engine-rows.test.js

- `test_a_readout_prints_the_label_of_the_running_option` (tests/js/components/faceplate-settings/engine-rows.test.js:133). Decisive: `Expected values to be strictly equal:  'null' !== '10' `. Route: repair. Cause: R2.
- `test_a_readout_holds_the_running_option_while_an_edit_is_staged` (tests/js/components/faceplate-settings/engine-rows.test.js:138). Decisive: `Expected values to be strictly equal:  'null' !== 'Default' `. Route: repair. Cause: R2.
- `test_a_checkbox_readout_reads_its_running_true_as_the_on_option_value` (tests/js/components/faceplate-settings/engine-rows.test.js:147). Decisive: `Expected values to be strictly equal:  '0' !== '1' `. Route: repair. Cause: R2.

### tests/js/components/faceplate-settings/hardware.test.js

- `test_the_unedited_multicore_head_carries_the_restart_mark` (tests/js/components/faceplate-settings/hardware.test.js:201). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.
- `test_the_unedited_ecores_head_carries_the_restart_mark` (tests/js/components/faceplate-settings/hardware.test.js:201). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.
- `test_the_unedited_cuda_head_carries_the_restart_mark` (tests/js/components/faceplate-settings/hardware.test.js:201). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.

### tests/js/components/faceplate-settings/logging.test.js

- `test_the_log_path_readout_prints_the_running_path_not_a_staged_one` (tests/js/components/faceplate-settings/logging.test.js:92). Decisive: `Expected values to be strictly equal:+ '' - '/var/log/hqplayerd-running.log' `. Route: repair. Cause: R2.

### tests/js/components/faceplate/header.test.js

- `test_the_knob_reads_busy_while_an_apply_is_in_flight` (tests/js/components/faceplate/header.test.js:153). Decisive: `Expected values to be strictly equal:  'lost' !== 'busy' `. Route: repair. Cause: R6.
- `test_tapping_the_knob_with_no_alert_opens_the_connection_settings` (tests/js/components/faceplate/header.test.js:158). Decisive: `"Cannot read properties of undefined (reading 'openPanel')"`. Route: repair. Cause: R1.
- `test_the_tree_trigger_names_the_loaded_station_alone` (tests/js/components/faceplate/header.test.js:163). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'Night' - ] `. Route: repair. Cause: R3.
- `test_tapping_a_snapshot_under_the_loaded_station_applies_it` (tests/js/components/faceplate/header.test.js:180). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   '/api/livepresets/Warm/apply' - ] `. Route: repair. Cause: R3.
- `test_only_the_loaded_station_snapshots_are_buttons` (tests/js/components/faceplate/header.test.js:193). Decisive: `Expected values to be strictly deep-equal:[ [ +     false -     true ], [ false ] ] `. Route: repair. Cause: R3.
- `test_with_day_loaded_only_night_carries_the_restart_mark` (tests/js/components/faceplate/header.test.js:301). Decisive: `Expected values to be strictly deep-equal:[ -   false, true, +   true ] `. Route: repair. Cause: R3.
- `test_with_night_loaded_only_day_carries_the_restart_mark` (tests/js/components/faceplate/header.test.js:306). Decisive: `Expected values to be strictly deep-equal:[ true, +   true -   false ] `. Route: repair. Cause: R3.

### tests/js/components/faceplate/page.test.js

- `test_the_page_shows_a_section_per_engaged_stage` (tests/js/components/faceplate/page.test.js:124). Decisive: `Expected values to be strictly deep-equal:[ 'source', -   'matrix', 'resampling', 'shaping' ] `. Route: repair. Cause: R2.
- `test_a_folded_matrix_section_has_no_body` (tests/js/components/faceplate/page.test.js:132). Decisive: `Expected values to be strictly equal:+ 'no matrix section' - 0 `. Route: repair. Cause: R2.
- `test_an_unfolded_matrix_section_has_its_body` (tests/js/components/faceplate/page.test.js:136). Decisive: `Expected values to be strictly equal:+ 'no matrix section' - 1 `. Route: repair. Cause: R2.
- `test_a_folded_matrix_section_carries_the_profile_select_on_its_header_line` (tests/js/components/faceplate/page.test.js:181). Decisive: `Expected values to be strictly equal:+ 'no matrix section' - true `. Route: repair. Cause: R2.
- `test_an_unfolded_matrix_section_keeps_the_profile_select_in_its_body` (tests/js/components/faceplate/page.test.js:188). Decisive: `Expected values to be strictly equal:+ 'no matrix section' - false `. Route: repair. Cause: R2.

### tests/js/components/faceplate/rail-staged.test.js

- `test_a_staged_edit_in_the_matrix_drawer_marks_its_stage_and_no_other_family_member` (tests/js/components/faceplate/rail-staged.test.js:155). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/components/faceplate/rail-staged.test.js` line 130.
- `test_a_staged_edit_in_the_correction_drawer_marks_its_stage_and_no_other_family_member` (tests/js/components/faceplate/rail-staged.test.js:155). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/components/faceplate/rail-staged.test.js` line 130.
- `test_a_staged_edit_in_the_pipelines_drawer_marks_its_stage_and_no_other_family_member` (tests/js/components/faceplate/rail-staged.test.js:155). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/components/faceplate/rail-staged.test.js` line 130.
- `test_a_staged_structural_crossfeed_install_marks_the_crossfeed_and_dsp_pipelines_stages_and_no_other` (tests/js/components/faceplate/rail-staged.test.js:162). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/components/faceplate/rail-staged.test.js` line 130.
- `test_a_staged_change_to_the_bauer_compensation_marks_the_crossfeed_and_dsp_pipelines_stages_and_no_other` (tests/js/components/faceplate/rail-staged.test.js:169). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/components/faceplate/rail-staged.test.js` line 130.
- `test_an_iir_to_fir_edit_marks_the_matrix_engine_stage_and_not_crossfeed` (tests/js/components/faceplate/rail-staged.test.js:178). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/components/faceplate/rail-staged.test.js` line 130.
- `test_an_edit_held_in_the_speakers_form_marks_the_speakers_stage` (tests/js/components/faceplate/rail-staged.test.js:184). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/components/faceplate/rail-staged.test.js` line 130.

### tests/js/components/faceplate/rail.test.js

- `test_a_running_hf_filter_lights_its_lamp` (tests/js/components/faceplate/rail.test.js:116). Decisive: `The expression evaluated to a falsy value:  assert.ok(classes(partOf("hf", "lamp")).includes("on")) `. Route: repair. Cause: R7.
- `test_a_stage_shows_its_value` (tests/js/components/faceplate/rail.test.js:125). Decisive: `Expected values to be strictly equal:  '' !== '30k' `. Route: repair. Cause: R7.

### tests/js/components/faceplate/volume.test.js

- `test_a_pinned_level_disables_the_step_down` (tests/js/components/faceplate/volume.test.js:179). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.
- `test_a_pinned_level_disables_the_step_up` (tests/js/components/faceplate/volume.test.js:183). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.
- `test_a_pinned_level_disables_the_readout` (tests/js/components/faceplate/volume.test.js:192). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.
- `test_a_pinned_level_disables_the_slider` (tests/js/components/faceplate/volume.test.js:240). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.
- `test_the_loudness_strip_spans_its_bounds_along_the_range` (tests/js/components/faceplate/volume.test.js:249). Decisive: `Expected values to be strictly deep-equal:[ +   NaN, +   NaN -   25, -   50 ] `. Route: repair. Cause: R2.

### tests/js/store/faceplate-alerts/alerts.test.js

- `test_a_modulator_below_its_floor_raises_the_shaper_sdm_kind` (tests/js/store/faceplate-alerts/alerts.test.js:138). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'shaperSdm' - ] `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.
- `test_a_modulator_below_its_floor_names_the_sdm_chain` (tests/js/store/faceplate-alerts/alerts.test.js:143). Decisive: `Expected values to be strictly equal:  undefined !== 'sdm' `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.
- `test_a_ditherer_below_its_floor_raises_the_shaper_pcm_kind` (tests/js/store/faceplate-alerts/alerts.test.js:148). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'shaperPcm' - ] `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.
- `test_a_ditherer_below_its_floor_names_the_pcm_chain` (tests/js/store/faceplate-alerts/alerts.test.js:153). Decisive: `Expected values to be strictly equal:  undefined !== 'pcm' `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.
- `test_a_ditherer_below_its_floor_pins_its_line_on_the_shaping_section` (tests/js/store/faceplate-alerts/alerts.test.js:211). Decisive: `Expected values to be strictly deep-equal:+ undefined - [ -   'shaperPcm' - ] `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.
- `test_a_modulator_below_its_floor_darkens_exactly_the_stages_after_shaping_in_rail_order` (tests/js/store/faceplate-alerts/alerts.test.js:219). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'output' - ] `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.

### tests/js/store/faceplate-builders/snapshot.test.js

- `test_live_mode_reads_the_config_forms_pcm` (tests/js/store/faceplate-builders/snapshot.test.js:265). Decisive: `Expected values to be strictly equal:  '' !== 'pcm' `. Route: repair. Cause: R2.
- `test_live_mode_reads_the_config_forms_auto` (tests/js/store/faceplate-builders/snapshot.test.js:269). Decisive: `Expected values to be strictly equal:  '' !== 'auto' `. Route: repair. Cause: R2.
- `test_the_dormant_chains_modulator_reads_the_config_form` (tests/js/store/faceplate-builders/snapshot.test.js:292). Decisive: `Expected values to be strictly equal:  '' !== '4' `. Route: repair. Cause: R2.
- `test_live_profile_reads_the_engines_named_matrix_profile` (tests/js/store/faceplate-builders/snapshot.test.js:305). Decisive: `Expected values to be strictly equal:  '' !== 'Room EQ' `. Route: repair. Cause: R3.
- `test_home_is_the_loaded_headphones` (tests/js/store/faceplate-builders/snapshot.test.js:329). Decisive: `Expected values to be strictly equal:+ 'Speakers' - 'Headphones' `. Route: repair. Cause: R3.
- `test_the_loaded_station_folds_as_loaded` (tests/js/store/faceplate-builders/snapshot.test.js:545). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R3.

### tests/js/store/faceplate-page/presets.test.js

- `test_a_preset_reaching_only_2x_filters_at_the_441_base_has_no_row` (tests/js/store/faceplate-page/presets.test.js:254). Decisive: `Expected values to be strictly deep-equal:[ 'damage-control', 'full-analog', 'lifelike', +   'lifelike>concert-hall', 'lifelike>crucible', 'old-school', 'perfect-ten', + `. Route: repair. Cause: R10b.

### tests/js/store/faceplate/conn.test.js

- `test_an_apply_in_flight_reads_busy` (tests/js/store/faceplate/conn.test.js:40). Decisive: `Expected values to be strictly equal:  'ok' !== 'busy' `. Route: repair. Cause: R6.
- `test_an_engine_write_started_elsewhere_reads_busy` (tests/js/store/faceplate/conn.test.js:45). Decisive: `Expected values to be strictly equal:  'ok' !== 'busy' `. Route: repair. Cause: R6.
- `test_an_apply_while_the_engine_is_down_reads_busy` (tests/js/store/faceplate/conn.test.js:50). Decisive: `Expected values to be strictly equal:  'lost' !== 'busy' `. Route: repair. Cause: R6.

### tests/js/store/faceplate/drawer-grammar.test.js

- `test_a_staged_key_a_block_names_marks_the_blocks_tab` (tests/js/store/faceplate/drawer-grammar.test.js:114). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'a' - ] `. Route: repair. Cause: R4.
- `test_a_block_naming_a_restart_key_makes_its_tab_a_restart_tab` (tests/js/store/faceplate/drawer-grammar.test.js:119). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.
- `test_a_staged_choice_detail_key_marks_the_choices_tab` (tests/js/store/faceplate/drawer-grammar.test.js:123). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'a' - ] `. Route: repair. Cause: R4.
- `test_a_staged_group_row_marks_the_groups_tab` (tests/js/store/faceplate/drawer-grammar.test.js:128). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'a' - ] `. Route: repair. Cause: R4.
- `test_a_restart_row_kept_in_by_when_makes_its_tab_a_restart_tab` (tests/js/store/faceplate/drawer-grammar.test.js:134). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.

### tests/js/store/faceplate/drawer-save-restart.test.js

- `test_apply_and_save_of_a_change_that_restarts_the_engine_dims_the_page` (tests/js/store/faceplate/drawer-save-restart.test.js:89). Decisive: `'[false]'`. Route: repair. Cause: R4.

### tests/js/store/faceplate/drawer.test.js

- `test_an_edit_to_a_restart_row_marks_its_tab_and_live_row_edits_mark_none` (tests/js/store/faceplate/drawer.test.js:119). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'range' - ] `. Route: repair. Cause: R4.
- `test_the_dot_goes_on_the_title_of_a_one_tab_drawer` (tests/js/store/faceplate/drawer.test.js:126). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.
- `test_the_apply_group_shows_on_a_restart_tab_with_nothing_staged` (tests/js/store/faceplate/drawer.test.js:132). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R4.
- `test_the_save_mode_saves_into_the_loaded_station` (tests/js/store/faceplate/drawer.test.js:215). Decisive: `Expected values to be strictly deep-equal:[ +   null -   'Living room' ] `. Route: repair. Cause: R3.
- `test_the_save_mode_sends_nothing_with_no_loaded_station` (tests/js/store/faceplate/drawer.test.js:225). Decisive: `Expected values to be strictly equal:  2 !== 1 `. Route: repair. Cause: R3.

### tests/js/store/faceplate/drawers-modes.test.js

- `test_the_dither_line_names_the_dac_bits_of_the_alsa_backend` (tests/js/store/faceplate/drawers-modes.test.js:76). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.
- `test_the_dither_line_names_the_dac_bits_of_the_network_backend` (tests/js/store/faceplate/drawers-modes.test.js:82). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.
- `test_the_dither_line_names_staged_dac_bits` (tests/js/store/faceplate/drawers-modes.test.js:96). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.

### tests/js/store/faceplate/drawers-source/drawers-source.test.js

- `test_a_quiet_dsd_source_with_the_matrix_engaged_shows_the_silent_line` (tests/js/store/faceplate/drawers-source/drawers-source.test.js:122). Decisive: `Expected values to be strictly equal:  'matrix' !== 'silent' `. Route: repair. Cause: R2.

### tests/js/store/faceplate/drawers-speakers.test.js

- `test_the_levels_are_dead_while_the_running_direct_sdm_is_on` (tests/js/store/faceplate/drawers-speakers.test.js:322). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.

### tests/js/store/faceplate/loadpreset.test.js

- `test_loading_the_preset_already_loaded_sends_no_apply` (tests/js/store/faceplate/loadpreset.test.js:73). Decisive: `Expected values to be strictly equal:  1 !== 0 `. Route: repair. Cause: R3.

### tests/js/store/faceplate/path.test.js

- `test_a_dsd_source_to_a_dsd_rate_with_direct_sdm_running_takes_its_path` (tests/js/store/faceplate/path.test.js:73). Decisive: `Expected values to be strictly equal:+ 'sdm-sdm' - 'direct' `. Route: repair. Cause: R2.

### tests/js/store/faceplate/rail-now.test.js

- `test_the_hf_filter_is_the_junk_filter_named_at_the_index_the_engine_reports` (tests/js/store/faceplate/rail-now.test.js:88). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.
- `test_the_hf_filter_follows_the_index_the_engine_reports` (tests/js/store/faceplate/rail-now.test.js:92). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.
- `test_the_nx_filter_is_the_filter_named_at_the_index_the_engine_reports` (tests/js/store/faceplate/rail-now.test.js:97). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.
- `test_the_shaper_is_the_shaper_named_at_the_index_the_engine_reports` (tests/js/store/faceplate/rail-now.test.js:101). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.
- `test_the_noise_filter_is_the_running_option_by_its_label` (tests/js/store/faceplate/rail-now.test.js:106). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.
- `test_the_dac_model_is_the_running_option_by_its_label` (tests/js/store/faceplate/rail-now.test.js:110). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.
- `test_a_staged_matrix_bypass_leaves_the_running_engine_on` (tests/js/store/faceplate/rail-now.test.js:114). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.
- `test_a_staged_crossfeed_bypass_leaves_the_running_crossfeed_on` (tests/js/store/faceplate/rail-now.test.js:119). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.
- `test_the_profile_is_the_one_switched_live` (tests/js/store/faceplate/rail-now.test.js:124). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.
- `test_the_pipelines_are_counted_off_the_running_profile` (tests/js/store/faceplate/rail-now.test.js:128). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.
- `test_the_hidden_stages_are_the_preferences_own` (tests/js/store/faceplate/rail-now.test.js:132). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.
- `test_a_running_direct_sdm_holds_the_rail_volume_whatever_the_level` (tests/js/store/faceplate/rail-now.test.js:136). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.
- `test_the_rail_volume_is_empty_before_the_engine_reports_a_level` (tests/js/store/faceplate/rail-now.test.js:142). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-now.test.js` line 79.

### tests/js/store/faceplate/rail-pipelines.test.js

- `test_a_running_structural_crossfeed_block_lights_crossfeed_with_the_bauer_switch_off` (tests/js/store/faceplate/rail-pipelines.test.js:133). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-pipelines.test.js` line 92.
- `test_a_structural_block_lights_crossfeed_where_a_plain_cross_routed_set_does_not` (tests/js/store/faceplate/rail-pipelines.test.js:137). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-pipelines.test.js` line 92.
- `test_a_running_structural_block_with_the_bauer_switch_off_reads_as_the_structural_crossfeed` (tests/js/store/faceplate/rail-pipelines.test.js:145). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-pipelines.test.js` line 92.
- `test_the_bauer_switch_on_over_passthrough_pipelines_reads_as_the_bauer_crossfeed` (tests/js/store/faceplate/rail-pipelines.test.js:150). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-pipelines.test.js` line 92.
- `test_the_bauer_switch_off_over_passthrough_pipelines_reads_as_no_crossfeed` (tests/js/store/faceplate/rail-pipelines.test.js:155). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-pipelines.test.js` line 92.
- `test_a_stereo_passthrough_at_unity_db_leaves_dsp_pipelines_unlit_under_a_running_matrix_engine` (tests/js/store/faceplate/rail-pipelines.test.js:170). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-pipelines.test.js` line 92.
- `test_a_stereo_passthrough_at_unity_linear_gain_leaves_dsp_pipelines_unlit_under_a_running_matrix_engine` (tests/js/store/faceplate/rail-pipelines.test.js:170). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-pipelines.test.js` line 92.
- `test_a_six_channel_passthrough_leaves_dsp_pipelines_unlit_under_a_running_matrix_engine` (tests/js/store/faceplate/rail-pipelines.test.js:170). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-pipelines.test.js` line 92.
- `test_one_pipeline_with_routing_to_another_channel_lights_dsp_pipelines_where_passthrough_leaves_them_unlit` (tests/js/store/faceplate/rail-pipelines.test.js:186). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-pipelines.test.js` line 92.
- `test_one_pipeline_with_a_db_gain_off_unity_lights_dsp_pipelines_where_passthrough_leaves_them_unlit` (tests/js/store/faceplate/rail-pipelines.test.js:186). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-pipelines.test.js` line 92.
- `test_one_pipeline_with_a_linear_gain_off_unity_lights_dsp_pipelines_where_passthrough_leaves_them_unlit` (tests/js/store/faceplate/rail-pipelines.test.js:186). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-pipelines.test.js` line 92.
- `test_one_pipeline_with_a_process_chain_lights_dsp_pipelines_where_passthrough_leaves_them_unlit` (tests/js/store/faceplate/rail-pipelines.test.js:186). Decisive: `'Cannot set property value of [object Object] which has only a getter'`. Route: repair. Cause: R5. Setup line: `tests/js/store/faceplate/rail-pipelines.test.js` line 92.

### tests/js/store/faceplate/stations.test.js

- `test_the_loaded_preset_is_the_one_active_station` (tests/js/store/faceplate/stations.test.js:51). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'Night' - ] `. Route: repair. Cause: R3.

### tests/js/store/fixed-volume-readings.test.js

- `test_unchecking_auto_headroom_over_a_running_manual_moves_the_drawers_line_to_manual` (tests/js/store/fixed-volume-readings.test.js:76). Decisive: `Expected values to be strictly equal:  'off' !== 'manual' `. Route: repair. Cause: R2.

### tests/js/store/guards/applyguard.test.js

- `test_applying_a_previewed_direct_sdm_against_a_volume_not_fixed_at_minus_three_opens_a_warn_question` (tests/js/store/guards/applyguard.test.js:323). Decisive: `'direct_sdm is not staged: effective() reads null, not 1'`. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).
- `test_applying_a_previewed_direct_sdm_with_fixed_volume_already_at_minus_three_opens_no_question` (tests/js/store/guards/applyguard.test.js:349). Decisive: `'direct_sdm is not staged: effective() reads null, not 1'`. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).
- `test_applying_a_previewed_direct_sdm_with_optimal_iso_already_at_minus_three_opens_no_question` (tests/js/store/guards/applyguard.test.js:358). Decisive: `'direct_sdm is not staged: effective() reads null, not 1'`. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).
- `test_an_apply_time_question_is_owned_by_pending` (tests/js/store/guards/applyguard.test.js:372). Decisive: `'direct_sdm is not staged: effective() reads null, not 1'`. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).
- `test_declining_an_apply_time_question_leaves_the_previewed_set_intact` (tests/js/store/guards/applyguard.test.js:385). Decisive: `'direct_sdm is not staged: effective() reads null, not 1'`. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).
- `test_declining_an_apply_time_question_leaves_an_unrelated_staged_edit_alone` (tests/js/store/guards/applyguard.test.js:398). Decisive: `'direct_sdm is not staged: effective() reads null, not 1'`. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).
- `test_leaving_a_hazard_and_reaching_it_again_asks_again_at_edit_time` (tests/js/store/guards/applyguard.test.js:423). Decisive: `'direct_sdm is not staged: effective() reads false, not false'`. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).
- `test_leaving_a_hazard_acknowledged_at_apply_time_and_reaching_it_again_asks_again` (tests/js/store/guards/applyguard.test.js:452). Decisive: `'direct_sdm is not staged: effective() reads null, not 1'`. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).
- `test_pressing_apply_again_on_the_same_acknowledged_set_opens_no_second_question` (tests/js/store/guards/applyguard.test.js:468). Decisive: `'direct_sdm is not staged: effective() reads null, not 1'`. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).

### tests/js/store/guards/directsdmwarn.test.js

- `direct sdm on with fixed volume on at -3 stages immediately` (tests/js/store/guards/directsdmwarn.test.js:255). Decisive: `Expected values to be strictly equal:  undefined !== '1' `. Route: repair. Cause: R2.
- `direct sdm on with optimal iso at its -3 dB setting stages immediately` (tests/js/store/guards/directsdmwarn.test.js:255). Decisive: `Expected values to be strictly equal:  undefined !== '1' `. Route: repair. Cause: R2.
- `direct sdm on with an optimal iso checkbox the form could only render as a bool stages immediately` (tests/js/store/guards/directsdmwarn.test.js:255). Decisive: `Expected values to be strictly equal:  undefined !== '1' `. Route: repair. Cause: R2.
- `direct sdm on with fixed volume on at -3 opens no question` (tests/js/store/guards/directsdmwarn.test.js:269). Decisive: `Expected values to be strictly equal:+ { +   canceled: false, +   confirm: 'Yes', +   decline: 'No', +   kind: 'warn', +   message: 'Enabling this setting will force a -3`. Route: repair. Cause: R2.
- `direct sdm on with optimal iso at its -3 dB setting opens no question` (tests/js/store/guards/directsdmwarn.test.js:269). Decisive: `Expected values to be strictly equal:+ { +   canceled: false, +   confirm: 'Yes', +   decline: 'No', +   kind: 'warn', +   message: 'Enabling this setting will force a -3`. Route: repair. Cause: R2.
- `direct sdm on with an optimal iso checkbox the form could only render as a bool opens no question` (tests/js/store/guards/directsdmwarn.test.js:269). Decisive: `Expected values to be strictly equal:+ { +   canceled: false, +   confirm: 'Yes', +   decline: 'No', +   kind: 'warn', +   message: 'Enabling this setting will force a -3`. Route: repair. Cause: R2.

### tests/js/store/guards/sdm-hide-superseded.test.js

- `test_the_sdm_nx_dropdown_still_offers_a_superseded_filter_it_is_set_to` (tests/js/store/guards/sdm-hide-superseded.test.js:223). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.
- `test_the_exception_for_the_current_selection_returns_only_that_one_filter` (tests/js/store/guards/sdm-hide-superseded.test.js:230). Decisive: `Expected values to be strictly equal:  5 !== 6 `. Route: repair. Cause: R2.

### tests/js/store/guards/shaperfit-alerts.test.js

- `test_a_modulator_above_the_sdm_rate_raises_one_sdm_alert` (tests/js/store/guards/shaperfit-alerts.test.js:82). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'shaper-fit-sdm' - ] `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.
- `test_a_modulator_conflict_is_critical` (tests/js/store/guards/shaperfit-alerts.test.js:98). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'crit' - ] `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.
- `test_a_ditherer_above_the_pcm_rate_raises_one_pcm_alert` (tests/js/store/guards/shaperfit-alerts.test.js:105). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'shaper-fit-pcm' - ] `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.
- `test_a_ditherer_is_read_against_the_floor_it_carries` (tests/js/store/guards/shaperfit-alerts.test.js:110). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'shaper-fit-pcm' - ] `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.
- `test_a_ditherer_conflict_is_a_warning` (tests/js/store/guards/shaperfit-alerts.test.js:119). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'warn' - ] `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.
- `test_staging_a_rate_below_the_modulators_floor_raises_the_conflict_before_apply` (tests/js/store/guards/shaperfit-alerts.test.js:179). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'shaper-fit-sdm' - ] `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.

### tests/js/store/guards/shaperfit-mode-gate.test.js

- `test_staged_auto_mode_reports_the_loaded_chains_conflict` (tests/js/store/guards/shaperfit-mode-gate.test.js:172). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'crit' - ] `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.
- `test_staged_auto_mode_over_a_loaded_pcm_chain_reports_the_pcm_conflict_alone` (tests/js/store/guards/shaperfit-mode-gate.test.js:184). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'warn' - ] `. Route: builder. Cause: B1. Path: `hqptuner/static/store/alerts/shaperfit.js`.
- `test_a_previewed_sdm_preset_reports_the_sdm_conflict_while_the_engine_runs_pcm` (tests/js/store/guards/shaperfit-mode-gate.test.js:201). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'crit' - ] `. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).
- `test_a_previewed_pcm_preset_reports_the_pcm_conflict_while_the_engine_runs_sdm` (tests/js/store/guards/shaperfit-mode-gate.test.js:213). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'warn' - ] `. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).
- `test_a_previewed_sdm_mode_reports_the_sdm_conflict_alone_when_both_families_conflict` (tests/js/store/guards/shaperfit-mode-gate.test.js:225). Decisive: `Expected values to be strictly deep-equal:+ [] - [ -   'crit' - ] `. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).

### tests/js/store/guards/xfmode.test.js

- `test_selecting_structural_stages_crossfeed_off` (tests/js/store/guards/xfmode.test.js:124). Decisive: `Expected values to be strictly equal:  null !== '0' `. Route: repair. Cause: R2.
- `test_selecting_bauer_leaves_crossfeed_off` (tests/js/store/guards/xfmode.test.js:132). Decisive: `Expected values to be strictly equal:  null !== '0' `. Route: repair. Cause: R2.
- `test_turning_structural_off_keeps_the_structural_view` (tests/js/store/guards/xfmode.test.js:146). Decisive: `'expected a recognized block'`. Route: repair. Cause: R8.
- `test_a_block_built_on_in_3_returns_its_pair_on_in_3` (tests/js/store/guards/xfmode.test.js:169). Decisive: `'expected a recognized block'`. Route: repair. Cause: R8.
- `test_retuning_an_installed_block_stages_a_row_change` (tests/js/store/guards/xfmode.test.js:186). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R8.
- `test_reengaging_after_a_removal_uses_the_angle_on_screen` (tests/js/store/guards/xfmode.test.js:198). Decisive: `'expected a recognized block'`. Route: repair. Cause: R8.

### tests/js/store/hardware-catalog.test.js

- `test_the_catalog_value_of_multicore_follows_the_engines_reported_attribute` (tests/js/store/hardware-catalog.test.js:64). Decisive: `'Expected "actual" not to be strictly deep-equal to: null'`. Route: contract-mismatch. Cause: C2. Unresolved, owner question Q2 (see C2).
- `test_the_catalog_value_of_ecores_follows_the_engines_reported_attribute` (tests/js/store/hardware-catalog.test.js:64). Decisive: `'Expected "actual" not to be strictly deep-equal to: null'`. Route: contract-mismatch. Cause: C2. Unresolved, owner question Q2 (see C2).
- `test_the_catalog_value_of_cuda_follows_the_engines_reported_attribute` (tests/js/store/hardware-catalog.test.js:64). Decisive: `'Expected "actual" not to be strictly deep-equal to: null'`. Route: contract-mismatch. Cause: C2. Unresolved, owner question Q2 (see C2).
- `test_the_catalog_value_of_multicore_follows_the_hardware_draft_over_the_engine` (tests/js/store/hardware-catalog.test.js:73). Decisive: `'Expected "actual" not to be strictly deep-equal to: null'`. Route: contract-mismatch. Cause: C2. Unresolved, owner question Q2 (see C2).
- `test_the_catalog_value_of_ecores_follows_the_hardware_draft_over_the_engine` (tests/js/store/hardware-catalog.test.js:73). Decisive: `'Expected "actual" not to be strictly deep-equal to: null'`. Route: contract-mismatch. Cause: C2. Unresolved, owner question Q2 (see C2).
- `test_the_catalog_value_of_cuda_follows_the_hardware_draft_over_the_engine` (tests/js/store/hardware-catalog.test.js:73). Decisive: `'Expected "actual" not to be strictly deep-equal to: null'`. Route: contract-mismatch. Cause: C2. Unresolved, owner question Q2 (see C2).

### tests/js/store/live/live-reenum.test.js

- `test_a_held_write_shows_the_held_value_on_the_dormant_control` (tests/js/store/live/live-reenum.test.js:310). Decisive: `Expected values to be strictly equal:  '' !== '7' `. Route: repair. Cause: R9.

### tests/js/store/live/livepresets.test.js

- `test_a_change_of_loaded_station_re_reads_the_list` (tests/js/store/live/livepresets.test.js:263). Decisive: `Expected values to be strictly deep-equal:[ +   'Hall' -   'Warm' ] `. Route: repair. Cause: R3.

### tests/js/store/loudness-applied.test.js

- `test_a_volume_halfway_down_the_range_applies_half_the_shelving` (tests/js/store/loudness-applied.test.js:89). Decisive: `Expected values to be strictly equal:  0 !== 50 `. Route: repair. Cause: R2.
- `test_a_volume_three_quarters_down_the_range_applies_three_quarters` (tests/js/store/loudness-applied.test.js:93). Decisive: `Expected values to be strictly equal:  0 !== 75 `. Route: repair. Cause: R2.
- `test_a_dragged_volume_knob_moves_the_percent_before_the_engine_reports` (tests/js/store/loudness-applied.test.js:97). Decisive: `Expected values to be strictly equal:  0 !== 25 `. Route: repair. Cause: R2.
- `test_a_range_bound_being_dragged_does_not_move_the_percent` (tests/js/store/loudness-applied.test.js:101). Decisive: `Expected values to be strictly equal:  0 !== 50 `. Route: repair. Cause: R2.
- `test_loudness_switched_off_but_not_applied_does_not_move_the_percent` (tests/js/store/loudness-applied.test.js:105). Decisive: `Expected values to be strictly equal:  0 !== 50 `. Route: repair. Cause: R2.
- `test_a_bypassed_matrix_engine_takes_the_whole_percent_away` (tests/js/store/loudness-applied.test.js:111). Decisive: `Expected values to be strictly equal:  0 !== 50 `. Route: repair. Cause: R2.
- `test_loudness_switched_off_takes_the_whole_percent_away` (tests/js/store/loudness-applied.test.js:115). Decisive: `Expected values to be strictly equal:  0 !== 50 `. Route: repair. Cause: R2.
- `test_a_pinned_volume_takes_the_whole_percent_away` (tests/js/store/loudness-applied.test.js:119). Decisive: `Expected values to be strictly equal:  0 !== 50 `. Route: repair. Cause: R2.
- `test_a_running_direct_sdm_takes_the_whole_percent_away` (tests/js/store/loudness-applied.test.js:123). Decisive: `Expected values to be strictly equal:  0 !== 50 `. Route: repair. Cause: R2.

### tests/js/store/narrow/narrowing-rate.test.js

- `test_auto_hides_both_limited_classes_on_a_44_1_only_network_backend` (tests/js/store/narrow/narrowing-rate.test.js:232). Decisive: `Expected values to be strictly deep-equal:[ +   'rat-two', +   'rat-int', 'rat-any', 'none' ] `. Route: repair. Cause: R2.
- `test_rate_auto_hide_engages_in_sdm_on_a_44_1_only_network_backend` (tests/js/store/narrow/narrowing-rate.test.js:237). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.
- `test_rate_auto_hide_engages_in_sdm_on_a_44_1_only_alsa_backend` (tests/js/store/narrow/narrowing-rate.test.js:249). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.
- `test_a_boolean_false_anydsd_flag_engages_auto` (tests/js/store/narrow/narrowing-rate.test.js:285). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.
- `test_eff_hide_limited_is_true_on_auto_while_auto_engages` (tests/js/store/narrow/narrowing-rate.test.js:301). Decisive: `Expected values to be strictly equal:  false !== true `. Route: repair. Cause: R2.

### tests/js/store/pipeline-baseline.test.js

- `test_an_empty_live_active_leaves_the_config_file_as_the_baseline` (tests/js/store/pipeline-baseline.test.js:90). Decisive: `Expected values to be strictly equal:+ '[]' - '[{"gain":"0","gainunit":"dB","mixdown":"0","process":"iir:type=peak;f=3340.8738;q=1;gain=-3","source":"0"}]' `. Route: repair. Cause: R8.
- `test_a_default_live_active_leaves_the_config_file_as_the_baseline` (tests/js/store/pipeline-baseline.test.js:95). Decisive: `Expected values to be strictly equal:+ '[]' - '[{"gain":"0","gainunit":"dB","mixdown":"0","process":"iir:type=peak;f=3340.8738;q=1;gain=-3","source":"0"}]' `. Route: repair. Cause: R8.
- `test_a_live_active_profile_with_no_daemon_rows_falls_back_to_the_config_file` (tests/js/store/pipeline-baseline.test.js:102). Decisive: `Expected values to be strictly equal:+ '[]' - '[{"gain":"0","gainunit":"dB","mixdown":"0","process":"iir:type=peak;f=3340.8738;q=1;gain=-3","source":"0"}]' `. Route: repair. Cause: R8.
- `test_staging_the_config_file_rows_over_a_live_active_profile_reads_dirty` (tests/js/store/pipeline-baseline.test.js:121). Decisive: `Expected values to be strictly equal:  0 !== 1 `. Route: repair. Cause: R8.

### tests/js/store/presets/presets.test.js

- `test_previewing_a_preset_grounds_the_editor_to_its_saved_values` (tests/js/store/presets/presets.test.js:104). Decisive: `Expected values to be strictly equal:  null !== '-9' `. Route: contract-mismatch. Cause: C1. Unresolved, owner question Q1 (see C1).
- `test_a_preset_silent_on_a_field_leaves_the_form_baseline_in_place` (tests/js/store/presets/presets.test.js:114). Decisive: `Expected values to be strictly equal:  null !== '-3' `. Route: repair. Cause: R2.
- `test_previewing_the_active_preset_clears_the_preview` (tests/js/store/presets/presets.test.js:125). Decisive: `Expected values to be strictly equal:  'Day' !== null `. Route: repair. Cause: R3.
- `test_previewing_the_active_preset_restores_the_form_baseline` (tests/js/store/presets/presets.test.js:131). Decisive: `Expected values to be strictly equal:  null !== '-3' `. Route: repair. Cause: R2.
- `test_clearing_the_preview_restores_the_form_baseline` (tests/js/store/presets/presets.test.js:139). Decisive: `Expected values to be strictly equal:  null !== '-3' `. Route: repair. Cause: R2.

### tests/js/store/structural-roundtrip.test.js

- `test_an_edit_returned_to_its_baseline_leaves_nothing_in_the_server_buffer` (tests/js/store/structural-roundtrip.test.js:113). Decisive: `Expected values to be strictly equal:  true !== false `. Route: repair. Cause: R2.
- `test_pipelines_staged_back_to_their_baseline_rows_leave_nothing_in_the_server_buffer` (tests/js/store/structural-roundtrip.test.js:121). Decisive: `Expected values to be strictly equal:  true !== false `. Route: repair. Cause: R8.
- `test_editing_one_field_clears_an_unrelated_field_that_has_gone_clean` (tests/js/store/structural-roundtrip.test.js:140). Decisive: `Expected values to be strictly equal:  true !== false `. Route: repair. Cause: R2.
- `test_a_checkbox_toggled_off_and_back_on_leaves_nothing_in_the_server_buffer` (tests/js/store/structural-roundtrip.test.js:176). Decisive: `Expected values to be strictly equal:  true !== false `. Route: repair. Cause: R2.

## Counts

- Entries: 195
- R1: 3
- R2: 62
- R3: 18
- R4: 27
- R5: 32
- R6: 4
- R7: 2
- R8: 9
- R9: 1
- R10a: 1
- R10b: 1
- B1: 15
- C1: 13
- C2: 7
