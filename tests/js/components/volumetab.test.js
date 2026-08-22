// Behavioral suite for components/tabs/VolumeTab.js — the Volume tab's rendered
// contract: the live knob paired with the fixed-volume card, the range bar, the
// adjustments card, and the Loudness card's dimming rule.
//
// Policy (docs/testing.md): public API only, one assertion per test.
// `LoudnessCard` is private and stays that way — every case here goes through
// the exported `Volume`, driven by the exported store signals (`config` and
// `matrixConfig` carrying the daemon's own /config and /matrix forms, `volume` /
// `volumeRange` carrying the live level) over a faked wire on the real REST
// paths. Nothing is stubbed.
//
// The Loudness body's dimming is the one piece of logic this tab owns: it is
// off when the feature is disabled OR when the volume control is bypassed, since
// volume-adaptive loudness cannot adapt to a pinned volume. Both arms are pure
// functions of exported signals, so both are covered.
//
// NOT covered here: the knob, the range bar and each Field's own rendering.
// Those are contracts of their own components and are covered in
// playbackvolume.test.js, volumerangebar.test.js and field.test.js; the cases
// below assert only that this tab places them, not how they draw.
//
// State reset is total on every call: module-level signals outlive a test, so a
// partial reset makes cases pass alone and fail in sequence.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/volumetab.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
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
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { stagingWire } from "../support/wire.js";
import { cardHeadAt, section } from "../support/tabform.js";
import { attr, classes, elements } from "../support/markup.js";

// The daemon's own forms, keyed by FORM FIELD name — the volume range is
// volume_min / volume_max, loudness is post_loudness_enabled on /matrix.
/**
 * One field's spec on this tab: a level in dBFS, or a gate's on/off state.
 *
 * @typedef {string | boolean} FieldSpec
 */

/** @param {Record<string, FieldSpec>} spec */
const formFields = (spec) => Object.entries(spec).map(([name, value]) => ({ name, value }));

// A volume control that is live: a real range, nothing fixing or bypassing it.
const FREE = { volume_min: "-60", volume_max: "0", defaults_volume: "-20", fixed_volume_enabled: false };

/** @param {{ cfg?: Record<string, FieldSpec>, mtx?: Record<string, FieldSpec> }} [opts] */
async function reset({ cfg = FREE, mtx = {} } = {}) {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  volume.value = null;
  volumeRange.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  // matrix engaged unless a case says otherwise: a bypassed matrix grays the whole
  // post-process chain, loudness included, which is a different behavior
  matrixConfig.value = { fields: formFields({ enabled: true, ...mtx }) };
  config.value = { fields: formFields(cfg), file: {}, active: "", profiles: null };
  await discardAll();
}

const tab = () => render(html`<${Volume} />`);

// One card's fragment, keyed by the `data-card` its <section> carries — the
// card's own machine identity, never the words in its head (docs/testing.md
// rule 9).
const card = section;

// A gate renders as a two-choice segmented strip. Its options are read off the
// `data-v` each button carries — the wire values of the gate's boolean field —
// never off the words on them.
/** @param {string} s */
const segmentValues = (s) =>
  elements(s)
    .filter((el) => el.name === "button" && classes(el).includes("seg"))
    .sort((a, b) => a.start - b.start)
    .map((el) => attr(el, "data-v"));

// The two states a boolean gate offers, ON first (the convention
// conversioncards.test.js pins for `direct_sdm`, which offers "0" then "1").
const GATE_ON = "1";
const GATE_OFF = "0";

const LOUDNESS = "loudness";
const FIXED_VOLUME = "fixed-volume";
const ADJUSTMENTS = "adjustments";
const PLAYBACK = "playback-volume";
// The auto-headroom control, by the schema key its field wears in `data-k` —
// `optimal_iso`, the SCHEMA key, not the `volume_fixed` wire field behind it.
const AUTO_HEADROOM = 'data-k="optimal_iso"';
const DIMMED = 'class="dsp-body off"';
const ON = { post_loudness_enabled: true };
const OFF = { post_loudness_enabled: false };
// Fixed volume bypasses the live volume control, which is what gates loudness.
const FIXED = { ...FREE, fixed_volume_enabled: true };

// --- the cards this tab lays out ----------------------------------------------

test("test_the_playback_knob_leads_the_tab", async () => {
  await reset();
  assert.ok(cardHeadAt(tab(), PLAYBACK) >= 0);
});

test("test_the_fixed_volume_card_carries_auto_headroom", async () => {
  await reset();
  assert.ok(card(tab(), FIXED_VOLUME).includes(AUTO_HEADROOM));
});

test("test_the_fixed_volume_cards_first_segmented_strip_offers_on_then_off", async () => {
  await reset();
  assert.deepEqual(segmentValues(card(tab(), FIXED_VOLUME)).slice(0, 2), [GATE_ON, GATE_OFF]);
});

// The gate and the dBFS level share one row: inside the fxv-row container the
// gate strip renders first and the level field second. The level is identified
// by its own dBFS unit span, not by any bare <input>, and it must land before
// the Auto headroom row that follows the shared row (position pinned by the
// neighboring test below) — so a level rendered above the gate or outside the
// row fails.
test("test_the_fixed_volume_gate_and_level_share_one_row_gate_first", async () => {
  await reset();
  const body = card(tab(), FIXED_VOLUME);
  const marks = ['<div class="fxv-row">', '<span class="segment">', '<span class="unit">dBFS</span>', AUTO_HEADROOM];
  const at = marks.map((m) => body.indexOf(m));
  assert.ok(at[0] >= 0 && at[0] < at[1] && at[1] < at[2] && at[2] < at[3]);
});

// DELETED: "the fixed volume row is named fixed level". The name column's
// wording is copy end to end (docs/testing.md rule 9) and no state stands behind
// it; the count below still holds the card to exactly two labelled rows.

// The level renders no <label> of its own — the card carries exactly two labels,
// the shared row's and Auto headroom's, and nothing else.
test("test_the_fixed_volume_level_carries_no_label_of_its_own", async () => {
  await reset();
  assert.equal((card(tab(), FIXED_VOLUME).match(/<label[\s>]/g) || []).length, 2);
});

test("test_the_auto_headroom_row_follows_the_shared_fixed_level_row", async () => {
  await reset();
  const body = card(tab(), FIXED_VOLUME);
  const at = ['<div class="fxv-row">', AUTO_HEADROOM].map((m) => body.indexOf(m));
  assert.ok(at[0] >= 0 && at[0] < at[1]);
});

// The old indented layout is gone from this card entirely.
test("test_the_fixed_volume_card_has_no_indented_layout", async () => {
  await reset();
  assert.equal(card(tab(), FIXED_VOLUME).includes('<div class="indent'), false);
});

test("test_the_volume_range_bar_stands_on_the_tab", async () => {
  await reset();
  assert.ok(tab().includes("vr-card"));
});

// The reorganization renamed the card and moved the PCM gain compensation in
// from the Output tab. Membership is pinned as the card's own field keys — a
// stray fourth control or a missing third fails, and the moved control is named
// by the schema key it wears rather than by its label.
/** @param {string} frag */
const keysOf = (frag) => [...frag.matchAll(/data-k="([^"]*)"/g)].map((m) => m[1]);

test("test_the_adjustments_card_carries_exactly_three_controls_including_the_moved_gain_compensation", async () => {
  await reset();
  const keys = keysOf(card(tab(), ADJUSTMENTS));
  assert.deepEqual(
    { count: keys.length, moved: keys.includes("gain_comp"), adaptive: keys.includes("adaptive_volume") },
    { count: 3, moved: true, adaptive: true },
  );
});

// DELETED: "no card is titled Automatic any more". The card is addressed by its
// id now, and no id `automatic` exists to be absent — an absence assertion
// against a literal nothing in the tree carries constrains nothing.

// --- loudness -----------------------------------------------------------------

test("test_the_loudness_body_is_dimmed_while_loudness_is_off", async () => {
  await reset({ mtx: OFF });
  assert.ok(card(tab(), LOUDNESS).includes(DIMMED));
});

test("test_the_loudness_body_is_live_once_loudness_is_on", async () => {
  await reset({ mtx: ON });
  assert.equal(card(tab(), LOUDNESS).includes(DIMMED), false);
});

test("test_the_loudness_body_stays_dimmed_while_the_volume_control_is_bypassed", async () => {
  await reset({ cfg: FIXED, mtx: ON });
  assert.ok(card(tab(), LOUDNESS).includes(DIMMED));
});

test("test_the_loudness_enable_stays_outside_the_dimmed_body", async () => {
  await reset({ mtx: OFF });
  assert.deepEqual(segmentValues(card(tab(), LOUDNESS).split(DIMMED)[0]).slice(0, 2), [GATE_ON, GATE_OFF]);
});

test("test_the_loudness_strip_rules_between_its_knobs", async () => {
  await reset({ mtx: ON });
  assert.ok(card(tab(), LOUDNESS).includes('<span class="col-rule" aria-hidden="true"></span>'));
});

test("test_the_loudness_card_carries_the_loudness_range", async () => {
  await reset({ mtx: ON });
  assert.ok(card(tab(), LOUDNESS).includes('data-k="loudness_range_low"'));
});

test("test_the_loudness_card_plots_the_shelving_it_applies", async () => {
  await reset({ mtx: ON });
  assert.ok(card(tab(), LOUDNESS).includes('<div class="dsp-plot">'));
});
