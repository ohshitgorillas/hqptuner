// Behavioral suite for the RATE half of filter narrowing (store/narrowing.js +
// store/narrowmatch.js): the switches that replaced the single-select ratio
// pick and the show-only Upsample-only checkbox —
//
//   nHide2x       "auto" | "on" | "off" — hide filters whose ratio class is "2x"
//   nHideInt      "auto" | "on" | "off" — hide filters whose ratio class is "integer"
//   nDownsafeOnly boolean — show only downsampling-safe filters
//
// "auto" follows the engine: the class hides engage on their own exactly when
// the effective output mode is SDM and the live rates enumeration offers no
// rate that is a positive multiple of 48000 (the `rate:"0"` row is a sentinel,
// not a rate — protocol.md §6). `rateAutoHide` is that condition, and
// `effHide2x` / `effHideInt` are the effective booleans after "on"/"off"
// overrides.
//
// Facet data is driven the way narrowing.test.js drives it — `enums.filters`
// carries the engine's own `<GetFilters/>` items (protocol.md:226) with the
// PCM glyph `⥮` and the engine's abbreviated ratio tails (`Int`, `2^x`,
// `Any`), and `metadata.filters.filters` is the static name-keyed overlay from
// /api/metadata. The 1:1 class, the mode-split ratio pair and the flat
// upsample flag live in the overlay, the shape data/filters.json ships
// (`ratio: "1:1"`, `ratio_pcm`/`ratio_sdm`, `upsample_only`); on a mode-split
// record the flat flag reads per chain — PCM yes, SDM never. The
// output mode and the rates list ride the payloads that really carry them:
// the /config form's `output_mode` field and the enumeration's `rates` items,
// the way liverate.test.js and the shaperfit fixtures seed them.
//
// Persistence rides the same GET/PUT /api/narrowing pair as every other facet,
// driven through the shared fetch fake (tests/js/support/narrowingwire.js).
// The wire keys of the three switches are the implementation's to name, so the
// round-trip cases hydrate from the facets the client itself flushed rather
// than hard-coding keys; what IS pinned by name is that the legacy `ratio` and
// `upsample_only` keys are neither written nor choked on when an old file
// still carries them.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrowing-rate.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { narrowingWire, puts } from "../support/narrowingwire.js";
import {
  nHide2x,
  nHideInt,
  nDownsafeOnly,
  narrowingActive,
  resetNarrowing,
} from "../../../hqptuner/static/store/narrowing.js";
import {
  narrowOptions,
  narrowCount,
  rateAutoHide,
  effHide2x,
  effHideInt,
} from "../../../hqptuner/static/store/narrowmatch.js";
import { narrowingError, hydrateNarrowing, flushNarrowing } from "../../../hqptuner/static/store/narrowpersist.js";
import { enums, metadata, config } from "../../../hqptuner/static/store/signals.js";

const STAGE = "nx";
const PCM_FIELD = "pcm_filter_nx";
const SDM_FIELD = "sdm_filter_nx";

/**
 * A fixture row: filter name and its facet description.
 *
 * @typedef {[string, string]} FilterTuple
 */

/**
 * The two members `narrowOptions` and friends read off a dropdown option.
 *
 * @typedef {{ value: string | number | undefined, label: string }} NarrowOption
 */

/** @typedef {import("../support/narrowingwire.js").Facets} Facets */

// One `<FiltersItem/>` as the enumeration serves it (protocol.md:226).
const item = (/** @type {string} */ name, /** @type {string} */ description, /** @type {number} */ index) => ({
  index: String(index),
  name,
  value: String(index),
  arg: 0,
  description,
  apodizing: false,
});

// The engine's rates enumeration, sentinel row first (liverate.test.js).
const rateRows = (/** @type {string[]} */ ...hz) => ["0", ...hz].map((rate, i) => ({ index: String(i), rate }));

// The 44.1k-family DSD rates — no positive multiple of 48000 among them — and
// the same family with one 48k-family rate added.
const DSD_44K = ["2822400", "5644800"];
const DSD_MIXED = ["2822400", "3072000"];

/**
 * Reassign every source a case reads — filters, overlay, output mode, rates —
 * and reset every switch, then hand back the options of a dropdown offering
 * the live filters plus any `extras`: names the overlay (or nothing at all)
 * describes, the way a dropdown offers filters of the inactive mode.
 *
 * @param {FilterTuple[]} filters
 * @param {Record<string, Record<string, unknown>>} [overlay]
 * @param {string[]} [extras]
 * @param {{ mode?: string, rates?: string[] }} [engine]
 * @returns {NarrowOption[]}
 */
function reset(filters, overlay = {}, extras = [], engine = {}) {
  const mode = engine.mode || "pcm";
  enums.value = {
    filters: filters.map(([name, desc], i) => item(name, desc, i)),
    rates: rateRows(...(engine.rates || DSD_MIXED)),
  };
  metadata.value = {
    settings: {},
    filters: { filters: overlay, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  config.value = {
    fields: [{ name: "output_mode", value: mode }],
    file: { output_mode: mode },
    active: "",
    profiles: null,
  };
  resetNarrowing();
  const live = filters.map(([name], i) => ({ label: name, value: String(i) }));
  return live.concat(extras.map((name, i) => ({ label: name, value: String(filters.length + i) })));
}

/** @param {NarrowOption[]} options */
const labels = (options, stage = STAGE, field = PCM_FIELD) =>
  narrowOptions(options, stage, field).map((o) => o.label);

// --- fixtures ----------------------------------------------------------------

// One filter per ratio class the engine spells in its description tails, plus
// the pass-through "none", whose 1:1 class data/filters.json carries in the
// overlay.
/** @type {FilterTuple[]} */
const CLASSES = [
  ["rat-two", "4/5 ⥮ 2^x"],
  ["rat-int", "4/5 ⥮ Int"],
  ["rat-any", "4/5 ⥮ Any"],
];

const ONE_TO_ONE = { none: { ratio: "1:1" } };

/** @param {{ mode?: string, rates?: string[] }} [engine] */
const classes = (engine = {}) => reset(CLASSES, ONE_TO_ONE, ["none"], engine);

// Two filters alike in ratio class — both 2x — differing only in the overlay's
// upsample-only flag, so the downsample-safe switch alone moves the answer and
// a ratio-class confusion cannot.
/** @type {FilterTuple[]} */
const UPSAMPLE = [
  ["up-only", "4/5 ⥮ 2^x"],
  ["down-ok", "4/5 ⥮ 2^x"],
];

const UPSAMPLE_OVERLAY = {
  "up-only": { upsample_only: true },
  "down-ok": { upsample_only: false },
};

// Mode-split records, overlay-only the way inactive-mode filters are, in
// exactly the shape data/filters.json ships: a ratio integer on the PCM side
// but any on the SDM side, and the mqa/mp3 pair, whose FLAT `upsample_only`
// flag on a mode-split record holds on PCM fields and never on SDM fields —
// that per-chain reading is resolution-time, not a pair of overlay keys.
const SPLIT_RATIO = { "closed-form": { ratio_pcm: "integer", ratio_sdm: "any" } };
const SPLIT_UPSAMPLE = {
  "poly-sinc-mqa/mp3-lp": { ratio_pcm: "integer", ratio_sdm: "any", upsample_only: true },
};

// --- nothing engaged ---------------------------------------------------------

test("test_every_switch_at_its_default_returns_the_option_list_untouched", () => {
  const options = classes();
  assert.equal(narrowOptions(options, STAGE, PCM_FIELD), options);
});

// --- each class hide switched on hides its class -------------------------------

test("test_hide_2x_on_excludes_only_the_2x_ratio_filters", () => {
  const options = classes();
  nHide2x.value = "on";
  assert.deepEqual(labels(options), ["rat-int", "rat-any", "none"]);
});

test("test_hide_integer_on_excludes_only_the_integer_ratio_filters", () => {
  const options = classes();
  nHideInt.value = "on";
  assert.deepEqual(labels(options), ["rat-two", "rat-any", "none"]);
});

test("test_both_hides_on_leave_only_the_any_and_one_to_one_filters", () => {
  const options = classes();
  nHide2x.value = "on";
  nHideInt.value = "on";
  assert.deepEqual(labels(options), ["rat-any", "none"]);
});

test("test_the_count_under_hide_2x_on_is_the_number_of_non_2x_filters", () => {
  const options = classes();
  nHide2x.value = "on";
  assert.equal(narrowCount(options, STAGE, PCM_FIELD).n, 3);
});

// Putting the switch back to "auto" — under conditions where auto does not
// engage — gives the whole list back: the narrowing is undone, not merely
// never applied, so the case narrows for real first.
test("test_putting_hide_2x_back_to_auto_narrows_by_ratio_not_at_all", () => {
  const options = classes();
  nHide2x.value = "on";
  nHide2x.value = "auto";
  assert.deepEqual(labels(options), ["rat-two", "rat-int", "rat-any", "none"]);
});

// --- auto follows the engine ----------------------------------------------------

test("test_auto_hides_both_classes_in_sdm_with_no_48k_family_rate", () => {
  const options = classes({ mode: "sdm", rates: DSD_44K });
  assert.deepEqual(labels(options), ["rat-any", "none"]);
});

test("test_auto_hides_nothing_when_a_48k_multiple_rate_is_offered", () => {
  const options = classes({ mode: "sdm", rates: DSD_MIXED });
  assert.deepEqual(labels(options), ["rat-two", "rat-int", "rat-any", "none"]);
});

test("test_auto_hides_nothing_outside_sdm_output_whatever_the_rates", () => {
  const options = classes({ mode: "pcm", rates: DSD_44K });
  assert.deepEqual(labels(options), ["rat-two", "rat-int", "rat-any", "none"]);
});

test("test_an_off_override_passes_the_2x_filters_auto_would_hide", () => {
  const options = classes({ mode: "sdm", rates: DSD_44K });
  nHide2x.value = "off";
  assert.deepEqual(labels(options), ["rat-two", "rat-any", "none"]);
});

test("test_rate_auto_hide_engages_in_sdm_with_no_48k_family_rate", () => {
  classes({ mode: "sdm", rates: DSD_44K });
  assert.equal(rateAutoHide.value, true);
});

test("test_rate_auto_hide_stays_off_when_a_48k_multiple_rate_is_offered", () => {
  classes({ mode: "sdm", rates: DSD_MIXED });
  assert.equal(rateAutoHide.value, false);
});

test("test_rate_auto_hide_stays_off_outside_sdm_output", () => {
  classes({ mode: "pcm", rates: DSD_44K });
  assert.equal(rateAutoHide.value, false);
});

// The `rate:"0"` row is a sentinel, not an offered rate — a rates list holding
// only it offers nothing 48k-family, so auto engages.
test("test_the_zero_rate_sentinel_row_is_not_a_48k_family_rate", () => {
  classes({ mode: "sdm", rates: [] });
  assert.equal(rateAutoHide.value, true);
});

test("test_eff_hide_2x_is_false_when_auto_engages_but_the_switch_is_off", () => {
  classes({ mode: "sdm", rates: DSD_44K });
  nHide2x.value = "off";
  assert.equal(effHide2x.value, false);
});

test("test_eff_hide_2x_is_true_when_the_switch_is_on_and_auto_is_not", () => {
  classes({ mode: "pcm", rates: DSD_MIXED });
  nHide2x.value = "on";
  assert.equal(effHide2x.value, true);
});

test("test_eff_hide_int_is_true_on_auto_while_auto_engages", () => {
  classes({ mode: "sdm", rates: DSD_44K });
  assert.equal(effHideInt.value, true);
});

// --- the downsample-safe switch ----------------------------------------------

// `down-ok` is a 2x filter, so its survival is also the fact that the switch
// reads the upsample flag and never a ratio class.
test("test_downsample_safe_only_excludes_only_the_upsample_only_filters", () => {
  const options = reset(UPSAMPLE, UPSAMPLE_OVERLAY);
  nDownsafeOnly.value = true;
  assert.deepEqual(labels(options), ["down-ok"]);
});

// --- the 1:1 filter survives every combination --------------------------------

for (const [hide2x, hideInt, downsafe] of [
  ["on", "auto", false],
  ["auto", "on", false],
  ["auto", "auto", true],
  ["on", "on", false],
  ["on", "auto", true],
  ["auto", "on", true],
  ["on", "on", true],
]) {
  test(`test_the_one_to_one_filter_survives_${hide2x}_${hideInt}_${downsafe}`, () => {
    const options = classes();
    nHide2x.value = String(hide2x);
    nHideInt.value = String(hideInt);
    nDownsafeOnly.value = Boolean(downsafe);
    assert.equal(labels(options).includes("none"), true);
  });
}

test("test_the_one_to_one_filter_survives_the_auto_engaged_hides", () => {
  const options = classes({ mode: "sdm", rates: DSD_44K });
  nDownsafeOnly.value = true;
  assert.equal(labels(options).includes("none"), true);
});

// --- a filter with no facet record --------------------------------------------

test("test_a_filter_with_no_facet_record_survives_every_switch_engaged", () => {
  const options = reset([], {}, ["mystery"]);
  nHide2x.value = "on";
  nHideInt.value = "on";
  nDownsafeOnly.value = true;
  assert.deepEqual(labels(options), ["mystery"]);
});

// --- mode-split records answer for the field's side ----------------------------

test("test_hide_integer_on_hides_a_pcm_integer_split_ratio_on_a_pcm_field", () => {
  const options = reset([], SPLIT_RATIO, ["closed-form"]);
  nHideInt.value = "on";
  assert.deepEqual(labels(options, STAGE, PCM_FIELD), []);
});

test("test_hide_integer_on_passes_a_pcm_integer_split_ratio_on_an_sdm_field", () => {
  const options = reset([], SPLIT_RATIO, ["closed-form"]);
  nHideInt.value = "on";
  assert.deepEqual(labels(options, STAGE, SDM_FIELD), ["closed-form"]);
});

test("test_downsample_safe_only_hides_the_mqa_pair_on_a_pcm_field", () => {
  const options = reset([], SPLIT_UPSAMPLE, ["poly-sinc-mqa/mp3-lp"]);
  nDownsafeOnly.value = true;
  assert.deepEqual(labels(options, STAGE, PCM_FIELD), []);
});

test("test_downsample_safe_only_passes_the_mqa_pair_on_an_sdm_field", () => {
  const options = reset([], SPLIT_UPSAMPLE, ["poly-sinc-mqa/mp3-lp"]);
  nDownsafeOnly.value = true;
  assert.deepEqual(labels(options, STAGE, SDM_FIELD), ["poly-sinc-mqa/mp3-lp"]);
});

// --- selection state -----------------------------------------------------------
// Auto engaging on its own is the engine's doing, not the user's: it never
// reads as active narrowing. Any EXPLICIT setting — "on" or "off" alike — does.

test("test_auto_engaged_hides_are_not_active_narrowing", () => {
  classes({ mode: "sdm", rates: DSD_44K });
  assert.equal(narrowingActive.value, false);
});

test("test_hide_2x_on_is_active_narrowing", () => {
  classes();
  nHide2x.value = "on";
  assert.equal(narrowingActive.value, true);
});

test("test_hide_2x_off_is_active_narrowing", () => {
  classes();
  nHide2x.value = "off";
  assert.equal(narrowingActive.value, true);
});

test("test_hide_integer_on_is_active_narrowing", () => {
  classes();
  nHideInt.value = "on";
  assert.equal(narrowingActive.value, true);
});

test("test_an_engaged_downsample_safe_switch_is_active_narrowing", () => {
  classes();
  nDownsafeOnly.value = true;
  assert.equal(narrowingActive.value, true);
});

test("test_reset_returns_hide_2x_to_auto", () => {
  classes();
  nHide2x.value = "on";
  resetNarrowing();
  assert.equal(nHide2x.value, "auto");
});

test("test_reset_returns_hide_integer_to_auto", () => {
  classes();
  nHideInt.value = "off";
  resetNarrowing();
  assert.equal(nHideInt.value, "auto");
});

test("test_reset_returns_downsample_safe_only_to_off", () => {
  classes();
  nDownsafeOnly.value = true;
  resetNarrowing();
  assert.equal(nDownsafeOnly.value, false);
});

// --- persistence ---------------------------------------------------------------
// Same drain-first reset discipline as narrowing-persist.test.js: one flush
// against a throwaway wire clears the private changed-since-write mark before
// the case's own wire goes in.

/** @param {{ facets?: Facets }} [cfg] */
async function persistReset(cfg = {}) {
  narrowingWire();
  resetNarrowing();
  await flushNarrowing();
  const w = narrowingWire(cfg);
  narrowingError.value = "";
  return w;
}

/**
 * Flush the switch as set, drain the reset that puts it back to its default,
 * then hydrate a fresh wire seeded with exactly the facets the client itself
 * wrote — the reload path, without naming the wire key.
 *
 * @param {{ value: unknown }} signal
 * @param {unknown} value
 * @returns {Promise<unknown>}
 */
async function roundtrip(signal, value) {
  const w = await persistReset();
  await hydrateNarrowing();
  signal.value = value;
  await flushNarrowing();
  const sent = puts(w).at(-1) || {};
  narrowingWire();
  resetNarrowing();
  await flushNarrowing();
  narrowingWire({ facets: sent });
  await hydrateNarrowing();
  return signal.value;
}

test("test_a_persisted_hide_2x_on_restores_on_hydration", async () => {
  assert.equal(await roundtrip(nHide2x, "on"), "on");
});

test("test_a_persisted_hide_integer_off_restores_on_hydration", async () => {
  assert.equal(await roundtrip(nHideInt, "off"), "off");
});

test("test_a_persisted_downsample_safe_switch_restores_on_hydration", async () => {
  assert.equal(await roundtrip(nDownsafeOnly, true), true);
});

// The sentinel stands in for a flush that sent nothing at all, so a client
// that never writes fails here rather than passing on an empty key list.
test("test_the_put_carries_no_legacy_ratio_key", async () => {
  const w = await persistReset();
  await hydrateNarrowing();
  nHide2x.value = "on";
  await flushNarrowing();
  const sent = puts(w).at(-1) || { no_put_was_sent: true };
  assert.deepEqual(
    Object.keys(sent).filter((k) => k === "ratio" || k === "no_put_was_sent"),
    [],
  );
});

test("test_the_put_carries_no_legacy_upsample_only_key", async () => {
  const w = await persistReset();
  await hydrateNarrowing();
  nHide2x.value = "on";
  await flushNarrowing();
  const sent = puts(w).at(-1) || { no_put_was_sent: true };
  assert.deepEqual(
    Object.keys(sent).filter((k) => k === "upsample_only" || k === "no_put_was_sent"),
    [],
  );
});

// A file an older HQPTuner left behind still carries the retired facets; the
// hydration neither chokes on them nor lets them narrow anything.

test("test_hydrating_a_legacy_ratio_and_upsample_record_does_not_throw", async () => {
  await persistReset({ facets: { ratio: "2x", upsample_only: true } });
  await assert.doesNotReject(() => hydrateNarrowing());
});

test("test_hydrating_a_legacy_ratio_and_upsample_record_narrows_nothing", async () => {
  classes();
  await persistReset({ facets: { ratio: "2x", upsample_only: true } });
  await hydrateNarrowing();
  assert.equal(narrowingActive.value, false);
});
