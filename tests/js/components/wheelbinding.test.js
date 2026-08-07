// Behavioral suite for the app-wide rule that the mouse wheel never changes a
// control's value — the binding half of it. tests/js/lib/wheelguard.test.js pins
// what the guard itself does; this file pins that every wheel-sensitive control
// the app renders is actually covered by it.
//
// A case mounts a component the way its own suite mounts it, delivers a wheel
// over every select and every number/range input in the render the way a browser
// delivers one (tests/js/support/wheel.js: bubble the ancestor chain, then run
// the default action if nothing cancelled it), and then asks what a user would
// ask — did any value move, and did anything reach the store. Nothing here looks
// at whether a control carries an `onWheel` prop: that is implementation shape,
// and a guard mounted on a wrapper of the same component would honour the same
// contract. (A guard moved onto a wrapper emitted by a PARENT component would
// not be seen by these cases; the helper states that limit.)
//
// The control is the document's active element during the dispatch, which is the
// hard case: a browser edits a FOCUSED number, range or select on a wheel.
//
// One assertion per case, and a case covers one component's controls together
// rather than one control each. Three things stop a case passing vacuously, all
// of them throws rather than silent skips: a render with no wheel-sensitive
// control at all, a control the simulated default action could not move (a
// dropdown with no second option witnesses nothing), and a count — every case
// states how many controls it drove and how many values it is comparing.
//
// COVERAGE against the seventeen specified sites: fourteen driven, three not.
//
//   driven — controls/index.js Select (via Field) and NumberBox (via Field,
//   store reading only); Knob's range slider; VolumeRangeBar's range input;
//   MatrixFlowRow's gain box, channel select and gain-unit select (via
//   MatrixTab); MatrixStageEditor's kind, stage-type and subsonic selects;
//   MatrixProfileCard's profile select (via MatrixTab); SpeakersCard's
//   speaker-set select; Header's select; Crossfeed's select.
//
//   NOT driven, and reported as gaps rather than faked — `Slider`, `ReadBox`'s
//   number input and `SliderNumber`'s range input of components/controls/index.js.
//   Nothing in the existing suites mounts them and no schema key that renders one
//   is known to this file without reading the module under test.
//
// Also not driven: four further selects in the MatrixTab fixture that render
// with no options at all. They are not any of the four sites MatrixTab hosts —
// those are identified positively (the dB/Lin unit picker, the mtx-ch channel
// pickers, the gain box, the profile picker offering Day/Night) and all four are
// driven. What the option-less four are cannot be established without reading
// the component, so they are named as undriven rather than assumed harmless.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/wheelbinding.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Field } from "../../../hqptuner/static/components/Field.js";
import { Knob } from "../../../hqptuner/static/components/Knob.js";
import { VolumeRangeBar } from "../../../hqptuner/static/components/VolumeRangeBar.js";
import { MatrixTab } from "../../../hqptuner/static/components/MatrixTab.js";
import { StageEditor, setSelected } from "../../../hqptuner/static/components/MatrixStageEditor.js";
import { SpeakersCard, chooseSet } from "../../../hqptuner/static/components/SpeakersCard.js";
import { Header } from "../../../hqptuner/static/components/Header.js";
import { CrossfeedCard } from "../../../hqptuner/static/components/Crossfeed.js";
import { parseProcess } from "../../../hqptuner/static/lib/matrixspec.js";
import {
  config,
  matrixConfig,
  metadata,
  engineState,
  enums,
  health,
  pendingPreset,
} from "../../../hqptuner/static/store/signals.js";
import { speakers } from "../../../hqptuner/static/store/speakers.js";
import { matrixMode } from "../../../hqptuner/static/store/matrixmode.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrowing.js";
import { xfMode, liveParams, remember } from "../../../hqptuner/static/store/xfmode.js";
import { compileRows } from "../../../hqptuner/static/lib/binaural/compile.js";
import { HEAD_RADIUS, SPEAKER_ANGLE } from "../../../hqptuner/static/lib/binaural/geometry.js";
import { cancel } from "../../../hqptuner/static/store/ask.js";
import { stagingWire, quiesce, ok } from "../support/wire.js";
import { renderWith, controlsIn, wheelAt, formValues } from "../support/wheel.js";

/** @typedef {import("../support/wire.js").StagingWire} StagingWire */
/** @typedef {import("../support/wheel.js").VNode} VNode */

// --- the dispatch ------------------------------------------------------------

// Wheel over every wheel-sensitive control the mount renders that a browser's
// default action could actually move, then read the values back off a fresh
// render.
//
// `controls` is how many the case expects to drive and `values` how many
// readings it expects to compare; both are checked, so a fixture that quietly
// stops rendering a control — or one whose dropdown loses its options, or whose
// input loses its value attribute — fails the case instead of shrinking its
// coverage in silence. `values` is omitted by the cases that assert on the store
// or on a callback rather than on rendered values.
/**
 * @param {() => unknown} mount
 * @param {StagingWire | null} w
 * @param {{ controls?: number, values?: number }} [expected]
 * @returns {Promise<{
 *   before: ReturnType<typeof formValues>,
 *   after: ReturnType<typeof formValues>,
 * }>}
 */
async function wheelOverEverything(mount, w, { controls, values } = {}) {
  const first = renderWith(mount());
  const found = controlsIn(first.seen);
  const drivable = found.filter((c) => c.movable);
  if (drivable.length !== controls) {
    const seen = found.map((c) => `${c.label}${c.movable ? "" : " (immovable)"}`).join(", ");
    throw new Error(`expected to drive ${controls} control(s), found ${drivable.length}: ${seen}`);
  }
  const before = formValues(first.out);
  if (values !== undefined && before.count !== values) {
    throw new Error(`expected ${values} readable value(s), found ${before.count}: ${JSON.stringify(before)}`);
  }
  for (const c of drivable) wheelAt(first.seen, c.node);
  if (w) await quiesce(w);
  return { before, after: formValues(render(mount())) };
}

// --- Field: the Select and NumberBox of components/controls/index.js ----------

const IDLE = [
  { value: "0", label: "Never" },
  { value: "60", label: "1 min" },
];

/**
 * @param {Record<string, unknown>[]} fields
 * @returns {Promise<StagingWire>}
 */
async function field(fields) {
  const w = stagingWire({ fallback: (x) => ok(x.staged) });
  engineState.value = {};
  enums.value = null;
  metadata.value = {
    settings: {
      output: { idle_time: { label: "Idle time", tooltip: "Idle prose." } },
      volume: { volume_max: { label: "Max volume", tooltip: "Max prose." } },
    },
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  config.value = { fields, file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: [] };
  showDescriptions.value = false;
  keepOptionDescriptions.value = true;
  resetNarrowing();
  await discardAll();
  return w;
}

const dropdown = () => field([{ name: "idle_time", value: "0", options: IDLE }]);
const numberField = () => field([{ name: "volume_max", value: "-3" }]);

test("test_a_wheel_over_a_dropdown_leaves_its_selection_alone", async () => {
  const w = await dropdown();
  const { before, after } = await wheelOverEverything(() => html`<${Field} k="idle_time" />`, w, {
    controls: 1,
    values: 1,
  });
  assert.deepEqual(after, before);
});

test("test_a_wheel_over_a_dropdown_stages_nothing", async () => {
  const w = await dropdown();
  await wheelOverEverything(() => html`<${Field} k="idle_time" />`, w, { controls: 1 });
  assert.deepEqual(w.stages, []);
});

// The number box is an uncontrolled input synced by ref in useEffect, so its
// VALUE is not observable server-side (docs/testing.md harness facts) — what a
// wheel-driven edit WOULD be observable as is the staging request it fires.
test("test_a_wheel_over_a_number_box_stages_nothing", async () => {
  const w = await numberField();
  await wheelOverEverything(() => html`<${Field} k="volume_max" />`, w, { controls: 1 });
  assert.deepEqual(w.stages, []);
});

// --- Knob: the dial's range slider -------------------------------------------
// The knob reports a move to its parent through onLive/onCommit, so "the value
// did not change" is "the parent was told nothing".

test("test_a_wheel_over_a_knob_slider_reports_no_move_to_its_parent", async () => {
  /** @type {[string, unknown][]} */
  const moves = [];
  const knob = () => html`<${Knob}
    min="-60"
    max="0"
    step="1"
    value=${-20}
    onLive=${(/** @type {unknown} */ v) => moves.push(["live", v])}
    onCommit=${(/** @type {unknown} */ v) => moves.push(["commit", v])}
  />`;
  await wheelOverEverything(knob, null, { controls: 1 });
  assert.deepEqual(moves, []);
});

// --- VolumeRangeBar: its range input -----------------------------------------

/** @returns {Promise<StagingWire>} */
async function volumeBar() {
  const w = stagingWire({ fallback: (x) => ok(x.staged) });
  enums.value = null;
  engineState.value = {};
  matrixConfig.value = null;
  config.value = {
    fields: [
      { name: "volume_min", value: "-60" },
      { name: "volume_max", value: "0" },
      { name: "defaults_volume", value: "-20" },
    ],
    file: {},
  };
  await discardAll();
  return w;
}

test("test_a_wheel_over_a_volume_range_handle_leaves_the_handles_where_they_were", async () => {
  const w = await volumeBar();
  const { before, after } = await wheelOverEverything(() => html`<${VolumeRangeBar} />`, w, {
    controls: 6,
    values: 3,
  });
  assert.deepEqual(after, before);
});

test("test_a_wheel_over_a_volume_range_handle_stages_nothing", async () => {
  const w = await volumeBar();
  await wheelOverEverything(() => html`<${VolumeRangeBar} />`, w, { controls: 6 });
  assert.deepEqual(w.stages, []);
});

// --- MatrixTab: the flow row's three controls and the profile picker ----------

/** @param {Record<string, string>} patch */
const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });

// What this fixture renders, stated so a shrunken render fails the case rather
// than covering less of it: the two pipeline rows bring a gain box, a unit
// picker and two channel pickers each, the profile card brings its picker, and
// the card's dials bring their sliders. Four further selects render with no
// options at all and are not driven (see the header).
const MATRIX_CONTROLS = 14;
const MATRIX_VALUES = 9;

/** @returns {Promise<StagingWire>} */
async function matrixTab() {
  const w = stagingWire();
  showDescriptions.value = false;
  matrixConfig.value = {
    fields: [],
    rows: [],
    live_profiles: ["Night", "Day"],
    live_active: "[Default]",
    file_profiles: { Night: [ROW({})] },
  };
  config.value = {
    fields: [],
    file: { matrix_pipelines: JSON.stringify([ROW({}), ROW({ source: "1", mixdown: "1" })]) },
  };
  await discardAll();
  return w;
}

test("test_a_wheel_over_the_matrix_tab_controls_leaves_every_value_alone", async () => {
  const w = await matrixTab();
  const { before, after } = await wheelOverEverything(() => html`<${MatrixTab} />`, w, {
    controls: MATRIX_CONTROLS,
    values: MATRIX_VALUES,
  });
  assert.deepEqual(after, before);
});

test("test_a_wheel_over_the_matrix_tab_controls_stages_nothing", async () => {
  const w = await matrixTab();
  await wheelOverEverything(() => html`<${MatrixTab} />`, w, { controls: MATRIX_CONTROLS });
  assert.deepEqual(w.stages, []);
});

// --- MatrixStageEditor: its three selects ------------------------------------
// The editor hands an edited chain back through `replaceStages`, so "no value
// changed" is "the chain was never replaced".
//
// Which selects the panel renders depends on the stage docked in it: an IIR
// stage brings the kind picker and the stage-type picker, a RIAA stage brings
// the kind picker and the subsonic picker (`riaa:subsonic=`, tests/js/lib/
// matrixspec.test.js). Two fixtures, so all three specified selects are driven.

const PEAK = "iir:type=peak;f=1000;q=1;g=0";
const RIAA = "riaa:subsonic=0";

/**
 * @param {string} process
 * @param {unknown[]} replaced
 */
const stageEditor = (process, replaced) => () => {
  setSelected(null);
  return html`<${StageEditor}
    stages=${parseProcess(process)}
    stageIndex=${0}
    replaceStages=${(/** @type {unknown} */ s) => replaced.push(s)}
  />`;
};

test("test_a_wheel_over_the_stage_kind_and_type_pickers_replaces_no_stage", async () => {
  /** @type {unknown[]} */
  const replaced = [];
  await wheelOverEverything(stageEditor(PEAK, replaced), null, { controls: 2 });
  assert.deepEqual(replaced, []);
});

test("test_a_wheel_over_the_subsonic_picker_replaces_no_stage", async () => {
  /** @type {unknown[]} */
  const replaced = [];
  await wheelOverEverything(stageEditor(RIAA, replaced), null, { controls: 2 });
  assert.deepEqual(replaced, []);
});

// --- SpeakersCard: the speaker-set select ------------------------------------

/**
 * @param {number} index
 * @param {string} label
 */
const CH = (index, label) => ({
  index,
  label,
  level: 0,
  distance: 300,
  level_min: -60,
  level_max: 0,
  level_step: 0.1,
  distance_min: 0,
  distance_max: 5000,
});
const SPK = {
  enabled: false,
  channels: ["Left", "Right", "Center", "LFE", "Left rear", "Right rear", "Left side", "Right side"].map((n, i) =>
    CH(i, n),
  ),
};

/** @returns {Promise<StagingWire>} */
async function speakersCard() {
  const w = stagingWire({
    routes: (path, opts, x) => {
      if (path === "/api/speakers" && opts.method === "POST") {
        x.posts.push(JSON.parse(String(opts.body)));
        return ok({ applied: true, speakers: SPK });
      }
      return undefined; // unhandled path: the wire's own fallback answers it
    },
  });
  showDescriptions.value = false;
  speakers.value = SPK;
  config.value = { fields: [{ name: "direct_sdm", value: false }], file: {}, active: "", profiles: null };
  matrixConfig.value = {
    fields: [
      { name: "post_bauer_enabled", value: "1" },
      { name: "post_bauer_preset", value: "default" },
      { name: "post_bauer_frequency", value: "700" },
      { name: "post_bauer_level", value: "4.5" },
    ],
    rows: [],
  };
  await discardAll();
  matrixMode.value = "speakers";
  chooseSet("2.0");
  return w;
}

test("test_a_wheel_over_the_speaker_set_picker_leaves_the_set_alone", async () => {
  const w = await speakersCard();
  const { before, after } = await wheelOverEverything(() => html`<${SpeakersCard} />`, w, {
    controls: 5,
    values: 1,
  });
  assert.deepEqual(after, before);
});

// --- Header: its select ------------------------------------------------------

const PROFILES = {
  value: "",
  options: [
    { value: "", label: "(no preset)" },
    { value: "Day", label: "Day" },
    { value: "Night", label: "Night" },
  ],
};

function header() {
  cancel();
  const w = stagingWire();
  health.value = { reachable: true, info: {} };
  engineState.value = {};
  config.value = { fields: [], active: "Day", profiles: PROFILES };
  pendingPreset.value = null;
  return w;
}

test("test_a_wheel_over_the_header_picker_leaves_its_selection_alone", async () => {
  const w = header();
  const { before, after } = await wheelOverEverything(() => html`<${Header} />`, w, { controls: 1, values: 1 });
  assert.deepEqual(after, before);
});

// --- Crossfeed: its select and its dials -------------------------------------
//
// The card's picker is fed by the `post_bauer_preset` field of the daemon's own
// matrix form, so the fixture hands that field the options the form carries.
// Without them the picker offers one value, a wheel over it is a no-op in a
// browser as well, and driving it would witness nothing — which is why the
// dispatch helper refuses such a control outright.

const EQ = "iir:type=peak;f=1000;q=1;g=-3";
/**
 * @param {string} source
 * @param {string} mixdown
 */
const XROW = (source, mixdown) => ({ gain: "-3", gainunit: "dB", mixdown, process: EQ, source });
// Five drivable controls — the preset picker, the two dials, the feed slider and
// its number box — of which three carry a value a render shows.
const CROSSFEED_CONTROLS = 5;
const CROSSFEED_VALUES = 3;
const PRESETS = [
  { value: "default", label: "Default" },
  { value: "chumoy", label: "Chu Moy" },
];

/** @returns {Promise<StagingWire>} */
async function crossfeedCard() {
  const w = stagingWire();
  matrixConfig.value = {
    fields: [
      { name: "post_bauer_enabled", value: true },
      { name: "post_bauer_preset", value: "default", options: PRESETS },
      { name: "post_bauer_frequency", value: "700" },
      { name: "post_bauer_level", value: "4.5" },
      { name: "iir2fir", value: "0" },
    ],
  };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify([XROW("0", "0"), XROW("1", "1")]) } };
  showDescriptions.value = false;
  xfMode.value = null;
  liveParams.value = null;
  remember({ lambda: 1, angle: SPEAKER_ANGLE, headRadius: HEAD_RADIUS });
  compileRows({ lambda: 1, angle: 30, headRadius: HEAD_RADIUS, srcA: 0, srcB: 1, preampDb: -3, eqProcess: EQ });
  await discardAll();
  return w;
}

test("test_a_wheel_over_the_crossfeed_controls_leaves_every_value_alone", async () => {
  const w = await crossfeedCard();
  const { before, after } = await wheelOverEverything(() => html`<${CrossfeedCard} />`, w, {
    controls: CROSSFEED_CONTROLS,
    values: CROSSFEED_VALUES,
  });
  assert.deepEqual(after, before);
});

test("test_a_wheel_over_the_crossfeed_controls_stages_nothing", async () => {
  const w = await crossfeedCard();
  await wheelOverEverything(() => html`<${CrossfeedCard} />`, w, { controls: CROSSFEED_CONTROLS });
  assert.deepEqual(w.stages, []);
});
