// Behavioural suite for the post-process controls under a BYPASSED matrix engine.
//
// `<post_process>` nests inside `<matrix>` (hqplayerd-readme.txt §1.11.2), and
// §1.11's `enabled` is the matrix processing switch — so a matrix switched out of
// the signal path runs no post-process plugin at all. Bauer crossfeed, DAC
// correction and loudness are exactly those plugins, so while the matrix is
// bypassed every control that configures one is inert: HQPTuner grays it, and
// the three cards carry the note
//
//     Matrix engine is bypassed. These settings have no effect.
//
// The CARD-LEVEL note forks on the card's own feature switch. A user who has
// crossfeed, DAC correction or loudness switched off is not told that settings
// they are not using have no effect — their card reads the other sentence
// instead, which explains the grayed controls by pointing at the engine:
//
//     A: Matrix engine is bypassed. These settings have no effect.
//     B: Matrix engine is bypassed. Engage it to use this feature.
//
// The graying below is a different thing and is NOT conditional on the feature
// switch — a bypassed matrix disables every post-process control and puts
// sentence A on every hover title, own gate shut or not.
//
// That card-level note is the ONLY place the sentence appears as visible text:
// no field repeats it in a ".field-gray-reason" caption. The sub-controls
// (quietGray) carry it as their hover title instead, where it outranks any
// own-gate reason when both gates are shut.
//
// The matrix TABLE is a different thing and stays editable: pipeline rows and
// "+ Add pipeline" are how a user gets the engine back, so nothing here may
// touch them.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders an exported component — `Field` (through the shared field harness),
// `CrossfeedCard`, `Output`, `Volume` — driven by the exported store
// signals carrying the daemon's own /config and /matrix forms (`enabled` is the
// daemon field behind the `matrix_enabled` schema key; the post-process fields
// are `post_bauer_*`, `post_correction_*`, `post_loudness_*`), by the exported
// crossfeed view signal (`xfMode`, store/xfmode.js), and by `edit()` over the
// staging wire fake on the real REST paths (tests/js/support/wire.js). Nothing is
// stubbed and no module private is touched.
//
// Readings taken where the spec left room, reported in the hand-back:
//
//   * "renders disabled" is read off the rendered control tags — a field is
//     disabled when one of its controls carries the disabled attribute; which
//     element carries it is free to change, as is any caption's placement.
//
//   * caption ABSENCE is asserted as no gray-reason element at all: with every
//     feature gate engaged no other reason exists, so an empty lookup is the
//     whole behaviour and a caption in different words would still be the defect.
//
//   * the hover title is asserted to contain the note verbatim — the spec quotes
//     the sentence, so there (unlike own-gate reasons) wording IS the contract.
//
//   * "unchanged from today" is asserted forwards, not against a snapshot: with
//     the matrix ENGAGED, an own-gated control must not blame the matrix, must
//     still be disabled, and must still offer its own reason on hover (these
//     fields are quietGray); with every gate engaged nothing is grayed at all.
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
import { matrixMode } from "../../../hqptuner/static/store/matrixmode.js";
import { loudnessSide } from "../../../hqptuner/static/store/ui.js";
import { xfMode, liveParams, remember } from "../../../hqptuner/static/store/xfmode.js";
import { HEAD_RADIUS, SPEAKER_ANGLE } from "../../../hqptuner/static/lib/binaural/geometry.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions, fastVolumeUpdates } from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrowing.js";
import { plottedRows, previewEq } from "../../../hqptuner/static/components/MatrixPlot.js";
import { selectedStage } from "../../../hqptuner/static/components/BandStrip.js";
import { field, grayReason, titleOf } from "../support/field-harness.js";
import { stagingWire } from "../support/wire.js";

const NOTE = "Matrix engine is bypassed. These settings have no effect.";
const ENGAGE_NOTE = "Matrix engine is bypassed. Engage it to use this feature.";

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
// grays it today. Keyed by schema key, which is how `SUB_CONTROLS` reads it back.
/** @type {Record<string, string>} */
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

// Reset options that shut exactly one control's OWN gate and leave the other two
// engaged, so whatever grays that control is the gate it hangs off and nothing
// else. Spread over a `matrix` of the case's choosing.
/** @param {string} key */
const ownGateShut = (key) => ({
  crossfeed: OWN_GATE[key] === CROSSFEED_GATE ? "0" : "1",
  correction: OWN_GATE[key] === CORRECTION_GATE ? "0" : "1",
  loudness: OWN_GATE[key] === LOUDNESS_GATE ? "0" : "1",
});

// Of those, the ones behaviour 3's "a control WITH a gate of its own" is about:
// the DAC correction dropdown has never grayed when its feature switch is off, so
// it has no own-gate state for an engaged matrix to leave alone. It stays covered
// by the matrix-gate cases like every other key.
const OWN_GATED = SUB_CONTROLS.filter((key) => key !== "dac_correction_profile");

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

/**
 * @param {{ matrix: string, crossfeed: string, correction: string, loudness: string }} gates
 */
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

// A live (unpinned) volume control on a present device, so the Volume tab renders
// its loudness card and the Output tab its DAC correction card against a working
// output rather than a missing-device alert.
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
/** @typedef {import("../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow */

/** @param {Partial<PipelineRow>} patch */
const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });
const ROWS = [ROW({}), ROW({ source: "1", mixdown: "1" })];

// A placed speaker set in the daemon's own /speakers shape.
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
const NAMES = ["Left", "Right", "Center", "LFE", "Left rear", "Right rear", "Left side", "Right side"];

// --- reset ----------------------------------------------------------------------
// Total on every call: every module-level signal these components read outlives a
// test, so a partial reset makes cases pass alone and fail in sequence. `staged`
// is private and is cleared through discardAll().

/**
 * @param {{
 *   matrix?: string,
 *   crossfeed?: string,
 *   correction?: string,
 *   loudness?: string,
 *   view?: string | null,
 * }} [fixture]
 * @returns {Promise<void>}
 */
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
  matrixMode.value = "headphones";
  liveParams.value = null;
  remember({ lambda: 1, angle: SPEAKER_ANGLE, headRadius: HEAD_RADIUS });
  xfMode.value = view;
  chooseSet("2.0");
}

// --- rendering --------------------------------------------------------------------
// SSR escapes entities; the contract is the text a user reads, not its encoding.

/** @param {string} out */
const decode = (out) =>
  out
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const crossfeed = () => decode(render(html`<${CrossfeedCard} />`));
const outputTab = () => decode(render(html`<${Output} />`));
const volumeTab = () => decode(render(html`<${Volume} />`));

// Whether any control of a rendered field carries the disabled attribute. Which
// element carries it is not part of the contract, so all three control tags are
// looked at.
/** @param {string} out */
const controlTags = (out) => (out || "").match(/<(?:button|input|select)\b[^>]*>/g) || [];
/** @param {string} out */
const isDisabled = (out) => controlTags(out).some((tag) => /\sdisabled\b/.test(tag));

// The reason a field is grayed, wherever it is placed — null when there is none.
/** @param {string} key */
const reasonOf = (key) => grayReason(field(key));
/** @param {string | null | undefined} reason */
const namesMatrix = (reason) => /matrix/i.test(String(reason ?? ""));

// One card's fragment, picked by the head that titles it. Cards carry no nested
// <section>, so the first close after the head is the card's own.
/**
 * @param {string} out
 * @param {string} title
 */
const cardTitled = (out, title) => {
  const head = out.indexOf(`<div class="card-head">${title}</div>`);
  return head < 0 ? "" : out.slice(head, out.indexOf("</section>", head));
};

// Which of the two sentences a card SHOWS — named rather than asked about one at
// a time, so a single assertion pins the presence of the sentence that belongs
// there AND the absence of the one that does not. An implementation that shows
// both, or that shows A where B belongs, answers something other than the
// expected name and fails.
//
// Text nodes only. Sentence A also appears under a bypassed matrix as the hover
// TITLE of every grayed sub-control — the separate, unchanged behaviour the cases
// above pin — and an attribute value is not something the user reads off the
// card. Every tag is replaced by a separator rather than deleted, so neighbouring
// text nodes cannot fuse into a sentence that was never shown; which element
// carries the note stays outside the contract.
/** @param {string} frag */
const shownText = (frag) => frag.replace(/<[^<>]*>/g, " ");
/**
 * @param {string} frag
 * @returns {"A" | "B" | "both" | "neither" | string}
 */
const sentenceIn = (frag) => {
  if (frag === "") return "that card was not rendered at all";
  const shown = shownText(frag);
  const a = shown.includes(NOTE);
  const b = shown.includes(ENGAGE_NOTE);
  if (a && b) return "both";
  return a ? "A" : b ? "B" : "neither";
};

// The Crossfeed card is rendered on its own, so there is no head to pick it out
// by — an empty render is the "never rendered" case, and answers the same
// non-name sentence so a negative case cannot pass by looking at nothing.
/** @returns {string} */
const crossfeedSentence = () => sentenceIn(crossfeed().trim());

/** @param {string} out */
const buttonsOf = (out) =>
  out
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);
/**
 * @param {string} out
 * @param {string} text
 */
const buttonLabelled = (out, text) => buttonsOf(out).find((b) => b.slice(b.indexOf(">") + 1).trim() === text);
/** @param {string | undefined} b */
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

  // The card already says the sentence; no field repeats it as a caption. With
  // every feature gate engaged no other reason exists either, so the field
  // renders no gray-reason caption at all.
  test(`test_a_bypassed_matrix_renders_no_caption_on_${key}`, async () => {
    await reset({ matrix: "0" });
    assert.equal(reasonOf(key), null);
  });

  // Same surface under a STAGED bypass — no apply, still no caption.
  test(`test_a_staged_matrix_bypass_renders_no_caption_on_${key}`, async () => {
    await reset({ matrix: "1" });
    await edit("matrix_enabled", "0");
    assert.equal(reasonOf(key), null);
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
  // These fields are quietGray, so their reason lives on the hover title — the
  // caption is empty either way and cannot carry the blame.
  test(`test_an_engaged_matrix_does_not_blame_the_matrix_for_a_gated_${key}`, async () => {
    await reset({ matrix: "1", ...ownGateShut(key) });
    assert.equal(namesMatrix(titleOf(field(key))), false);
  });

  // These sub-controls are quietGray: their reason is the hover title, not a
  // caption, and under a bypassed matrix that title carries the card's sentence.
  // This suite loads no metadata, so any title the field carries is that reason
  // and nothing else.
  test(`test_a_bypassed_matrix_puts_its_sentence_on_the_hover_title_of_${key}`, async () => {
    await reset({ matrix: "0" });
    const title = titleOf(field(key));
    assert.ok(
      title !== undefined && title.includes(NOTE),
      `hover title under a bypassed matrix: ${JSON.stringify(title)}`,
    );
  });

  // And under a STAGED bypass — same sentence, same title, no apply.
  test(`test_a_staged_matrix_bypass_puts_its_sentence_on_the_hover_title_of_${key}`, async () => {
    await reset({ matrix: "1" });
    await edit("matrix_enabled", "0");
    const title = titleOf(field(key));
    assert.ok(
      title !== undefined && title.includes(NOTE),
      `hover title under a staged bypass: ${JSON.stringify(title)}`,
    );
  });

  // Both gates shut at once: the matrix is the outer one and the hover title the
  // user reads is the matrix one — the SAME sentence the control gets when only
  // the matrix is bypassed, which a title carrying the own-gate reason (alone or
  // concatenated onto the matrix one) cannot equal.
  test(`test_a_bypassed_matrix_outranks_the_feature_gate_on_${key}`, async () => {
    await reset({ matrix: "0", ...ownGateShut(key) });
    const bothShut = titleOf(field(key));
    await reset({ matrix: "0", crossfeed: "1", correction: "1", loudness: "1" });
    const matrixOnly = titleOf(field(key));
    assert.ok(
      bothShut !== undefined && bothShut === matrixOnly && bothShut.includes(NOTE),
      `hover title with the own gate shut ${JSON.stringify(bothShut)} vs with it engaged ${JSON.stringify(matrixOnly)}`,
    );
  });
}

// ============================================================================
// an engaged matrix leaves an own-gated control exactly as gated as it was
// ============================================================================
// The other half of "unchanged from today": engaging the matrix may not hand a
// control back that its own feature gate is holding. These fields are quietGray,
// so their reason is not a caption — it is the hover title (pinned as its own
// behaviour in fielddesc.test.js); this suite loads no metadata, so any title such
// a field carries is that reason and nothing else.

for (const key of OWN_GATED) {
  test(`test_an_engaged_matrix_leaves_a_gated_${key}_disabled_by_its_own_gate`, async () => {
    await reset({ matrix: "1", ...ownGateShut(key) });
    assert.equal(isDisabled(field(key)), true);
  });

  test(`test_an_engaged_matrix_leaves_a_gated_${key}_a_reason_of_its_own_on_hover`, async () => {
    await reset({ matrix: "1", ...ownGateShut(key) });
    const title = titleOf(field(key));
    assert.ok(
      title !== undefined && title.trim() !== "" && !namesMatrix(title),
      `gated ${key} offers no reason of its own on hover: ${JSON.stringify(title)}`,
    );
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
// A bypassed engine always leaves a note; the card's own feature switch picks
// which of the two sentences it is.

test("test_a_bypassed_matrix_tells_an_engaged_bauer_crossfeed_view_its_settings_are_inert", async () => {
  await reset({ matrix: "0", crossfeed: "1", view: "bauer" });
  assert.equal(crossfeedSentence(), "A");
});

test("test_a_bypassed_matrix_tells_an_engaged_dac_correction_card_its_settings_are_inert", async () => {
  await reset({ matrix: "0", correction: "1" });
  assert.equal(sentenceIn(cardTitled(outputTab(), "DAC correction")), "A");
});

test("test_a_bypassed_matrix_tells_an_engaged_loudness_card_its_settings_are_inert", async () => {
  await reset({ matrix: "0", loudness: "1" });
  assert.equal(sentenceIn(cardTitled(volumeTab(), "Loudness")), "A");
});

// The other fork: a feature the user has switched off has no settings in the
// signal path to call inert, but its controls are grayed on screen all the same —
// so the card explains that by pointing at the engine instead.

test("test_a_bypassed_matrix_asks_a_bypassed_bauer_crossfeed_view_to_engage_it", async () => {
  await reset({ matrix: "0", crossfeed: "0", view: "bauer" });
  assert.equal(crossfeedSentence(), "B");
});

test("test_a_bypassed_matrix_asks_a_bypassed_dac_correction_card_to_engage_it", async () => {
  await reset({ matrix: "0", correction: "0" });
  assert.equal(sentenceIn(cardTitled(outputTab(), "DAC correction")), "B");
});

test("test_a_bypassed_matrix_asks_a_bypassed_loudness_card_to_engage_it", async () => {
  await reset({ matrix: "0", loudness: "0" });
  assert.equal(sentenceIn(cardTitled(volumeTab(), "Loudness")), "B");
});

// An engaged engine silences BOTH sentences, whatever the feature switches say.

test("test_an_engaged_matrix_leaves_the_bauer_crossfeed_view_without_either_sentence", async () => {
  await reset({ matrix: "1", crossfeed: "1", view: "bauer" });
  assert.equal(crossfeedSentence(), "neither");
});

test("test_an_engaged_matrix_leaves_the_dac_correction_card_without_either_sentence", async () => {
  await reset({ matrix: "1", correction: "1" });
  assert.equal(sentenceIn(cardTitled(outputTab(), "DAC correction")), "neither");
});

test("test_an_engaged_matrix_leaves_the_loudness_card_without_either_sentence", async () => {
  await reset({ matrix: "1", loudness: "1" });
  assert.equal(sentenceIn(cardTitled(volumeTab(), "Loudness")), "neither");
});

test("test_an_engaged_matrix_leaves_a_bypassed_bauer_crossfeed_view_without_either_sentence", async () => {
  await reset({ matrix: "1", crossfeed: "0", view: "bauer" });
  assert.equal(crossfeedSentence(), "neither");
});

test("test_an_engaged_matrix_leaves_a_bypassed_dac_correction_card_without_either_sentence", async () => {
  await reset({ matrix: "1", correction: "0" });
  assert.equal(sentenceIn(cardTitled(outputTab(), "DAC correction")), "neither");
});

test("test_an_engaged_matrix_leaves_a_bypassed_loudness_card_without_either_sentence", async () => {
  await reset({ matrix: "1", loudness: "0" });
  assert.equal(sentenceIn(cardTitled(volumeTab(), "Loudness")), "neither");
});

// ============================================================================
// the wording follows the EFFECTIVE feature switch
// ============================================================================
// The staged edit over the daemon's running value, no apply involved: switching a
// feature on under a bypassed engine swaps its note from B to A, switching it off
// swaps it back.

test("test_staging_dac_correction_on_under_a_bypassed_matrix_swaps_its_note_to_the_settings_wording", async () => {
  await reset({ matrix: "0", correction: "0" });
  await edit(CORRECTION_GATE, "1");
  assert.equal(sentenceIn(cardTitled(outputTab(), "DAC correction")), "A");
});

test("test_staging_dac_correction_off_under_a_bypassed_matrix_swaps_its_note_to_the_engage_wording", async () => {
  await reset({ matrix: "0", correction: "1" });
  await edit(CORRECTION_GATE, "0");
  assert.equal(sentenceIn(cardTitled(outputTab(), "DAC correction")), "B");
});

test("test_staging_loudness_on_under_a_bypassed_matrix_swaps_its_note_to_the_settings_wording", async () => {
  await reset({ matrix: "0", loudness: "0" });
  await edit(LOUDNESS_GATE, "1");
  assert.equal(sentenceIn(cardTitled(volumeTab(), "Loudness")), "A");
});

test("test_staging_loudness_off_under_a_bypassed_matrix_swaps_its_note_to_the_engage_wording", async () => {
  await reset({ matrix: "0", loudness: "1" });
  await edit(LOUDNESS_GATE, "0");
  assert.equal(sentenceIn(cardTitled(volumeTab(), "Loudness")), "B");
});

// The matrix table staying editable under a bypass (pipeline rows, "+ Add
// pipeline") is pinned by matrix-bypass-note.test.js and not repeated here.
