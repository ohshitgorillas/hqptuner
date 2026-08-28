// Behavioral suite for the limited-SNR modulator guard on edit().
//
// Two SDM modulators in the shipped shapers overlay carry a structural flag
// saying they need an EXTERNAL volume control (hqptuner/data/shapers.json,
// sdm_modulators: AHM5EC5L and AHM7EC5L). Combining one of those with a LIVE
// HQPlayer volume control is the dangerous state, so an edit that would create
// it does not stage straight away: a question opens on the ask signal, the edit
// stages on confirm, and a decline stages nothing at all. Both directions of
// the combination are guarded — staging the modulator while the volume is
// live, and un-pinning the volume while such a modulator is selected.
//
// "Live" is the negation of pinned: the volume is pinned when
// `fixed_volume_enabled` is truthy, or `optimal_iso` (wire field
// `volume_fixed`, readme §1.2, XML domain 0=off / 1=-3 dB / 2=-6 dB, and the
// /config form's bare checkbox bool means "1") sits at any non-zero level, or
// `volume_min` and `volume_max` are both 0 — plus Direct SDM, which disables
// volume control outright. Any one of those makes the pairing harmless and the
// edit stages question-free.
//
// The flag itself is never faked here: the REAL shipped overlay is seeded into
// the /api/metadata signal, so a test claiming a name is flagged is claiming it
// about the data that ships. `fixture()` throws rather than asserts when a name
// this suite names is missing from that data — a fixture that failed to set up
// makes every case below vacuous, which is a broken fixture and not a broken
// behavior.
//
// Everything is driven through the real edit() against a staging wire
// (docs/testing.md rule 4); the question is driven through the public ask
// surface (question / answer / cancel), and staged values are read back through
// effective(), the resolver every caller uses. No store function is stubbed.
// A guarded edit() does not resolve until its question is answered, so these
// tests hold the promise, drive the question, then await — never the reverse.
//
// The two dialog strings are owner copy (docs/testing.md rule 9): these cases
// assert that a question is or is not there, which setting it names as its
// owner, and what did or did not stage — never a word of either sentence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/snrguard.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit, lastApply } from "../../../hqptuner/static/store/actions.js";
import { question, answer, cancel } from "../../../hqptuner/static/store/ask.js";
import { effective } from "../../../hqptuner/static/store/resolve.js";
import { stagingWire, quiesce } from "../support/wire.js";

// The shipped overlay, whole and unedited: the same payload /api/metadata
// serves the frontend under `shapers`.
const SHAPERS = JSON.parse(readFileSync(new URL("../../../hqptuner/data/shapers.json", import.meta.url), "utf8"));

// The two flagged names, and two plainly different ones to stand for every
// modulator that is not flagged.
const AHM5 = "AHM5EC5L";
const AHM7 = "AHM7EC5L";
const PLAIN = "DSD7";
const PLAIN2 = "ASDM7EC-super";

// The enumeration the /config form offers for `modulator`, in the form's own
// shape: an index string per row, carrying the engine's name as its label.
const MODULATORS = [
  { value: "0", label: PLAIN },
  { value: "1", label: AHM5 },
  { value: "2", label: AHM7 },
  { value: "3", label: PLAIN2 },
];
const PLAIN_V = "0";
const AHM5_V = "1";
const AHM7_V = "2";
const PLAIN2_V = "3";

/**
 * One /config form field: the form answers a checkbox with a real bool, an
 * enumeration with an index string plus its rows, and everything else with a
 * string.
 *
 * @typedef {{ [key: string]: unknown, name: string, value: unknown }} FormField
 */

// A volume nothing pins: both fixed mechanisms off, a real travel range, and
// Direct SDM off. Every pinned state below is this list with ONE entry moved,
// so the entry that moved is the only thing that can account for the silence.
/** @type {FormField[]} */
const LIVE_VOLUME = [
  { name: "fixed_volume_enabled", value: false },
  { name: "volume_fixed", value: false },
  { name: "volume_min", value: "-60" },
  { name: "volume_max", value: "0" },
  { name: "direct_sdm", value: false },
];

// The same live volume with the optimal_iso field absent from the form, for the
// one case whose truth lives in the config file: the form's bare checkbox
// cannot spell "2", so a case about the -6 dB level must not also carry a form
// field claiming the feature is off.
/** @type {FormField[]} */
const LIVE_VOLUME_WITHOUT_OPTIMAL_ISO = LIVE_VOLUME.filter((f) => f.name !== "volume_fixed");

/**
 * The same field list with one field's value replaced.
 *
 * @param {FormField[]} fields
 * @param {string} name
 * @param {unknown} value
 * @returns {FormField[]}
 */
const patch = (fields, name, value) => fields.map((f) => (f.name === name ? { ...f, value } : f));

// The volume pinned by its range alone: min and max both 0, so the control has
// nowhere to travel. Both the baseline and the un-pinning edit on this path are
// plain strings, which is what makes it the readable case to stage against.
/** @type {FormField[]} */
const ZERO_RANGE_VOLUME = patch(patch(LIVE_VOLUME, "volume_min", "0"), "volume_max", "0");

// --- fixture -----------------------------------------------------------------

// Total reset: module-level signals outlive a test file, so a partial reset
// makes cases pass alone and fail in sequence. `staged` is private and is
// cleared through discardAll().
/**
 * @param {{ modulator: string, volume?: FormField[], file?: Record<string, string> }} state
 * @returns {Promise<import("../support/wire.js").StagingWire>}
 */
async function fixture({ modulator, volume = LIVE_VOLUME, file = {} }) {
  for (const name of [AHM5, AHM7, PLAIN, PLAIN2]) {
    if (!(name in (SHAPERS.sdm_modulators || {}))) {
      throw new Error(`shapers.json carries no sdm_modulators entry named ${name}: the cases below cannot bite`);
    }
  }
  const w = stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = { settings: {}, filters: { filters: {}, aliases: {} }, shapers: SHAPERS };
  config.value = {
    fields: [{ name: "modulator", value: modulator, options: MODULATORS }, ...volume],
    file,
    active: "",
    profiles: null,
  };
  matrixConfig.value = { fields: [], active: "[Default]" };
  lastApply.value = null;
  cancel();
  await discardAll();
  return w;
}

// Fire an edit without awaiting it and let the wire go quiet, so the suite can
// look at the question (or its absence) while the edit is still in flight. The
// held promise comes back boxed — an async function returning it bare would
// adopt it and never resolve while the question is open. Every test awaits the
// held edit after closing its question, so a guard that never resolves shows up
// as a hang rather than as a silent leak.
/**
 * @param {import("../support/wire.js").StagingWire} w
 * @param {string} key
 * @param {string | boolean} value
 */
async function stage(w, key, value) {
  const held = edit(key, value);
  await quiesce(w);
  return { held };
}

// --- forward: staging a flagged modulator while the volume is live -----------

test("test_staging_a_flagged_modulator_with_a_live_volume_opens_a_question", async () => {
  const w = await fixture({ modulator: PLAIN_V });
  const { held } = await stage(w, "sdm_modulator", AHM5_V);
  assert.notEqual(question.value, null);
  cancel();
  await held;
});

test("test_staging_the_other_flagged_modulator_with_a_live_volume_opens_a_question", async () => {
  const w = await fixture({ modulator: PLAIN_V });
  const { held } = await stage(w, "sdm_modulator", AHM7_V);
  assert.notEqual(question.value, null);
  cancel();
  await held;
});

// The question carries machine identity as well as owner copy, and identity is
// the part a caller can act on: `owner` names the control the question renders
// on, which is the key the user just edited. Here that is the modulator itself,
// the way the Direct SDM warning renders on `direct_sdm`. Nothing below asserts
// a word of either sentence.
test("test_the_flagged_modulator_question_names_sdm_modulator_as_owner", async () => {
  const w = await fixture({ modulator: PLAIN_V });
  const { held } = await stage(w, "sdm_modulator", AHM5_V);
  assert.equal(question.value?.owner, "sdm_modulator");
  cancel();
  await held;
});

test("test_confirming_the_flagged_modulator_question_stages_the_modulator", async () => {
  const w = await fixture({ modulator: PLAIN_V });
  const { held } = await stage(w, "sdm_modulator", AHM5_V);
  answer();
  await held;
  await quiesce(w);
  assert.equal(effective("sdm_modulator"), AHM5_V);
});

// "Stages nothing" means the pending set is UNCHANGED, not emptied. Both cases
// below stage a safe, unrelated edit FIRST — narrowing the volume range from
// -60 to -40 leaves the volume live, so it draws no question of its own — and
// then decline the guarded edit. One watches the guarded key, the other watches
// the safe one: against an empty pending set a decline and a cancel that swept
// the whole set out look identical.
test("test_declining_the_flagged_modulator_question_keeps_the_baseline_modulator", async () => {
  const w = await fixture({ modulator: PLAIN_V });
  const { held: pre } = await stage(w, "volume_min", "-40");
  await pre;
  const { held } = await stage(w, "sdm_modulator", AHM5_V);
  cancel();
  await held;
  await quiesce(w);
  assert.equal(effective("sdm_modulator"), PLAIN_V);
});

test("test_declining_the_flagged_modulator_question_leaves_an_unrelated_staged_edit_alone", async () => {
  const w = await fixture({ modulator: PLAIN_V });
  const { held: pre } = await stage(w, "volume_min", "-40");
  await pre;
  const { held } = await stage(w, "sdm_modulator", AHM5_V);
  cancel();
  await held;
  await quiesce(w);
  assert.equal(effective("volume_min"), "-40");
});

// --- forward: every spelling of a pinned volume ------------------------------
// One pinned volume per case, each LIVE_VOLUME with a single entry moved.

/** @type {{ what: string, volume: FormField[], file?: Record<string, string> }[]} */
const PINNED = [
  { what: "fixed_volume_enabled_on", volume: patch(LIVE_VOLUME, "fixed_volume_enabled", true) },
  { what: "an_optimal_iso_checkbox_the_form_renders_as_a_bool", volume: patch(LIVE_VOLUME, "volume_fixed", true) },
  {
    what: "optimal_iso_at_its_minus_six_decibel_level",
    volume: LIVE_VOLUME_WITHOUT_OPTIMAL_ISO,
    file: { volume_fixed: "2" },
  },
  {
    what: "a_zero_to_zero_volume_range",
    volume: ZERO_RANGE_VOLUME,
  },
  { what: "direct_sdm_on", volume: patch(LIVE_VOLUME, "direct_sdm", true) },
];

for (const { what, volume, file } of PINNED) {
  test(`test_a_flagged_modulator_with_${what}_opens_no_question`, async () => {
    const w = await fixture({ modulator: PLAIN_V, volume, file });
    const { held } = await stage(w, "sdm_modulator", AHM5_V);
    assert.equal(question.value, null);
    cancel();
    await held;
  });
}

// Deliberate overlap with the loop above: both drive the same edit, and each
// watches a different half of it. A failure here says the guard swallowed the
// edit; a failure above says it asked a question it had no business asking.
for (const { what, volume, file } of PINNED) {
  test(`test_a_flagged_modulator_with_${what}_stages_immediately`, async () => {
    const w = await fixture({ modulator: PLAIN_V, volume, file });
    const { held } = await stage(w, "sdm_modulator", AHM5_V);
    assert.equal(effective("sdm_modulator"), AHM5_V);
    cancel();
    await held;
  });
}

// --- forward: the live volume can be one the user just staged ----------------
// Every case above reads a volume the BASELINE already had live, so a guard
// that consulted the /config tree alone and ignored the pending set would pass
// them all. Here the baseline volume is pinned by its range and the un-pinning
// edit is STAGED first — question-free, because the modulator under it is not
// flagged yet — so the volume is live only in the effective state.

test("test_staging_a_flagged_modulator_over_a_staged_un_pinning_edit_opens_a_question", async () => {
  const w = await fixture({ modulator: PLAIN_V, volume: ZERO_RANGE_VOLUME });
  const { held: pre } = await stage(w, "volume_max", "-3");
  await pre;
  const { held } = await stage(w, "sdm_modulator", AHM5_V);
  assert.notEqual(question.value, null);
  cancel();
  await held;
});

// --- forward: an unflagged modulator is never guarded ------------------------

test("test_staging_an_unflagged_modulator_with_a_live_volume_opens_no_question", async () => {
  const w = await fixture({ modulator: PLAIN_V });
  const { held } = await stage(w, "sdm_modulator", PLAIN2_V);
  assert.equal(question.value, null);
  cancel();
  await held;
});

test("test_staging_an_unflagged_modulator_with_a_pinned_volume_opens_no_question", async () => {
  const w = await fixture({ modulator: PLAIN_V, volume: PINNED[0].volume });
  const { held } = await stage(w, "sdm_modulator", PLAIN2_V);
  assert.equal(question.value, null);
  cancel();
  await held;
});

test("test_staging_an_unflagged_modulator_with_a_live_volume_stages_immediately", async () => {
  const w = await fixture({ modulator: PLAIN_V });
  const { held } = await stage(w, "sdm_modulator", PLAIN2_V);
  assert.equal(effective("sdm_modulator"), PLAIN2_V);
  cancel();
  await held;
});

// --- reverse: un-pinning the volume under a flagged modulator ----------------
// Each case starts from a volume pinned exactly one way and stages the edit
// that removes that pin, leaving the volume live.

/**
 * @type {{
 *   what: string,
 *   volume: FormField[],
 *   key: string,
 *   value: string,
 * }[]}
 */
const UNPINNING = [
  {
    what: "turning_fixed_volume_enabled_off",
    volume: patch(LIVE_VOLUME, "fixed_volume_enabled", true),
    key: "fixed_volume_enabled",
    value: "0",
  },
  {
    what: "setting_optimal_iso_to_zero",
    volume: patch(LIVE_VOLUME, "volume_fixed", true),
    key: "optimal_iso",
    value: "0",
  },
  {
    what: "turning_direct_sdm_off",
    volume: patch(LIVE_VOLUME, "direct_sdm", true),
    key: "direct_sdm",
    value: "0",
  },
  {
    what: "opening_the_volume_range_at_the_bottom",
    volume: ZERO_RANGE_VOLUME,
    key: "volume_min",
    value: "-60",
  },
  {
    what: "opening_the_volume_range_at_the_top",
    volume: ZERO_RANGE_VOLUME,
    key: "volume_max",
    value: "-3",
  },
];

for (const { what, volume, key, value } of UNPINNING) {
  test(`test_${what}_under_a_flagged_modulator_opens_a_question`, async () => {
    const w = await fixture({ modulator: AHM5_V, volume });
    const { held } = await stage(w, key, value);
    assert.notEqual(question.value, null);
    cancel();
    await held;
  });
}

for (const { what, volume, key, value } of UNPINNING) {
  test(`test_${what}_under_an_unflagged_modulator_opens_no_question`, async () => {
    const w = await fixture({ modulator: PLAIN_V, volume });
    const { held } = await stage(w, key, value);
    assert.equal(question.value, null);
    cancel();
    await held;
  });
}

// `owner` names the control the question RENDERS ON, not the danger it is
// about, so it is the key that was edited: the dialog opens on the control the
// user just touched. On this side that is the volume control, and owning the
// question to the modulator instead would pop the dialog on a different control
// on a different card. Its sentence stays unasserted.
test("test_the_un_pinning_question_names_the_edited_volume_control_as_owner", async () => {
  const w = await fixture({ modulator: AHM5_V, volume: ZERO_RANGE_VOLUME });
  const { held } = await stage(w, "volume_max", "-3");
  assert.equal(question.value?.owner, "volume_max");
  cancel();
  await held;
});

// The mirror of the staged-un-pin case above: every reverse case so far seeds
// the flagged modulator through the /config baseline, so a guard reading the
// baseline alone would pass the whole loop. Here the baseline modulator is
// unflagged and the flagged one is STAGED first — question-free, because the
// volume is pinned while it lands — and the un-pinning edit that follows is
// still dangerous.
test("test_un_pinning_the_volume_under_a_staged_flagged_modulator_opens_a_question", async () => {
  const w = await fixture({ modulator: PLAIN_V, volume: ZERO_RANGE_VOLUME });
  const { held: pre } = await stage(w, "sdm_modulator", AHM5_V);
  await pre;
  const { held } = await stage(w, "volume_max", "-3");
  assert.notEqual(question.value, null);
  cancel();
  await held;
});

// The confirm/decline pair rides the volume-range path, whose baseline and
// staged value are both plain strings — so "kept its baseline" is a claim about
// one value written one way.
const RANGE = UNPINNING[4];

test("test_confirming_the_un_pinning_question_stages_the_volume_edit", async () => {
  const w = await fixture({ modulator: AHM5_V, volume: RANGE.volume });
  const { held } = await stage(w, RANGE.key, RANGE.value);
  answer();
  await held;
  await quiesce(w);
  assert.equal(effective("volume_max"), RANGE.value);
});

// Same shape as the forward decline: a safe edit is staged FIRST so the pending
// set is not empty, since a decline and a cancel that emptied the whole set are
// indistinguishable against an empty one. Moving to the OTHER flagged modulator
// is safe here because the baseline volume is still pinned while it lands, and
// it leaves the reverse guard's precondition in place.
test("test_declining_the_un_pinning_question_keeps_the_baseline_volume", async () => {
  const w = await fixture({ modulator: AHM5_V, volume: RANGE.volume });
  const { held: pre } = await stage(w, "sdm_modulator", AHM7_V);
  await pre;
  const { held } = await stage(w, RANGE.key, RANGE.value);
  cancel();
  await held;
  await quiesce(w);
  assert.equal(effective("volume_max"), "0");
});

test("test_declining_the_un_pinning_question_leaves_an_unrelated_staged_edit_alone", async () => {
  const w = await fixture({ modulator: AHM5_V, volume: RANGE.volume });
  const { held: pre } = await stage(w, "sdm_modulator", AHM7_V);
  await pre;
  const { held } = await stage(w, RANGE.key, RANGE.value);
  cancel();
  await held;
  await quiesce(w);
  assert.equal(effective("sdm_modulator"), AHM7_V);
});

// --- an edit that leaves the volume pinned -----------------------------------
// Both mechanisms hold the volume down; dropping one leaves the other, so the
// volume never becomes live and there is nothing to warn about.

test("test_dropping_one_pin_while_another_holds_opens_no_question", async () => {
  const w = await fixture({
    modulator: AHM5_V,
    volume: patch(patch(LIVE_VOLUME, "fixed_volume_enabled", true), "volume_fixed", true),
  });
  const { held } = await stage(w, "fixed_volume_enabled", "0");
  assert.equal(question.value, null);
  cancel();
  await held;
});
