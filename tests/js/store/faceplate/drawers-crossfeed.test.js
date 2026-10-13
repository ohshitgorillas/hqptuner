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
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { liveParams, xfMode } from "../../../../hqptuner/static/store/xfeed/mode.js";
import { compileRows } from "../../../../hqptuner/static/vendor/eqlab/core/binaural/compile.js";
import { fitComp, msCompile } from "../../../../hqptuner/static/vendor/eqlab/core/xfeed.js";
import { crossfeedView, setGate, xfRefusal } from "../../../../hqptuner/static/store/faceplate/drawers/crossfeed.js";
import { compView } from "../../../../hqptuner/static/store/faceplate/drawers/crossfeed/comp.js";
import { structuralView } from "../../../../hqptuner/static/store/faceplate/drawers/crossfeed/structural.js";
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

test("test_the_picked_line_with_no_choice_is_what_the_rows_install", async () => {
  await load({ rows: structural(), picked: null });
  const fromRows = crossfeedView().picked;
  assert.equal(fromRows, "structural");
});

test("test_the_picked_line_is_the_users_choice_over_what_the_rows_install", async () => {
  await load({ rows: structural(), picked: null });
  xfMode.value = "bauer";
  assert.equal(crossfeedView().picked, "bauer");
});

test("test_the_folded_bauer_line_summarizes_the_corner_frequency_it_would_install", async () => {
  await load({ picked: "structural" });
  assert.equal(crossfeedView().folded.values[0], FC);
});

test("test_the_folded_bauer_line_summarizes_the_feed_level_it_would_install", async () => {
  await load({ picked: "structural" });
  assert.equal(crossfeedView().folded.values[1], FEED);
});

test("test_the_folded_bauer_line_carries_the_installed_compensation", async () => {
  await load({ rows: compensation(0.6), enabled: "1", picked: "structural" });
  assert.equal(crossfeedView().folded.values[2], 60);
});

test("test_the_folded_structural_line_summarizes_the_installed_block", async () => {
  await load({ rows: structural({ angle: 22, headRadius: 0.09, lambda: 0.5 }), picked: "bauer" });
  assert.deepEqual(crossfeedView().folded.values.map(r2), [22, 56.55, 50]);
});

test("test_a_bypassed_matrix_engine_gives_one_reason_whatever_the_switch", async () => {
  await load({ matrix: false, enabled: "0", picked: "bauer" });
  const bypassedOff = crossfeedView().gray;
  await load({ matrix: false, enabled: "1", picked: "bauer" });
  const bypassedOn = crossfeedView().gray;
  assert.equal(bypassedOff, bypassedOn);
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
  setGate("1");
  await settle();
  assert.equal(crossfeedView().engaged, true);
});

// --- Bauer's compensation -----------------------------------------------------

test("test_compensation_is_ready_over_a_symmetric_stereo_pair", async () => {
  await load({ enabled: "1", picked: "bauer" });
  const symmetric = compView().ready;
  assert.equal(symmetric, true);
});

// --- the Structural controls --------------------------------------------------

test("test_structural_names_the_settings_an_install_would_change", async () => {
  await load({ iir2fir: "2", enabled: "0", picked: "structural" });
  const linear = structuralView().conflicts.map((c) => c.key);
  assert.deepEqual(linear, ["matrix_iir2fir"]);
});
