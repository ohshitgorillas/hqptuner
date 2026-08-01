# Pre-v1 release blockers

Five confirmed issues from the 2026-07-31 pre-v1 code review (`/code-review high`). Issues only — no fixes proposed here. Numbering is stable; a fixed item keeps its number and says so.

## 1. Segment enable gates latch permanently dirty — FIXED 2026-07-31

`isDirty` (`hqptuner/static/store/resolve.js:178`) now compares through `truthy()` for `bool` schema entries as well as `widget: "checkbox"`, so a gate returned to its baseline reads clean and `stagedCount` drops back to zero. Covered by 48 tests in `tests/js/card-gates.test.js` (8 behaviours x 6 gates); 18 of them bite against the pre-fix code. No changelog entry — the gates are unreleased, so the latch never shipped.

Original report:

`isDirty` normalises booleans only for `widget: "checkbox"`. The six enable gates converted to `widget: "segment"` with `bool: true` (loudness, crossfeed, DAC correction, matrix, log, fixed volume) compare their staged string against a boolean baseline: when the setting is enabled in the daemon, the baseline is JSON `true` (`httpconf.py:45`, `el.has_attr("checked")`), and a BYPASS→ENGAGE round-trip stages `"1"`, so `String("1") !== String(true)` keeps the gate dirty forever. `stagedCount` never returns to zero, the pending bar demands a no-op Apply on the restart lane, and only Discard clears it. None of the six schema entries carries `fileTruth`, so `formValue()` never coerces. `card-gates.test.js` asserts only the active segment, never the dirty round-trip.

## 2. Crossfeed Structural gate watches the wrong dirty key — FIXED 2026-07-31

`pipelinesDirty()` (`hqptuner/static/lib/xfmode.js`) now compares whether a structural block is installed in `effectivePipelines` against whether one is installed in `pipelineBaseline`, which is the question the ENGAGE/BYPASS gate actually asks. The row-count field is out of the picture, so a "DSP pipelines" edit or a DSP-mode restore no longer lights the gate, and install/removal is detected directly rather than inferred from a count that usually moves.

**The report's first failure direction was not implemented, deliberately.** Retuning an installed block restages all sixteen rows and leaves the gate clean, and that is correct: the gate is ENGAGE/BYPASS, the crossfeed is engaged either way, and the row edit is already counted by the pending bar under `matrix_pipelines`. `crossfeed.test.js` asserts this on purpose (`test_row_edits_alone_leave_the_structural_gate_clean`); implementing the report literally would have lit an on/off switch on every slider nudge.

Folded in while here: `matrix_pipelines` had no baseline to compare against without management credentials — `pipelineBaseline` falls back to the parsed `/matrix` rows, but `baseline()` reached `formValue()`, which finds nothing because the pipeline set is not a form field. Any staged set then read dirty against `undefined` forever, so in read-only mode the pending bar could only be cleared by Discard. `baseline()` now routes the pipeline set through `pipelineBaseline`, re-canonicalized so the compare stays string equality whichever source answered.

Covered by 23 tests — 12 in `tests/js/xfmode.test.js`, 11 in `tests/js/state.test.js`. Six bite against the pre-fix code: `test_retuning_an_installed_block_is_not_pending` and `test_staging_the_dsp_pipelines_row_count_is_not_pending` for the gate, and the three `test_staging_the_matrix_rows_*_reads_clean` cases plus `test_a_pipeline_edit_that_reads_clean_is_not_counted_as_a_staged_change` for the baseline. Each of the gate's negative assertions is paired with a companion asserting the same setup did stage something (`*_stages_a_row_change`, `test_editing_the_dsp_pipelines_row_count_stages_that_field`), so a negative that passed because nothing was staged would be caught. The remaining tests are guards, two of them unavoidably so: nothing-staged cases cannot bite because `isDirty` returns early before reaching a baseline, and installing a block over sixteen unrecognized rows changes the row count anyway (16 to 30), so the old code got it right by the same coincidence it relied on everywhere else. No changelog entry — the card-level gate is unreleased, so neither behaviour shipped.

Original report:

`hqptuner/static/lib/xfmode.js:129`

`pipelinesDirty()` checks `isDirty("pipelines")` — the DSP-pipelines row-count dropdown — while `stageStructural` actually stages content under `matrix_pipelines`. Two failure directions: dragging Speaker angle restages all 16 rows under `matrix_pipelines` (`Crossfeed.js:172` → `actions.js:20`) with row count unchanged, so the `.xfs-gate` renders clean while an edit is pending; conversely, changing the "DSP pipelines" count field on the Matrix tab (`MatrixTab.js:179`) or a DSP-mode restore (`dspmode.js:90`) lights the crossfeed Structural gate dirty with no crossfeed change staged.

## 3. Stale-enumeration window after a mode write, with no surfacing left

`hqptuner/static/store/live.js:94`

Removing the `liveReloading` signal leaves the re-enumeration window with zero surfacing. On a REENUMERATES write (e.g. output mode flip), `liveBusy` disables only the field being written (`LiveView.js:100`), while `live.js:81` installs the new `active_chain` before the enum refetch at `live.js:94` — so the new chain card renders live against the pre-switch enum lists. Picking a filter during that seconds-long window posts an enum ID from the old list: a refused write, or a silently different filter than the name clicked. The deleted "Reloading the engine's lists…" note was the only surfacing, and the two tests touching `liveBusy` were deleted with it, so dropping `busy` from the disabled expression would still pass the suite green.

## 4. Log-scale loudness frequency knobs break on missing min/max

`hqptuner/static/components/Knob.js:74`

`loudness_low_freq` / `loudness_high_freq` carry no schema min/max fallback, and Knob has no `lo <= 0` guard for log scale. Against a daemon build whose `/matrix` form omits `min`/`max` attributes on `post_loudness_lowfreq` (the project's own `fake_http.py:137` renders exactly that; the 6.0.4 fixture happens to ship `min="20"`), `cfgConstraint` (`Field.js:36-41`) returns undefined, `lo = num(min, 0) = 0`, `enc(0, log) = -Infinity`, and `angleOf` becomes NaN — the knob notch and value arc get `x1="NaN"`, the slider gets `min="-Infinity"`, and a pointer drag stages NaN. The steepness knobs got `min: 0.1` / `max: 10` in schema; these two got nothing, and `loudness-strip.test.js` injects min/max in its fixture, so the missing-constraint case is untested.

## 5. Mirror checkbox governs an import lane in a different card

`hqptuner/static/components/MatrixTab.js:203`

The mirror-to-stereo-pair checkbox moved into the collapsible Pipelines card, but ImportPanel's library-load lane in the Headphone Auto EQ card still obeys it: applying a library profile reads `importMirror.value` (`MatrixTab.js:74`, default true), so a mono profile silently mirrors onto both channels with no visible control in the acting card — and no visible control anywhere when the Pipelines card is collapsed (`pipelinesCardOpen` is not persisted). Additionally, `importNote` errors render only inside ImportPanel, so a failed load fired from the Pipelines card writes its error into the other card. No test references `importMirror`, `LoadEqButton`, or the library lane.
