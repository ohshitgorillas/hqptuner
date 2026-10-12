// Rendered suite for the staged mark on hqptuner/static/components/faceplate/Rail.js: a stage whose drawer holds a
// staged, unapplied edit carries `dirty`, the class the drawers' tabs carry for the same state. Only that drawer's
// stage carries it, never its family's other members, and it goes once the edit is applied or discarded. The Speakers
// drawer holds its edits in its own form, not the shared pending buffer, and is marked the same way. A Structural
// crossfeed install staged from the Crossfeed drawer writes pipeline rows, so it marks Crossfeed and DSP pipelines both;
// so does a staged change to the Bauer compensation block, staged here as the rewritten rows the compensation control
// writes, since a slider drag fires events server rendering never fires. An IIR to FIR edit belongs to the Matrix engine
// drawer and marks that stage alone, though Crossfeed may stage the same setting as a fix.
//
// The wire is the seam: the staging fake (tests/js/support/wire/wire.js) holds the pending buffer as the backend does,
// so edit(), stagePipelines(), applyAll() and discardAll() ride the real REST paths; its apply answer clears the
// buffer, as a fully applied POST /api/config/apply does. The source signals are assigned the shapes their endpoints
// serve, as tests/js/components/faceplate/rail.test.js and tests/js/store/faceplate/drawer-family.test.js assign them.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/rail-staged.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Rail } from "../../../../hqptuner/static/components/faceplate/Rail.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { hiddenStages } from "../../../../hqptuner/static/store/ui/prefs.js";
import {
  config,
  engineState,
  engineStatus,
  enums,
  health,
  matrixConfig,
  volume,
} from "../../../../hqptuner/static/store/signals.js";
import { applyAll, discardAll, edit, stagePipelines } from "../../../../hqptuner/static/store/actions.js";
import { speakers } from "../../../../hqptuner/static/store/matrix/speakers.js";
import { discardDraft, setChannelDistance } from "../../../../hqptuner/static/store/faceplate/drawers/speakers.js";
import { setGate, xfRefusal } from "../../../../hqptuner/static/store/faceplate/drawers/crossfeed.js";
import { liveParams, xfMode } from "../../../../hqptuner/static/store/xfeed/mode.js";
import { fitComp, msCompile } from "../../../../hqptuner/static/vendor/eqlab/core/xfeed.js";
import { elements, attr, classes } from "../../support/markup.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */
/** @typedef {{ gain: string, gainunit: string, mixdown: string, process: string, source: string }} PipelineRow */

/**
 * Options as the /matrix form lists them.
 *
 * @param {...string} values
 */
const opts = (...values) => values.map((value) => ({ value, label: value }));

/** A pipeline row from one input to one output with no processing. @param {number} src @param {number} mix @returns {PipelineRow} */
const plain = (src, mix) => ({ gain: "0", gainunit: "dB", mixdown: String(mix), process: "", source: String(src) });

const LOADED_PIPELINES = [plain(0, 0), plain(1, 1)];
const STAGED_PIPELINES = [plain(0, 0), plain(1, 1), plain(0, 1)];

/** The daemon's /speakers form with its switch on and two channels. */
const SPEAKERS_FORM = {
  enabled: true,
  channels: [
    { index: 0, label: "L", level: 0, distance: 287, level_min: -60, level_max: 0, level_step: 0.1 },
    { index: 1, label: "R", level: 0, distance: 301, level_min: -60, level_max: 0, level_step: 0.1 },
  ].map((c) => ({ ...c, distance_min: 0, distance_max: 5000 })),
};

/** The /matrix form's IIR to FIR values: off, and a conversion. */
const IIR = "0";
const FIR = "2";

/** The Bauer corner the /matrix form holds, and the process each compensated row carries. */
const FC = 900;
const FEED = 7;
const EQ = "iir:type=peak;f=1000;q=1;g=-3";

/**
 * The pipeline rows of a Bauer compensation block at strength `s` over the stereo pair, built by the real compiler.
 *
 * @param {number} s
 */
const compensation = (s) => msCompile(EQ, -3, { fit: fitComp(FC, FEED), s }, { a: 0, b: 1 });

/** The daemon's /matrix form with the engine on and Bauer's post-process absent. */
const MATRIX_FIELDS = [
  { name: "enabled", type: "checkbox", value: true },
  { name: "engine", value: "1", options: opts("1", "0") },
  { name: "iir2fir", value: IIR, options: opts(IIR, FIR) },
  { name: "post_correction_enabled", type: "checkbox", value: false },
  { name: "post_correction_dac0", value: "", options: opts("", "m1") },
];

/** The same form with Bauer's post-process on at the custom corner. */
const BAUER_ON_FIELDS = [
  ...MATRIX_FIELDS,
  { name: "post_bauer_enabled", value: "1" },
  { name: "post_bauer_preset", value: "custom", options: opts("default", "custom") },
  { name: "post_bauer_frequency", value: String(FC) },
  { name: "post_bauer_level", value: String(FEED) },
];

/** @type {StagingWire} */
let wire = stagingWire();

beforeEach(async () => {
  wire = stagingWire({
    routes: (path, _opts, w) => {
      if (path === "/api/config/apply") {
        w.staged = { live: {}, http: {} };
        return ok({ report: {} });
      }
      if (path === "/api/config") return ok({ data: config.value });
      if (path === "/api/matrix") return ok({ data: matrixConfig.value });
      return undefined;
    },
  });
  health.value = { ready: true };
  engineState.value = { state: "2", active_chain: "pcm", filter_junk: "0" };
  enums.value = { junk_filters: [{ index: "0", name: "none" }] };
  engineStatus.value = { status: { active_rate: "176400" }, metadata: { samplerate: "44100", bits: "16" } };
  config.value = {
    fields: [
      { name: "volume_max", type: "number", value: -3 },
      { name: "channels", type: "number", value: 2 },
    ],
    file: { matrix_pipelines: JSON.stringify(LOADED_PIPELINES) },
    active: "",
  };
  matrixConfig.value = { fields: MATRIX_FIELDS, rows: [] };
  speakers.value = SPEAKERS_FORM;
  volume.value = "-20";
  hiddenStages.value = [];
  openStage.value = null;
  xfMode.value = null;
  liveParams.value = null;
  xfRefusal.value = "";
  await discardAll();
  discardDraft();
});

/** The ids of the rendered rail's stages that carry the staged mark. */
const marked = () =>
  elements(render(html`<${Rail} />`))
    .filter((e) => e.name === "button" && classes(e).includes("dirty"))
    .map((b) => attr(b, "data-stage"));

/** One staged edit per member drawer of the Matrix-engine family, each to a setting only that member holds. */
const MEMBER_EDITS = [
  { stage: "matrix", put: () => edit("matrix_enabled", "0") },
  { stage: "correction", put: () => edit("dac_correction_enabled", "1") },
  { stage: "pipelines", put: async () => stagePipelines(STAGED_PIPELINES) },
];

for (const { stage, put } of MEMBER_EDITS) {
  test(`test_a_staged_edit_in_the_${stage}_drawer_marks_its_stage_and_no_other_family_member`, async () => {
    await put();
    await quiesce(wire);
    assert.deepEqual(marked(), [stage]);
  });
}

test("test_the_staged_mark_goes_when_the_edit_is_discarded", async () => {
  await edit("dac_correction_enabled", "1");
  await quiesce(wire);
  const staged = marked();
  await discardAll();
  await quiesce(wire);
  assert.deepEqual([staged, marked()], [["correction"], []]);
});

test("test_the_staged_mark_goes_when_the_edit_is_applied", async () => {
  await edit("dac_correction_enabled", "1");
  await quiesce(wire);
  const staged = marked();
  await applyAll();
  await quiesce(wire);
  assert.deepEqual([staged, marked()], [["correction"], []]);
});

test("test_a_staged_structural_crossfeed_install_marks_the_crossfeed_and_dsp_pipelines_stages_and_no_other", async () => {
  xfMode.value = "structural";
  setGate("1");
  await quiesce(wire);
  assert.deepEqual(marked().sort(), ["crossfeed", "pipelines"]);
});

test("test_a_staged_change_to_the_bauer_compensation_marks_the_crossfeed_and_dsp_pipelines_stages_and_no_other", async () => {
  config.value = { ...config.value, file: { matrix_pipelines: JSON.stringify(compensation(0.6)) } };
  matrixConfig.value = { fields: BAUER_ON_FIELDS, rows: [] };
  xfMode.value = "bauer";
  await stagePipelines(compensation(1));
  await quiesce(wire);
  assert.deepEqual(marked().sort(), ["crossfeed", "pipelines"]);
});

test("test_an_iir_to_fir_edit_marks_the_matrix_engine_stage_and_not_crossfeed", async () => {
  await edit("matrix_iir2fir", FIR);
  await quiesce(wire);
  assert.deepEqual(marked(), ["matrix"]);
});

test("test_an_edit_held_in_the_speakers_form_marks_the_speakers_stage", () => {
  setChannelDistance(1, "350");
  assert.deepEqual(marked(), ["speakers"]);
});
