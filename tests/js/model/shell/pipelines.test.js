// Behavioral suite for mockup/scripts/model/pipelines.js: which pins of the routing grid are lit and what they carry,
// the overview's and an output tab's summaries, the stage dock's field values and whether they resolve against their
// tables, and the inputs the response plot draws.
//
// Pipelines, iir and delay tables and channel names are tables the test writes; no shipped data supplies an input or
// an expected value.
//
// Run: node --test tests/js/mockup/pipelines.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAXP,
  crosspoint,
  groups,
  inputsOf,
  listItems,
  outputView,
  overviewSummary,
  pageOf,
  pinState,
  stageAt,
} from "../../../../hqptuner/static/model/shell/pipelines.js";
import {
  bandGain,
  delayFields,
  dockState,
  gainSwitch,
  iirFields,
  lockedFields,
  plotInputs,
  retypeStage,
} from "../../../../hqptuner/static/model/shell/pipelines-edit.js";
import { near } from "../../support/near.js";

/**
 * @typedef {import("../../../../hqptuner/static/model/shell/pipelines.js").Pipe} Pipe
 * @typedef {import("../../../../hqptuner/static/model/shell/pipelines.js").Stage} Stage
 */

/**
 * A peaking band.
 *
 * @param {number} f
 * @param {number} g
 * @returns {Stage}
 */
const peak = (f, g) => ({ kind: "iir", type: "peak", f, g, q: 1 });

/**
 * A pipeline from one input to one output, 0 dB and empty unless `more` says otherwise.
 *
 * @param {number} src
 * @param {number} mix
 * @param {Partial<Pipe>} [more]
 * @returns {Pipe}
 */
const pipe = (src, mix, more = {}) => ({ src, mix, gain: 0, unit: "dB", stages: [], ...more });

//: A two-band EQ, a delay, then the gain.
const EQ_DELAY = pipe(0, 0, { stages: [peak(100, -3), peak(200, 2), { kind: "delay", t: 0.001 }] });

//: Input 0 feeds output 0 twice (one a negative Lin gain), input 0 and input 1 feed output 1; input 1 feeds output 0 never.
const SET = [
  pipe(0, 0, { gain: -3, stages: [peak(100, -3), peak(200, 2)] }),
  pipe(0, 1),
  pipe(1, 1),
  pipe(0, 0, { unit: "Lin", gain: -0.5 }),
];

//: A crossfeed block's two rows into output 0, with one plain pipeline from the same input.
const BLOCK = [pipe(0, 0, { gen: "structural", ear: 0 }), pipe(0, 0, { gen: "structural", ear: 1 }), pipe(0, 0)];

//: iir types: two with a width argument, one without, and a raw biquad.
const TYPES = [
  { t: "lp", d: "low", args: ["f"], alt: ["q", "s"] },
  { t: "peak", d: "peaking", args: ["f", "g"], alt: ["q", "bw"] },
  { t: "lp1", d: "first", args: ["f"], alt: [] },
  { t: "biquad", d: "raw", args: ["b0", "b1", "b2", "a0", "a1", "a2"], alt: [] },
];

//: Delay arguments in wire order.
const DELAYS = [
  { a: "s", d: "samples", unit: "smp" },
  { a: "t", d: "time", unit: "sec" },
  { a: "d", d: "distance", unit: "m" },
];

//: Channel names the plot labels from.
const NAMES = { short: (/** @type {number} */ i) => `c${i}`, long: (/** @type {number} */ i) => `ch${i}` };

/**
 * An output tab's selection on output 0.
 *
 * @param {Partial<{ src: number | null, selPipe: number, page: number }>} sel
 */
const view0 = (sel) => ({ src: null, selPipe: -1, page: 0, open: /** @type {Set<string>} */ (new Set()), ...sel });

/**
 * The plot's view of output 0 on the set given.
 *
 * @param {Pipe[]} pipes
 * @param {number} selPipe
 * @param {string} scope
 */
const plotOf = (pipes, selPipe, scope) => plotInputs(pipes, { o: 0, selPipe, scope, ear: [pipes[0], pipes[1]] }, NAMES);

// ── crosspoint, inputsOf, listItems ─────────────────────────────────────

test("test_crosspoint_lists_every_pipeline_from_one_input_into_one_output", () => {
  assert.deepEqual(
    crosspoint(SET, 0, 0).map(([, i]) => i),
    [0, 3],
  );
});

test("test_inputs_of_an_output_come_once_each_in_channel_order", () => {
  assert.deepEqual(inputsOf([pipe(2, 0), pipe(0, 0), pipe(2, 0), pipe(1, 1)], 0), [0, 2]);
});

test("test_a_folded_block_stands_in_for_its_rows", () => {
  assert.equal(listItems(crosspoint(BLOCK, 0, 0), new Set()).length, 2);
});

test("test_a_folded_block_counts_its_rows", () => {
  assert.equal(listItems(crosspoint(BLOCK, 0, 0), new Set())[0].n, 2);
});

test("test_an_unfolded_block_leads_with_its_header", () => {
  assert.equal(listItems(crosspoint(BLOCK, 0, 0), new Set(["structural"]))[0].head, "structural");
});

test("test_an_unfolded_block_lists_its_rows_as_in_the_block", () => {
  assert.equal(listItems(crosspoint(BLOCK, 0, 0), new Set(["structural"]))[1].inBlock, true);
});

// ── groups, stageAt ─────────────────────────────────────────────────────

test("test_a_run_of_peaking_stages_is_one_peq_chip", () => {
  assert.deepEqual(
    groups(EQ_DELAY).map((g) => g.kind),
    ["peq", "delay", "gain"],
  );
});

test("test_a_lone_peaking_stage_is_an_iir_chip", () => {
  assert.deepEqual(
    groups(pipe(0, 0, { stages: [peak(100, 1)] })).map((g) => g.kind),
    ["iir", "gain"],
  );
});

test("test_a_block_stage_never_joins_a_peq_run", () => {
  const p = pipe(0, 0, { stages: [peak(100, 1), { ...peak(200, 1), blk: true }, peak(300, 1)] });
  assert.equal(groups(p).length, 4);
});

test("test_a_stage_inside_a_peq_run_is_its_band", () => {
  assert.deepEqual(stageAt(groups(EQ_DELAY), 1), { chip: 0, band: 1 });
});

test("test_a_stage_past_the_chain_has_no_chip", () => {
  assert.equal(stageAt(groups(EQ_DELAY), 9).chip, -1);
});

// ── pinState ────────────────────────────────────────────────────────────

test("test_a_pin_with_no_pipeline_is_unlit", () => {
  assert.equal(pinState(SET, 1, 0).on, false);
});

test("test_a_pin_with_a_pipeline_is_lit", () => {
  assert.equal(pinState(SET, 0, 1).on, true);
});

test("test_a_pin_counts_its_pipelines", () => {
  assert.equal(pinState(SET, 0, 0).n, 2);
});

test("test_a_pin_holding_a_negative_lin_gain_flags_polarity", () => {
  assert.equal(pinState(SET, 0, 0).neg, true);
});

test("test_a_pin_with_db_gains_flags_no_polarity", () => {
  assert.equal(pinState(SET, 0, 1).neg, false);
});

test("test_a_pin_names_the_crossfeed_block_it_holds", () => {
  assert.equal(pinState(BLOCK, 0, 0).gen, "structural");
});

test("test_an_unlit_pin_carries_no_gain_label", () => {
  assert.equal(pinState(SET, 1, 0).label, "");
});

test("test_a_pin_fill_is_its_share_of_all_pipelines", () => {
  assert.equal(pinState(SET, 0, 0).fill, 50);
});

test("test_a_pin_fill_never_drops_below_its_floor", () => {
  const many = [pipe(0, 0), pipe(0, 0), ...Array.from({ length: 38 }, () => pipe(1, 1))];
  assert.equal(pinState(many, 0, 0).fill, 6);
});

// ── overviewSummary ─────────────────────────────────────────────────────

test("test_overview_cells_shrink_as_channels_grow", () => {
  assert.equal(overviewSummary(8, 8, 1).cell, 55);
});

test("test_overview_cells_stop_growing_at_their_ceiling", () => {
  assert.equal(overviewSummary(2, 2, 1).cell, 112);
});

test("test_overview_cells_stop_shrinking_at_their_floor", () => {
  assert.equal(overviewSummary(16, 2, 1).cell, 44);
});

test("test_overview_is_over_past_the_pipeline_ceiling", () => {
  assert.equal(overviewSummary(2, 2, MAXP + 1).over, true);
});

test("test_overview_at_the_pipeline_ceiling_is_not_over", () => {
  assert.equal(overviewSummary(2, 2, MAXP).over, false);
});

// ── outputView, pageOf ──────────────────────────────────────────────────

test("test_an_output_falls_back_to_its_first_input_when_the_kept_one_left", () => {
  assert.equal(outputView(SET, 3, 1, view0({ src: 2 })).src, 0);
});

test("test_an_output_with_no_input_shows_none", () => {
  assert.equal(outputView([], 2, 0, view0({ src: 0 })).src, null);
});

test("test_an_output_keeps_a_selected_pipeline_still_on_its_input", () => {
  assert.equal(outputView(SET, 2, 0, view0({ src: 0, selPipe: 3 })).selPipe, 3);
});

test("test_an_output_selects_the_inputs_first_pipeline_when_the_kept_one_is_elsewhere", () => {
  assert.equal(outputView(SET, 2, 0, view0({ src: 0, selPipe: 2 })).selPipe, 0);
});

test("test_an_output_reports_a_reselection", () => {
  assert.equal(outputView(SET, 2, 0, view0({ src: 0, selPipe: 2 })).reselect, true);
});

test("test_an_output_offers_the_inputs_not_yet_feeding_it", () => {
  assert.deepEqual(outputView(SET, 3, 0, view0({})).others, [1, 2]);
});

test("test_an_output_counts_each_inputs_pipelines", () => {
  assert.deepEqual(outputView(SET, 2, 0, view0({})).counts, [2]);
});

test("test_an_output_page_past_the_end_shows_the_last_page", () => {
  const dense = Array.from({ length: 13 }, () => pipe(0, 0));
  assert.equal(outputView(dense, 1, 0, view0({ src: 0, page: 9 })).paging.page, 2);
});

test("test_a_listed_pipeline_is_found_on_its_page", () => {
  const dense = Array.from({ length: 13 }, () => pipe(0, 0));
  assert.equal(pageOf(listItems(crosspoint(dense, 0, 0), new Set()), 7), 1);
});

test("test_an_unlisted_pipeline_lands_on_the_first_page", () => {
  assert.equal(pageOf(listItems(crosspoint(SET, 0, 0), new Set()), 9), 0);
});

// ── dockState ───────────────────────────────────────────────────────────

test("test_the_dock_hides_without_a_pipeline", () => {
  assert.equal(dockState(undefined, false, 0, 0).shown, false);
});

test("test_the_dock_hides_while_the_strip_is_raw", () => {
  assert.equal(dockState(EQ_DELAY, true, 0, 0).shown, false);
});

test("test_the_dock_clamps_its_chip_into_the_strip", () => {
  assert.equal(dockState(EQ_DELAY, false, 9, 0).chip, 2);
});

test("test_the_dock_clamps_its_band_into_the_peq_run", () => {
  assert.equal(dockState(EQ_DELAY, false, 0, 5).band, 1);
});

test("test_the_dock_leaves_the_band_alone_off_a_peq_run", () => {
  assert.equal(dockState(EQ_DELAY, false, 2, 5).band, 5);
});

test("test_the_dock_edits_the_selected_bands_stage", () => {
  assert.equal(dockState(EQ_DELAY, false, 0, 1).si, 1);
});

test("test_the_dock_locks_a_crossfeed_rows_gain", () => {
  assert.equal(dockState(BLOCK[0], false, 0, 0).locked, true);
});

test("test_the_dock_leaves_a_crossfeed_rows_shared_eq_unlocked", () => {
  const row = pipe(0, 0, { gen: "structural", stages: [peak(100, 1)] });
  assert.equal(dockState(row, false, 0, 0).locked, false);
});

test("test_the_dock_locks_a_crossfeed_blocks_own_stage", () => {
  const row = pipe(0, 0, { gen: "structural", stages: [{ kind: "delay", t: 0.001, blk: true }] });
  assert.equal(dockState(row, false, 0, 0).locked, true);
});

test("test_the_dock_offers_a_kind_picker_on_a_single_stage", () => {
  assert.equal(dockState(EQ_DELAY, false, 1, 0).picker, true);
});

test("test_the_dock_offers_no_kind_picker_on_a_peq_run", () => {
  assert.equal(dockState(EQ_DELAY, false, 0, 0).picker, false);
});

test("test_the_dock_offers_no_kind_picker_on_a_crossfeed_row", () => {
  const row = pipe(0, 0, { gen: "structural", stages: [{ kind: "delay", t: 0.001 }] });
  assert.equal(dockState(row, false, 0, 0).picker, false);
});

// ── iirFields ───────────────────────────────────────────────────────────

test("test_an_iir_stage_of_a_listed_type_is_known", () => {
  assert.equal(iirFields(peak(100, 1), TYPES, TYPES[1]).known, true);
});

test("test_an_iir_stage_of_an_unlisted_type_is_not_known", () => {
  assert.equal(iirFields({ kind: "iir", type: "odd", f: 1 }, TYPES, TYPES[1]).known, false);
});

test("test_an_iir_stage_of_an_unlisted_type_edits_as_the_fallback", () => {
  assert.equal(iirFields({ kind: "iir", type: "odd", f: 1 }, TYPES, TYPES[1]).def, TYPES[1]);
});

test("test_the_width_argument_is_the_one_the_stage_gives", () => {
  assert.equal(iirFields({ kind: "iir", type: "lp", f: 100, s: 1 }, TYPES, TYPES[1]).alt, "s");
});

test("test_an_unset_width_argument_is_the_first_choice", () => {
  assert.equal(iirFields({ kind: "iir", type: "lp", f: 100 }, TYPES, TYPES[1]).alt, "q");
});

test("test_the_width_argument_sits_after_the_first_argument", () => {
  assert.deepEqual(
    iirFields(peak(100, 1), TYPES, TYPES[1]).args.map((x) => x.arg),
    ["f", "q", "g"],
  );
});

test("test_only_the_width_argument_switches_its_form", () => {
  assert.deepEqual(
    iirFields(peak(100, 1), TYPES, TYPES[1]).args.map((x) => x.switchable),
    [false, true, false],
  );
});

test("test_a_type_without_a_width_lists_its_arguments_alone", () => {
  assert.deepEqual(
    iirFields({ kind: "iir", type: "lp1", f: 100 }, TYPES, TYPES[1]).args.map((x) => x.arg),
    ["f"],
  );
});

test("test_a_biquad_lists_its_coefficients_in_wire_order", () => {
  assert.deepEqual(
    iirFields({ kind: "iir", type: "biquad" }, TYPES, TYPES[1]).args.map((x) => x.arg),
    TYPES[3].args,
  );
});

test("test_an_iir_field_carries_the_stages_value", () => {
  assert.equal(iirFields(peak(100, 1), TYPES, TYPES[1]).args[0].value, 100);
});

test("test_a_bandwidth_width_hints_bandwidth", () => {
  assert.equal(iirFields(peak(100, 1), TYPES, TYPES[1]).hint, "bw");
});

test("test_a_slope_width_hints_slope", () => {
  assert.equal(iirFields({ kind: "iir", type: "lp", f: 100 }, TYPES, TYPES[1]).hint, "s");
});

test("test_a_type_without_a_width_carries_no_hint", () => {
  assert.equal(iirFields({ kind: "iir", type: "lp1", f: 100 }, TYPES, TYPES[1]).hint, null);
});

// ── delayFields ─────────────────────────────────────────────────────────

test("test_a_delay_edits_in_the_unit_it_gives", () => {
  assert.equal(delayFields({ kind: "delay", s: 48 }, DELAYS, DELAYS[1]).cur, DELAYS[0]);
});

test("test_a_delay_carries_its_value", () => {
  assert.equal(delayFields({ kind: "delay", s: 48 }, DELAYS, DELAYS[1]).value, 48);
});

test("test_a_delay_without_a_unit_edits_as_the_fallback", () => {
  assert.equal(delayFields({ kind: "delay" }, DELAYS, DELAYS[1]).cur, DELAYS[1]);
});

test("test_a_delay_without_a_unit_is_not_known", () => {
  assert.equal(delayFields({ kind: "delay" }, DELAYS, DELAYS[1]).known, false);
});

test("test_a_distance_delay_defaults_the_speed_of_sound", () => {
  assert.equal(delayFields({ kind: "delay", d: 2 }, DELAYS, DELAYS[1]).speed, 343.956);
});

test("test_a_distance_delay_keeps_its_own_speed_of_sound", () => {
  assert.equal(delayFields({ kind: "delay", d: 2, v: 340 }, DELAYS, DELAYS[1]).speed, 340);
});

test("test_a_time_delay_has_no_speed_of_sound", () => {
  assert.equal(delayFields({ kind: "delay", t: 0.002 }, DELAYS, DELAYS[1]).speed, null);
});

// ── lockedFields ────────────────────────────────────────────────────────

test("test_a_locked_gain_reads_as_a_gain", () => {
  const p = pipe(0, 0, { gen: "comp", unit: "Lin", gain: 0.5 });
  assert.equal(lockedFields(p, { kind: "gain", idx: [] }, { types: TYPES, delays: DELAYS }).kind, "gain");
});

test("test_a_locked_gain_carries_its_unit", () => {
  const p = pipe(0, 0, { gen: "comp", unit: "Lin", gain: 0.5 });
  assert.equal(lockedFields(p, { kind: "gain", idx: [] }, { types: TYPES, delays: DELAYS }).unit, "Lin");
});

test("test_a_locked_delay_carries_its_tables_unit", () => {
  const p = pipe(0, 0, { gen: "comp", stages: [{ kind: "delay", t: 0.002, blk: true }] });
  assert.equal(lockedFields(p, { kind: "delay", idx: [0] }, { types: TYPES, delays: DELAYS }).unit, "sec");
});

test("test_a_locked_delay_reads_as_its_wire_argument", () => {
  const p = pipe(0, 0, { gen: "comp", stages: [{ kind: "delay", t: 0.002, blk: true }] });
  assert.equal(lockedFields(p, { kind: "delay", idx: [0] }, { types: TYPES, delays: DELAYS }).value, "t=0.002");
});

test("test_a_locked_iir_resolves_its_type", () => {
  const p = pipe(0, 0, { gen: "comp", stages: [{ kind: "iir", type: "lp", f: 700, q: 0.5, blk: true }] });
  assert.equal(lockedFields(p, { kind: "iir", idx: [0] }, { types: TYPES, delays: DELAYS }).def, TYPES[0]);
});

test("test_a_locked_iir_reads_as_its_wire_arguments", () => {
  const p = pipe(0, 0, { gen: "comp", stages: [{ kind: "iir", type: "lp", f: 700, q: 0.5, blk: true }] });
  assert.equal(lockedFields(p, { kind: "iir", idx: [0] }, { types: TYPES, delays: DELAYS }).value, "f=700 q=0.5");
});

// ── gainSwitch, retypeStage ─────────────────────────────────────────────

test("test_a_db_gain_switched_to_lin_is_its_factor", () => {
  assert.equal(gainSwitch(-6, "Lin"), 0.5012);
});

test("test_a_lin_gain_switched_to_db_is_its_level", () => {
  assert.equal(gainSwitch(0.5, "dB"), -6.02);
});

test("test_a_zero_lin_gain_switched_to_db_is_its_floor", () => {
  assert.equal(gainSwitch(0, "dB"), -120);
});

test("test_a_retyped_stage_keeps_the_arguments_both_types_take", () => {
  assert.deepEqual(retypeStage({ kind: "iir", type: "peak", f: 100, g: -3, q: 2 }, "lp", TYPES), {
    kind: "iir",
    type: "lp",
    f: 100,
    q: 2,
  });
});

test("test_a_retyped_stage_seeds_a_missing_width", () => {
  assert.equal(retypeStage({ kind: "iir", type: "lp1", f: 100 }, "peak", TYPES).q, 0.707);
});

test("test_a_retyped_stage_seeds_a_missing_frequency", () => {
  assert.equal(retypeStage({ kind: "iir", type: "biquad", b0: 1 }, "peak", TYPES).f, 1000);
});

test("test_a_retyped_stage_seeds_a_missing_gain", () => {
  assert.equal(retypeStage({ kind: "iir", type: "lp", f: 100, q: 1 }, "peak", TYPES).g, 0);
});

test("test_a_stage_retyped_to_biquad_is_seeded_as_a_pass_through", () => {
  assert.equal(retypeStage(peak(100, 1), "biquad", TYPES).b0, 1);
});

// ── plotInputs, bandGain ────────────────────────────────────────────────

test("test_the_plot_hides_without_a_pipeline", () => {
  assert.equal(plotOf(SET, -1, "auto").shown, false);
});

test("test_the_plot_shows_the_crosspoint_when_several_pipelines_share_it", () => {
  assert.equal(plotOf(SET, 0, "auto").sc, "xp");
});

test("test_the_plot_shows_the_pipeline_when_it_alone_feeds_its_crosspoint", () => {
  assert.equal(plotOf([pipe(0, 0), pipe(1, 0)], 0, "auto").sc, "pipe");
});

test("test_the_plot_shows_a_crossfeed_rows_crosspoint_for_its_own_pipeline", () => {
  assert.equal(plotOf(BLOCK, 0, "pipe").sc, "xp");
});

test("test_the_plot_asked_for_a_lone_crosspoint_shows_the_pipeline", () => {
  assert.equal(plotOf([pipe(0, 0), pipe(1, 0)], 0, "xp").sc, "pipe");
});

test("test_the_plot_offers_a_crossfeed_row_no_single_pipeline_scope", () => {
  assert.deepEqual(
    plotOf(BLOCK, 0, "auto").options.map((x) => x.v),
    ["xp", "bus"],
  );
});

test("test_the_bus_plot_draws_one_trace_per_input", () => {
  assert.equal(plotOf([pipe(0, 0), pipe(1, 0), pipe(1, 0)], 0, "bus").traces.length, 2);
});

test("test_the_bus_plot_sets_the_other_inputs_aside", () => {
  assert.deepEqual(
    plotOf([pipe(0, 0), pipe(1, 0)], 0, "bus").traces.map((x) => x.cls),
    ["", "side"],
  );
});

test("test_the_crosspoint_plot_sums_every_pipeline_on_it", () => {
  assert.equal(plotOf(SET, 0, "xp").traces[1].members.length, 2);
});

test("test_a_crossfeed_rows_eq_trace_is_its_ears", () => {
  const ear = pipe(0, 0, { stages: [peak(100, 1)] });
  const row = pipe(0, 0, { gen: "structural", ear: 0 });
  const plotted = plotInputs([row, ear], { o: 0, selPipe: 0, scope: "auto", ear: [ear, undefined] }, NAMES);
  assert.equal(plotted.traces[0].members[0], ear);
});

test("test_the_plot_drags_one_band_per_peaking_stage", () => {
  assert.equal(plotOf([EQ_DELAY], 0, "auto").bands.length, 2);
});

test("test_the_bus_plot_drags_no_band", () => {
  assert.equal(plotOf(SET, 0, "bus").bands.length, 0);
});

test("test_a_band_rides_its_pipelines_gain", () => {
  assert.equal(plotOf(SET, 0, "pipe").bands[0].db, -6);
});

test("test_a_lin_gain_offsets_the_bands_by_its_level", () => {
  assert.ok(...near(plotOf([pipe(0, 0, { unit: "Lin", gain: 0.5 })], 0, "auto").off, -6.0206, 1e-4));
});

test("test_a_dragged_band_gain_clamps_to_its_range", () => {
  assert.equal(bandGain(30, 0), 20);
});

test("test_a_dragged_band_gain_rounds_to_a_tenth", () => {
  assert.equal(bandGain(1.26, 0), 1.3);
});

test("test_a_dragged_band_gain_sheds_the_pipelines_gain", () => {
  assert.equal(bandGain(-2, -3), 1);
});
