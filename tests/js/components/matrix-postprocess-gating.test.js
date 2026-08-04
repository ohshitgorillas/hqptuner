// Behavioural suite for the post-process controls under a BYPASSED matrix engine.
//
// `<post_process>` nests inside `<matrix>` (hqplayerd-readme.txt §1.11.2), and
// §1.11's `enabled` is the matrix processing switch — so a matrix switched out of
// the signal path runs no post-process plugin at all. Bauer crossfeed, DAC
// correction and loudness are exactly those plugins, so while the matrix is
// bypassed every control that configures one is inert: HQPTuner grays it, says
// the matrix is bypassed, and the three cards carry the note
//
//     Matrix engine is bypassed. These settings have no effect.
//
// The matrix TABLE is a different thing and stays editable: pipeline rows and
// "+ Add pipeline" are how a user gets the engine back, so nothing here may
// touch them.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders an exported component — `Field` (through the shared field harness),
// `CrossfeedCard`, `Output`, `Volume`, `MatrixTab` — driven by the exported store
// signals carrying the daemon's own /config and /matrix forms (`enabled` is the
// daemon field behind the `matrix_enabled` schema key; the post-process fields
// are `post_bauer_*`, `post_correction_*`, `post_loudness_*`), by the exported
// crossfeed view signal (`xfMode`, lib/xfmode.js), and by `edit()` over the
// staging wire fake on the real REST paths (tests/js/support/wire.js). Nothing is
// stubbed and no module private is touched.
//
// Readings taken where the spec left room, reported in the hand-back:
//
//   * "renders disabled" is read off the rendered control tags — a field is
//     disabled when one of its controls carries the disabled attribute. The
//     element that carries it, and the caption's placement (stacked or inline),
//     are free to change; the gray reason is looked up by its class anywhere in
//     the field.
//
//   * "names the matrix being bypassed" is asserted as the reason mentioning the
//     matrix, never as an exact sentence — the wording is not the contract.
//
//   * behaviour 3's "unchanged from today" is asserted forwards rather than
//     against a snapshot of the old tree: with the matrix ENGAGED, a control
//     whose own feature gate is off must not be grayed for a matrix reason, and
//     with every gate engaged nothing is grayed at all. A literal comparison
//     against pre-change output is not available at run time.
//
//   * `grayReason(key)` (store/graying.js) is not called directly: what a user
//     meets is the rendered field, and the rendered field is where both halves of
//     the behaviour — the disabling and the reason — are observable together.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/matrix-postprocess-gating.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { CrossfeedCard } from "../../../hqptuner/static/components/Crossfeed.js";
import { MatrixTab } from "../../../hqptuner/static/components/MatrixTab.js";
import { chooseSet } from "../../../hqptuner/static/components/SpeakersCard.js";
import { Output } from "../../../hqptuner/static/components/tabs/OutputTab.js";
import { Volume } from "../../../hqptuner/static/components/tabs/VolumeTab.js";
import {
  config,
  matrixConfig,
  metadata,
  engineState,
  enums,
  volume,
  volumeRange,
} from "../../../hqptuner/static/store/signals.js";
import { speakers } from "../../../hqptuner/static/store/speakers.js";
import { dspMode } from "../../../hqptuner/static/store/dspmode.js";
import { loudnessSide } from "../../../hqptuner/static/store/ui.js";
import { xfMode, liveParams, remember } from "../../../hqptuner/static/lib/xfmode.js";
import { HEAD_RADIUS, SPEAKER_ANGLE } from "../../../hqptuner/static/lib/binaural.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions, fastVolumeUpdates } from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrowing.js";
import { plottedRows, previewEq } from "../../../hqptuner/static/components/MatrixPlot.js";
import { selectedStage } from "../../../hqptuner/static/components/BandStrip.js";
import { field, grayReason } from "../support/field-harness.js";
import { stagingWire } from "../support/wire.js";

const NOTE = "Matrix engine is bypassed. These settings have no effect.";

// --- the controls under test ---------------------------------------------------
// Each schema key with the /matrix form field behind it. The three feature gates
// come first; the rest are the controls those gates own.

const CROSSFEED_GATE = "crossfeed_enabled";
const CORRECTION_GATE = "dac_correction_enabled";
const LOUDNESS_GATE = "loudness_enabled";

const WIRE = {
  crossfeed_enabled: "post_bauer_enabled",
  crossfeed_preset: "post_bauer_preset",
  crossfeed_frequency: "post_bauer_frequency",
  crossfeed_level: "post_bauer_level",
  dac_correction_enabled: "post_correction_enabled",
  dac_correction_profile: "post_correction_dac0",
  loudness_enabled: "post_loudness_enabled",
  loudness_low_level: "post_loudness_lowlevel",
  loudness_low_freq: "post_loudness_lowfreq",
  loudness_low_steep: "post_loudness_lowsteep",
  loudness_low_type: "post_loudness_lowtype",
  loudness_high_level: "post_loudness_highlevel",
  loudness_high_freq: "post_loudness_highfreq",
  loudness_high_steep: "post_loudness_highsteep",
  loudness_high_type: "post_loudness_hightype",
  loudness_range_low: "post_loudness_rangelow",
  loudness_range_high: "post_loudness_rangehigh",
};

// The feature gate each control hangs off — its "own gate", the one that already
// grays it today.
const OWN_GATE = {
  crossfeed_preset: CROSSFEED_GATE,
  crossfeed_frequency: CROSSFEED_GATE,
  crossfeed_level: CROSSFEED_GATE,
  dac_correction_profile: CORRECTION_GATE,
  loudness_low_level: LOUDNESS_GATE,
  loudness_low_freq: LOUDNESS_GATE,
  loudness_low_steep: LOUDNESS_GATE,
  loudness_low_type: LOUDNESS_GATE,
  loudness_high_level: LOUDNESS_GATE,
  loudness_high_freq: LOUDNESS_GATE,
  loudness_high_steep: LOUDNESS_GATE,
  loudness_high_type: LOUDNESS_GATE,
  loudness_range_low: LOUDNESS_GATE,
  loudness_range_high: LOUDNESS_GATE,
};

const POST_PROCESS = Object.keys(WIRE);
const SUB_CONTROLS = Object.keys(OWN_GATE);

// --- the daemon's forms ---------------------------------------------------------
// Values as the wire strings "1"/"0"; the loudness numerics carry the min/max the
// /matrix form ships them with, so the knobs have a scale to draw on.

const LOUDNESS_NUMERICS = [
  { name: "post_loudness_lowfreq", value: "80", min: "20", max: "20000" },
  { name: "post_loudness_lowlevel", value: "-9", min: "-20", max: "20" },
  { name: "post_loudness_lowsteep", value: "7", min: "0.1", max: "10" },
  { name: "post_loudness_lowtype", value: "0" },
  { name: "post_loudness_highfreq", value: "5000", min: "20", max: "20000" },
  { name: "post_loudness_highlevel", value: "-3", min: "-20", max: "20" },
  { name: "post_loudness_highsteep", value: "4", min: "0.1", max: "10" },
  { name: "post_loudness_hightype", value: "0" },
  { name: "post_loudness_rangelow", value: "-50", min: "-90", max: "0" },
  { name: "post_loudness_rangehigh", value: "-10", min: "-90", max: "0" },
];

const matrixForm = ({ matrix, crossfeed, correction, loudness }) => [
  { name: "enabled", value: matrix },
  { name: "post_bauer_enabled", value: crossfeed },
  { name: "post_bauer_preset", value: "default" },
  { name: "post_bauer_frequency", value: "700" },
  { name: "post_bauer_level", value: "4.5" },
  { name: "post_correction_enabled", value: correction },
  { name: "post_correction_dac0", value: "" },
  { name: "post_loudness_enabled", value: loudness },
  ...LOUDNESS_NUMERICS,
];

// Device option sets, so the Output tab's DAC correction card renders against a
// device that is actually present rather than a missing-device alert.
const ALSA_DEVICES = [
  { value: "", label: "" },
  { value: "hw:0", label: "Topping DAC" },
];
const NET_DEVICES = [
  { value: "", label: "" },
  { value: "naa:1", label: "Living room NAA" },
];

// A live volume control: loudness is volume-adaptive, so a pinned volume grays it
// for a reason of its own that has nothing to do with the matrix.
const CONFIG_FORM = [
  { name: "backend", value: "alsa" },
  { name: "alsa_device", value: "hw:0", options: ALSA_DEVICES },
  { name: "net_device", value: "naa:1", options: NET_DEVICES },
  { name: "fixed_volume_enabled", value: false },
  { name: "volume_min", value: "-60" },
  { name: "volume_max", value: "0" },
  { name: "defaults_volume", value: "-20" },
];

// A stereo pipeline pair, so the matrix table has rows carrying controls.
const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });
const ROWS = [ROW({}), ROW({ source: "1", mixdown: "1" })];

// A placed speaker set in the daemon's own /speakers shape.
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
const NAMES = ["Left", "Right", "Center", "LFE", "Left rear", "Right rear", "Left side", "Right side"];

// --- reset ----------------------------------------------------------------------
// Total on every call: every module-level signal these components read outlives a
// test, so a partial reset makes cases pass alone and fail in sequence. `staged`
// is private and is cleared through discardAll().

async function reset({ matrix = "0", crossfeed = "1", correction = "1", loudness = "1", view = null } = {}) {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  volume.value = null;
  volumeRange.value = null;
  showDescriptions.value = false;
  keepOptionDescriptions.value = false;
  fastVolumeUpdates.value = false;
  loudnessSide.value = "low";
  plottedRows.value = new Set();
  previewEq.value = null;
  selectedStage.value = null;
  speakers.value = { enabled: false, channels: NAMES.map((n, i) => CH(i, n)) };
  matrixConfig.value = { fields: matrixForm({ matrix, crossfeed, correction, loudness }), rows: [] };
  config.value = {
    fields: CONFIG_FORM,
    file: { mode: "auto", matrix_pipelines: JSON.stringify(ROWS) },
    active: "",
    profiles: null,
  };
  resetNarrowing();
  await discardAll();
  dspMode.value = "headphones";
  liveParams.value = null;
  remember({ lambda: 1, angle: SPEAKER_ANGLE, headRadius: HEAD_RADIUS });
  xfMode.value = view;
  chooseSet("2.0");
}

// --- rendering --------------------------------------------------------------------
// SSR escapes entities; the contract is the text a user reads, not its encoding.

const decode = (out) =>
  out
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const crossfeed = () => decode(render(html`<${CrossfeedCard} />`));
const outputTab = () => decode(render(html`<${Output} />`));
const volumeTab = () => decode(render(html`<${Volume} />`));
const matrixTab = () => decode(render(html`<${MatrixTab} />`));

// Whether any control of a rendered field carries the disabled attribute. Which
// element carries it is not part of the contract, so all three control tags are
// looked at.
const controlTags = (out) => (out || "").match(/<(?:button|input|select)\b[^>]*>/g) || [];
const isDisabled = (out) => controlTags(out).some((tag) => /\sdisabled\b/.test(tag));

// The reason a field is grayed, wherever it is placed — null when there is none.
const reasonOf = (key) => grayReason(field(key));
const namesMatrix = (reason) => /matrix/i.test(String(reason ?? ""));

// One card's fragment, picked by the head that titles it. Cards carry no nested
// <section>, so the first close after the head is the card's own.
const cardTitled = (out, title) => {
  const head = out.indexOf(`<div class="card-head">${title}</div>`);
  return head < 0 ? "" : out.slice(head, out.indexOf("</section>", head));
};

// Whether a fragment carries the note — or a sentence saying the card was never
// rendered, which equals neither true nor false and so fails either way round.
const noteIn = (frag) => (frag === "" ? "that card was not rendered at all" : frag.includes(NOTE));

const buttonsOf = (out) =>
  out
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);
const buttonLabelled = (out, text) => buttonsOf(out).find((b) => b.slice(b.indexOf(">") + 1).trim() === text);
const attrsOf = (b) => (b === undefined ? "" : b.slice(0, b.indexOf(">")));

// ============================================================================
// a bypassed matrix grays every post-process control
// ============================================================================
// `<post_process>` lives inside `<matrix>`, so a bypassed engine runs none of
// these plugins and none of their settings can take effect.

for (const key of POST_PROCESS) {
  test(`test_a_bypassed_matrix_disables_${key}`, async () => {
    await reset({ matrix: "0" });
    assert.equal(isDisabled(field(key)), true);
  });

  test(`test_a_bypassed_matrix_tells_${key}_the_matrix_is_why`, async () => {
    await reset({ matrix: "0" });
    assert.equal(namesMatrix(reasonOf(key)), true);
  });

  // The other side: with the engine engaged and the control's own feature gate
  // engaged too, nothing gray is left.
  test(`test_an_engaged_matrix_leaves_${key}_enabled`, async () => {
    await reset({ matrix: "1" });
    assert.equal(isDisabled(field(key)), false);
  });
}

// ============================================================================
// a control's own gate is still its own
// ============================================================================
// Crossfeed's sub-controls under crossfeed bypassed, loudness's under loudness
// bypassed: an engaged matrix leaves those exactly as they were, so whatever they
// say, they do not say the matrix did it.

for (const key of SUB_CONTROLS) {
  test(`test_an_engaged_matrix_does_not_blame_the_matrix_for_a_gated_${key}`, async () => {
    await reset({ matrix: "1", crossfeed: "0", correction: "0", loudness: "0" });
    assert.equal(namesMatrix(reasonOf(key)), false);
  });

  // Both gates shut at once: the matrix is the outer one and the reason the user
  // reads is the matrix one.
  test(`test_a_bypassed_matrix_outranks_the_feature_gate_on_${key}`, async () => {
    await reset({ matrix: "0", crossfeed: "0", correction: "0", loudness: "0" });
    assert.equal(namesMatrix(reasonOf(key)), true);
  });
}

// ============================================================================
// the gate follows the EFFECTIVE value
// ============================================================================
// What the user has staged over the daemon's running value, not what the daemon
// is running: unlocking the controls costs no apply, and locking them takes none
// either. One representative control per plugin.

const REPRESENTATIVE = ["crossfeed_frequency", "dac_correction_profile", "loudness_low_level"];

for (const key of REPRESENTATIVE) {
  test(`test_staging_the_matrix_on_unlocks_${key}_with_no_apply`, async () => {
    await reset({ matrix: "0" });
    await edit("matrix_enabled", "1");
    assert.equal(isDisabled(field(key)), false);
  });

  test(`test_staging_the_matrix_off_locks_${key}_with_no_apply`, async () => {
    await reset({ matrix: "1" });
    await edit("matrix_enabled", "0");
    assert.equal(isDisabled(field(key)), true);
  });
}

// ============================================================================
// the Crossfeed card's own ENGAGE / BYPASS control
// ============================================================================
// Bauer crossfeed is `<plugin type="bauer">`; structural crossfeed is sixteen
// matrix pipeline rows. A bypassed matrix runs neither, so the card's gate is
// dead in both views.

test("test_a_bypassed_matrix_disables_the_crossfeed_gate_in_the_bauer_view", async () => {
  await reset({ matrix: "0", view: "bauer" });
  const engage = buttonLabelled(crossfeed(), "ENGAGE");
  assert.ok(
    engage !== undefined && /\sdisabled\b/.test(attrsOf(engage)),
    engage === undefined ? "no ENGAGE control was rendered in the Bauer view" : "ENGAGE rendered enabled",
  );
});

test("test_a_bypassed_matrix_disables_the_crossfeed_gate_in_the_structural_view", async () => {
  await reset({ matrix: "0", view: "structural" });
  const engage = buttonLabelled(crossfeed(), "ENGAGE");
  assert.ok(
    engage !== undefined && /\sdisabled\b/.test(attrsOf(engage)),
    engage === undefined ? "no ENGAGE control was rendered in the Structural view" : "ENGAGE rendered enabled",
  );
});

// ============================================================================
// the note on the three post-process cards
// ============================================================================

test("test_a_bypassed_matrix_tells_the_bauer_crossfeed_view_its_settings_are_inert", async () => {
  await reset({ matrix: "0", view: "bauer" });
  assert.equal(crossfeed().includes(NOTE), true);
});

test("test_a_bypassed_matrix_tells_the_dac_correction_card_its_settings_are_inert", async () => {
  await reset({ matrix: "0" });
  assert.equal(noteIn(cardTitled(outputTab(), "DAC correction")), true);
});

test("test_a_bypassed_matrix_tells_the_loudness_card_its_settings_are_inert", async () => {
  await reset({ matrix: "0" });
  assert.equal(noteIn(cardTitled(volumeTab(), "Loudness")), true);
});

test("test_an_engaged_matrix_leaves_the_bauer_crossfeed_view_without_the_note", async () => {
  await reset({ matrix: "1", view: "bauer" });
  assert.equal(crossfeed().includes(NOTE), false);
});

test("test_an_engaged_matrix_leaves_the_dac_correction_card_without_the_note", async () => {
  await reset({ matrix: "1" });
  assert.equal(noteIn(cardTitled(outputTab(), "DAC correction")), false);
});

test("test_an_engaged_matrix_leaves_the_loudness_card_without_the_note", async () => {
  await reset({ matrix: "1" });
  assert.equal(noteIn(cardTitled(volumeTab(), "Loudness")), false);
});

// ============================================================================
// the matrix table itself stays editable
// ============================================================================
// The pipeline rows are how a user gets the engine back, so gating the
// post-process plugins may not reach them. Asserted as the difference between a
// bypassed and an engaged engine being nil, over rows proved to be there and to
// carry controls.

const pipelinesCard = (out) => {
  const at = out.indexOf("Pipelines");
  const start = out.lastIndexOf('<section class="card', at);
  return at < 0 || start < 0 ? "" : out.slice(start, out.indexOf("</section>", at));
};
const rowsOf = (out) => out.split('<div class="mtx-row ').slice(1);
const rowControlStates = (out) =>
  rowsOf(pipelinesCard(out)).map((row) => controlTags(row).map((tag) => /\sdisabled\b/.test(tag)));

test("test_a_bypassed_matrix_leaves_pipeline_row_controls_exactly_as_they_are", async () => {
  await reset({ matrix: "0" });
  const bypassed = rowControlStates(matrixTab());
  await reset({ matrix: "1" });
  const engaged = rowControlStates(matrixTab());
  assert.ok(
    bypassed.length === ROWS.length &&
      bypassed.every((row) => row.length > 0) &&
      JSON.stringify(bypassed) === JSON.stringify(engaged),
    `bypassed rows ${JSON.stringify(bypassed)} vs engaged rows ${JSON.stringify(engaged)}`,
  );
});

test("test_a_bypassed_matrix_leaves_add_pipeline_enabled", async () => {
  await reset({ matrix: "0" });
  const add = buttonsOf(pipelinesCard(matrixTab())).find((b) => b.includes("Add pipeline"));
  assert.ok(
    add !== undefined && !/\sdisabled\b/.test(attrsOf(add)),
    add === undefined ? "no + Add pipeline button was rendered" : "+ Add pipeline rendered disabled",
  );
});
