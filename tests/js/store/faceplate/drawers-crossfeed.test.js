// Behavioral suite for the Crossfeed drawer's store half: store/faceplate/drawers/crossfeed.js (the picked line, the
// folded line's summary and the gray reason, the gate and the pick) and its two siblings under crossfeed/ (Bauer's
// compensation and the Structural controls).
//
// The store is driven at the wire: the staging fake answers the real REST paths, the daemon's /matrix form fields go
// into `matrixConfig` and the pipeline rows into the /config file tree, and the mode the user picked into `xfMode`.
// Blocks are built with the real compilers, so an installed block is the daemon's serialization, not a fixture. Every
// source signal is reset on every case: the picked mode, an in-flight drag and the last refusal outlive a test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawers-crossfeed.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { effective, effectivePipelines, isDirty } from "../../../../hqptuner/static/store/resolve.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { liveParams, xfMode } from "../../../../hqptuner/static/store/xfeed/mode.js";
import { compileRows } from "../../../../hqptuner/static/vendor/eqlab/core/binaural/compile.js";
import { fitComp, msCompile } from "../../../../hqptuner/static/vendor/eqlab/core/xfeed.js";
import { PRESETS } from "../../../../hqptuner/static/lib/binaural-setup.js";
import {
  crossfeedView,
  pickLine,
  setGate,
  xfRefusal,
} from "../../../../hqptuner/static/store/faceplate/drawers/crossfeed.js";
import { commitComp, compView } from "../../../../hqptuner/static/store/faceplate/drawers/crossfeed/comp.js";
import {
  commitStructural,
  dragStructural,
  pickStructuralPreset,
  structuralView,
} from "../../../../hqptuner/static/store/faceplate/drawers/crossfeed/structural.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";

/** @typedef {import("../../../../hqptuner/static/vendor/eqlab/core/matrixspec.js").PipelineRow} PipelineRow */

const EQ = "iir:type=peak;f=1000;q=1;g=-3";
const FC = 900;
const FEED = 7;

/**
 * @param {string} source
 * @param {string} mixdown
 * @param {string} [gain]
 * @returns {PipelineRow}
 */
const row = (source, mixdown, gain = "-3") => ({ gain, gainunit: "dB", mixdown, process: EQ, source });
const pair = () => [row("0", "0"), row("1", "1")];
/** @param {{ angle?: number, headRadius?: number, lambda?: number }} [p] */
const structural = ({ angle = 30, headRadius = 0.09, lambda = 1 } = {}) =>
  compileRows({ lambda, angle, headRadius, srcA: 0, srcB: 1, preampDb: -3, eqProcess: EQ });
/** @param {number} s */
const compensation = (s) => msCompile(EQ, -3, { fit: fitComp(FC, FEED), s }, { a: 0, b: 1 });

/** @type {import("../../support/wire/wire.js").StagingWire} */
let wire;

/**
 * Load one state of the trees: the pipeline rows, the /matrix form and the picked mode.
 *
 * @param {{ rows?: PipelineRow[], matrix?: boolean, enabled?: string, iir2fir?: string,
 *   picked?: "bauer" | "structural" | null }} [s]
 */
async function load({ rows = pair(), matrix = true, enabled = "0", iir2fir = "0", picked = null } = {}) {
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: matrix },
      { name: "iir2fir", value: iir2fir },
      { name: "post_bauer_enabled", value: enabled },
      {
        name: "post_bauer_preset",
        value: "custom",
        options: [
          { value: "default", label: "default" },
          { value: "custom", label: "custom" },
        ],
      },
      { name: "post_bauer_frequency", value: String(FC) },
      { name: "post_bauer_level", value: String(FEED) },
    ],
  };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify(rows) } };
  await discardAll();
  xfMode.value = picked;
}

beforeEach(async () => {
  wire = stagingWire({ fallback: (w) => ok(w.staged) });
  liveParams.value = null;
  xfRefusal.value = "";
  await load();
});

const settle = () => quiesce(wire);
/** @param {number} n */
const r2 = (n) => Math.round(n * 100) / 100;

// --- the picked line, the folded summary, the gray reason --------------------

test("test_the_picked_line_is_the_users_choice_else_what_the_rows_install", async () => {
  await load({ rows: structural(), picked: null });
  const fromRows = crossfeedView().picked;
  xfMode.value = "bauer";
  assert.deepEqual([fromRows, crossfeedView().picked], ["structural", "bauer"]);
});

test("test_the_folded_bauer_line_summarizes_the_corner_it_would_install", async () => {
  await load({ picked: "structural" });
  assert.deepEqual(crossfeedView().folded.values, [FC, FEED, 0]);
});

test("test_the_folded_bauer_line_carries_the_installed_compensation", async () => {
  await load({ rows: compensation(0.6), enabled: "1", picked: "structural" });
  assert.equal(crossfeedView().folded.values[2], 60);
});

test("test_the_folded_structural_line_summarizes_the_installed_block", async () => {
  await load({ rows: structural({ angle: 22, headRadius: 0.09, lambda: 0.5 }), picked: "bauer" });
  assert.deepEqual(crossfeedView().folded.values.map(r2), [22, 56.55, 50]);
});

test("test_the_gray_reason_follows_the_picked_lines_own_switch", async () => {
  await load({ rows: structural(), enabled: "0", picked: "structural" });
  const structuralOn = crossfeedView().gray;
  xfMode.value = "bauer";
  const bauerOff = crossfeedView().gray;
  assert.deepEqual([structuralOn === "", bauerOff === ""], [true, false]);
});

test("test_a_bypassed_matrix_engine_gives_its_own_reason_whatever_the_switch", async () => {
  await load({ matrix: true, enabled: "0", picked: "bauer" });
  const off = crossfeedView().gray;
  await load({ matrix: false, enabled: "0", picked: "bauer" });
  const bypassedOff = crossfeedView().gray;
  await load({ matrix: false, enabled: "1", picked: "bauer" });
  const bypassedOn = crossfeedView().gray;
  assert.deepEqual([bypassedOff === bypassedOn, bypassedOff === off], [true, false]);
});

// --- the gate and the pick ----------------------------------------------------

test("test_the_bauer_gate_stages_the_post_process_switch", async () => {
  await load({ picked: "bauer" });
  setGate("1");
  await settle();
  assert.equal(effective("crossfeed_enabled"), "1");
});

test("test_engaging_the_structural_gate_installs_the_block", async () => {
  await load({ picked: "structural" });
  const before = crossfeedView().engaged;
  setGate("1");
  await settle();
  assert.deepEqual([before, crossfeedView().engaged], [false, true]);
});

test("test_bypassing_the_structural_gate_removes_the_block", async () => {
  await load({ rows: structural(), picked: "structural" });
  setGate("0");
  await settle();
  assert.equal(effectivePipelines.value.length, 2);
});

test("test_engaging_structural_over_rows_it_cannot_carry_stages_nothing_and_says_why", async () => {
  await load({ rows: [row("0", "1"), row("1", "0")], picked: "structural" });
  setGate("1");
  await settle();
  assert.deepEqual([xfRefusal.value === "", isDirty("matrix_pipelines")], [false, false]);
});

test("test_picking_the_other_line_switches_the_view_and_engages_nothing", async () => {
  await load({ rows: pair(), enabled: "1", picked: "bauer" });
  pickLine("structural");
  await settle();
  assert.deepEqual([crossfeedView().picked, crossfeedView().engaged], ["structural", false]);
});

// --- Bauer's compensation -----------------------------------------------------

test("test_committing_compensation_installs_the_block_at_that_percent", async () => {
  await load({ enabled: "1", picked: "bauer" });
  const before = compView().pct;
  commitComp(80);
  await settle();
  assert.deepEqual([before, compView().pct], [0, 80]);
});

test("test_committing_zero_compensation_takes_the_block_out", async () => {
  await load({ rows: compensation(0.6), enabled: "1", picked: "bauer" });
  commitComp(0);
  await settle();
  assert.equal(effectivePipelines.value.length, 2);
});

test("test_compensation_is_ready_only_over_a_symmetric_stereo_pair", async () => {
  await load({ enabled: "1", picked: "bauer" });
  const symmetric = compView().ready;
  await load({ rows: [row("0", "0", "-3"), row("1", "1", "-4")], enabled: "1", picked: "bauer" });
  assert.deepEqual([symmetric, compView().ready], [true, false]);
});

// --- the Structural controls --------------------------------------------------

test("test_a_structural_commit_restages_the_installed_block", async () => {
  await load({ rows: structural({ angle: 30 }), picked: "structural" });
  commitStructural({ angle: 40 });
  await settle();
  assert.equal(r2(structuralView().angle), 40);
});

test("test_a_structural_drag_moves_the_controls_and_stages_nothing", async () => {
  await load({ rows: structural({ angle: 30 }), picked: "structural" });
  dragStructural({ angle: 45 });
  assert.deepEqual([r2(structuralView().angle), isDirty("matrix_pipelines")], [45, false]);
});

test("test_a_structural_preset_sets_the_angle_and_keeps_the_head", async () => {
  await load({ rows: structural({ angle: 33, headRadius: 0.09 }), picked: "structural" });
  const before = structuralView();
  const preset = PRESETS[PRESETS.length - 1];
  pickStructuralPreset(preset.id);
  await settle();
  const after = structuralView();
  assert.deepEqual([r2(after.circ), r2(after.angle)], [r2(before.circ), preset.angle]);
});

test("test_structural_names_the_settings_an_install_would_change", async () => {
  await load({ iir2fir: "2", enabled: "0", picked: "structural" });
  const linear = structuralView().conflicts.map((c) => c.key);
  await load({ iir2fir: "0", enabled: "0", picked: "structural" });
  assert.deepEqual([linear, structuralView().conflicts.length], [["matrix_iir2fir"], 0]);
});
