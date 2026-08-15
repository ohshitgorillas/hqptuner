// Behavioral suite for the RATE half of filter narrowing (store/narrowing.js +
// store/narrowmatch.js): the three switches that narrow by what a filter can
// do with the engine's rates —
//
//   nHideLimited  "auto" | "on" | "off" — hide filters whose ratio class is
//                 "2x" OR "integer" (the output rate-limited classes)
//   nOddRateOnly  boolean — hide the "2x" ratio filters only
//   nDownsafeOnly boolean — hide the upsample-only filters
//
// "auto" follows the engine on positive evidence only: the limited-class hide
// engages on its own exactly when the effective output mode is SDM and the
// ACTIVE backend's own DSD-rate-family flag says 44.1k-family only — backend
// "alsa" with `alsa_anydsd` at "0"/false, or backend "network" with
// `net_anydsd` at "0"/false. A "1"/true flag means 48k-family DSD is
// supported, backend "combo" (or anything else) never engages it whatever the
// flags say, and the live rates enumeration is NOT consulted at all: with the
// rate on Auto the daemon enumerates only the `rate:"0"` sentinel row, and an
// empty list is no information, not evidence of missing 48k support.
// `rateAutoHide` is that condition and `effHideLimited` the effective boolean
// after the "on"/"off" overrides.
//
// Facet data is driven the way narrowing.test.js drives it — `enums.filters`
// carries the engine's own `<GetFilters/>` items (protocol.md:226) with the
// PCM glyph `⥮` and the engine's abbreviated ratio tails (`Int`, `2^x`,
// `Any`), and `metadata.filters.filters` is the static name-keyed overlay from
// /api/metadata. The 1:1 class, the mode-split ratio pair and the flat
// upsample flag live in the overlay, the shape data/filters.json ships
// (`ratio: "1:1"`, `ratio_pcm`/`ratio_sdm`, `upsample_only`); on a mode-split
// record the flat flag reads per chain — PCM yes, SDM never. The output mode,
// backend and anydsd flags ride the payload that really carries them — the
// /config form's `mode`, `backend`, `alsa_anydsd` and `net_anydsd` rows (the
// wire keys; `output_mode` is the schema spelling of `mode`) — and the
// enumeration's `rates` items are seeded only for the fixture's shape, never
// read by auto.
//
// Persistence rides the same GET/PUT /api/narrowing pair as every other facet,
// driven through the shared fetch fake (tests/js/support/narrowingwire.js).
// The wire keys are pinned BY NAME — `hide_limited`, `odd_rate_only`,
// `downsafe_only` — on the PUT body itself, and the legacy `hide_2x`,
// `hide_int`, `ratio` and `upsample_only` keys are neither written nor choked
// on when an old file still carries them.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrowing-rate.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { narrowingWire, puts } from "../support/narrowingwire.js";
import {
  nHideLimited,
  nOddRateOnly,
  nDownsafeOnly,
  narrowingActive,
  resetNarrowing,
} from "../../../hqptuner/static/store/narrowing.js";
import { narrowOptions, rateAutoHide, effHideLimited } from "../../../hqptuner/static/store/narrowmatch.js";
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
 * The two members `narrowOptions` reads off a dropdown option.
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

// A pair of DSD rates for the enumeration's fixture shape. No auto case may
// read anything off this list — auto is driven by the backend flags alone.
const DSD_RATES = ["2822400", "5644800"];

/**
 * The engine knobs a case may seed. `alsa_anydsd` / `net_anydsd` are the
 * backends' 48k-family DSD flags — "0"/false means 44.1k-family only.
 *
 * @typedef {{
 *   mode?: string,
 *   backend?: string,
 *   alsa_anydsd?: string | boolean,
 *   net_anydsd?: string | boolean,
 *   rates?: string[],
 * }} Engine
 */

/**
 * Reassign every source a case reads — filters, overlay, output mode,
 * backend, anydsd flags, rates — and reset every switch, then hand back the
 * options of a dropdown offering the live filters plus any `extras`: names
 * the overlay (or nothing at all) describes, the way a dropdown offers
 * filters of the inactive mode.
 *
 * @param {FilterTuple[]} filters
 * @param {Record<string, Record<string, unknown>>} [overlay]
 * @param {string[]} [extras]
 * @param {Engine} [engine]
 * @returns {NarrowOption[]}
 */
function reset(filters, overlay = {}, extras = [], engine = {}) {
  const mode = engine.mode || "pcm";
  const backend = engine.backend || "network";
  const alsaAnydsd = engine.alsa_anydsd ?? "1";
  const netAnydsd = engine.net_anydsd ?? "1";
  enums.value = {
    filters: filters.map(([name, desc], i) => item(name, desc, i)),
    rates: rateRows(...(engine.rates || DSD_RATES)),
  };
  metadata.value = {
    settings: {},
    filters: { filters: overlay, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  config.value = {
    // These settings' /config form rows and file-truth keys carry the wire
    // spellings — `mode`, `backend`, `alsa_anydsd`, `net_anydsd` (the
    // `output_mode` spelling is the schema's field id, not the wire key).
    fields: [
      { name: "mode", value: mode },
      { name: "backend", value: backend },
      { name: "alsa_anydsd", value: alsaAnydsd },
      { name: "net_anydsd", value: netAnydsd },
    ],
    file: { mode: mode, backend: backend, alsa_anydsd: alsaAnydsd, net_anydsd: netAnydsd },
    active: "",
    profiles: null,
  };
  resetNarrowing();
  const live = filters.map(([name], i) => ({ label: name, value: String(i) }));
  return live.concat(extras.map((name, i) => ({ label: name, value: String(filters.length + i) })));
}

/** @param {NarrowOption[]} options */
const labels = (options, stage = STAGE, field = PCM_FIELD) => narrowOptions(options, stage, field).map((o) => o.label);

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

const ALL_CLASSES = ["rat-two", "rat-int", "rat-any", "none"];

const ONE_TO_ONE = { none: { ratio: "1:1" } };

/** @param {Engine} [engine] */
const classes = (engine = {}) => reset(CLASSES, ONE_TO_ONE, ["none"], engine);

// The state that engages auto: SDM out on a network backend whose anydsd flag
// says 44.1k-family only.
const SDM_44_NET = { mode: "sdm", backend: "network", net_anydsd: "0" };

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

// The mode-split record, overlay-only the way inactive-mode filters are, in
// exactly the shape data/filters.json ships for the mqa/mp3 pair: a ratio
// integer on the PCM side, any on the SDM side, and a FLAT `upsample_only`
// flag that holds on PCM fields and never on SDM fields — that per-chain
// reading is resolution-time, not a pair of overlay keys.
const SPLIT = {
  "poly-sinc-mqa/mp3-lp": { ratio_pcm: "integer", ratio_sdm: "any", upsample_only: true, quality: 4 },
};

const split = () => reset([], SPLIT, ["poly-sinc-mqa/mp3-lp"]);

// --- nothing engaged ---------------------------------------------------------

test("test_every_switch_at_its_default_returns_the_labels_untouched", () => {
  const options = classes();
  assert.deepEqual(labels(options), ALL_CLASSES);
});

// --- the limited-class hide ----------------------------------------------------

test("test_hide_limited_on_excludes_the_2x_and_integer_filters", () => {
  const options = classes();
  nHideLimited.value = "on";
  assert.deepEqual(labels(options), ["rat-any", "none"]);
});

test("test_hide_limited_off_passes_the_limited_classes_auto_would_hide", () => {
  const options = classes(SDM_44_NET);
  nHideLimited.value = "off";
  assert.deepEqual(labels(options), ALL_CLASSES);
});

// Putting the switch back to "auto" — under conditions where auto does not
// engage — gives the whole list back: the narrowing is undone, not merely
// never applied, so the case narrows for real first.
test("test_putting_hide_limited_back_to_auto_narrows_by_ratio_not_at_all", () => {
  const options = classes();
  nHideLimited.value = "on";
  nHideLimited.value = "auto";
  assert.deepEqual(labels(options), ALL_CLASSES);
});

// --- auto follows the engine ----------------------------------------------------
// Positive evidence only: the active backend's anydsd flag drives auto, the
// rates enumeration never does.

test("test_auto_hides_both_limited_classes_on_a_44_1_only_network_backend", () => {
  const options = classes(SDM_44_NET);
  assert.deepEqual(labels(options), ["rat-any", "none"]);
});

test("test_rate_auto_hide_engages_in_sdm_on_a_44_1_only_network_backend", () => {
  classes(SDM_44_NET);
  assert.equal(rateAutoHide.value, true);
});

// THE reported bug: this exact state — SDM out, network backend, net_anydsd
// saying 48k-family DSD is supported — fired the hide before the fix.
test("test_rate_auto_hide_stays_off_when_the_network_backend_supports_48k_dsd", () => {
  classes({ mode: "sdm", backend: "network", net_anydsd: "1" });
  assert.equal(rateAutoHide.value, false);
});

test("test_rate_auto_hide_engages_in_sdm_on_a_44_1_only_alsa_backend", () => {
  classes({ mode: "sdm", backend: "alsa", alsa_anydsd: "0" });
  assert.equal(rateAutoHide.value, true);
});

test("test_rate_auto_hide_stays_off_when_the_alsa_backend_supports_48k_dsd", () => {
  classes({ mode: "sdm", backend: "alsa", alsa_anydsd: "1" });
  assert.equal(rateAutoHide.value, false);
});

// Only the ACTIVE backend's flag counts: the other backend being 44.1k-only
// is not evidence about the chain in use.

test("test_the_inactive_network_flag_does_not_engage_auto_on_an_alsa_backend", () => {
  classes({ mode: "sdm", backend: "alsa", alsa_anydsd: "1", net_anydsd: "0" });
  assert.equal(rateAutoHide.value, false);
});

test("test_the_inactive_alsa_flag_does_not_engage_auto_on_a_network_backend", () => {
  classes({ mode: "sdm", backend: "network", net_anydsd: "1", alsa_anydsd: "0" });
  assert.equal(rateAutoHide.value, false);
});

test("test_rate_auto_hide_stays_off_on_the_combo_backend_whatever_the_flags", () => {
  classes({ mode: "sdm", backend: "combo", alsa_anydsd: "0", net_anydsd: "0" });
  assert.equal(rateAutoHide.value, false);
});

test("test_rate_auto_hide_stays_off_outside_sdm_output", () => {
  classes({ mode: "pcm", backend: "network", net_anydsd: "0" });
  assert.equal(rateAutoHide.value, false);
});

// The regression pin proper: with the rate on Auto the daemon enumerates only
// the `rate:"0"` sentinel row, and that empty list is no information — the
// backend flag saying 48k DSD is supported keeps auto off regardless.
test("test_a_sentinel_only_rates_list_does_not_engage_auto", () => {
  classes({ mode: "sdm", backend: "network", net_anydsd: "1", rates: [] });
  assert.equal(rateAutoHide.value, false);
});

// The flags arrive in either encoding: "0"/false is 44.1k-family only,
// "1"/true is 48k-family support.

test("test_a_boolean_false_anydsd_flag_engages_auto", () => {
  classes({ mode: "sdm", backend: "network", net_anydsd: false });
  assert.equal(rateAutoHide.value, true);
});

test("test_a_boolean_true_anydsd_flag_keeps_auto_off", () => {
  classes({ mode: "sdm", backend: "network", net_anydsd: true });
  assert.equal(rateAutoHide.value, false);
});

test("test_eff_hide_limited_is_true_when_the_switch_is_on_and_auto_is_not", () => {
  classes({ mode: "pcm" });
  nHideLimited.value = "on";
  assert.equal(effHideLimited.value, true);
});

test("test_eff_hide_limited_is_true_on_auto_while_auto_engages", () => {
  classes(SDM_44_NET);
  assert.equal(effHideLimited.value, true);
});

test("test_eff_hide_limited_is_false_on_auto_while_auto_does_not_engage", () => {
  classes({ mode: "pcm" });
  assert.equal(effHideLimited.value, false);
});

test("test_eff_hide_limited_is_false_when_auto_engages_but_the_switch_is_off", () => {
  classes(SDM_44_NET);
  nHideLimited.value = "off";
  assert.equal(effHideLimited.value, false);
});

// --- the odd-rate switch ------------------------------------------------------

test("test_odd_rate_only_excludes_the_2x_filters_and_passes_the_rest", () => {
  const options = classes();
  nOddRateOnly.value = true;
  assert.deepEqual(labels(options), ["rat-int", "rat-any", "none"]);
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

for (const [hideLimited, oddRate, downsafe] of [
  ["on", false, false],
  ["auto", true, false],
  ["auto", false, true],
  ["on", true, false],
  ["on", false, true],
  ["auto", true, true],
  ["on", true, true],
]) {
  test(`test_the_one_to_one_filter_survives_${hideLimited}_${oddRate}_${downsafe}`, () => {
    const options = classes();
    nHideLimited.value = String(hideLimited);
    nOddRateOnly.value = Boolean(oddRate);
    nDownsafeOnly.value = Boolean(downsafe);
    assert.equal(labels(options).includes("none"), true);
  });
}

test("test_the_one_to_one_filter_survives_the_auto_engaged_hide", () => {
  const options = classes(SDM_44_NET);
  nOddRateOnly.value = true;
  nDownsafeOnly.value = true;
  assert.equal(labels(options).includes("none"), true);
});

// --- a filter with no facet record --------------------------------------------

test("test_a_filter_with_no_facet_record_survives_every_switch_engaged", () => {
  const options = reset([], {}, ["mystery"]);
  nHideLimited.value = "on";
  nOddRateOnly.value = true;
  nDownsafeOnly.value = true;
  assert.deepEqual(labels(options), ["mystery"]);
});

test("test_a_filter_with_no_facet_record_survives_the_auto_engaged_hide", () => {
  const options = reset([], {}, ["mystery"], SDM_44_NET);
  assert.deepEqual(labels(options), ["mystery"]);
});

// --- mode-split records answer for the field's side ----------------------------

test("test_hide_limited_on_hides_the_split_ratio_pair_on_a_pcm_field", () => {
  const options = split();
  nHideLimited.value = "on";
  assert.deepEqual(labels(options, STAGE, PCM_FIELD), []);
});

test("test_hide_limited_on_passes_the_split_ratio_pair_on_an_sdm_field", () => {
  const options = split();
  nHideLimited.value = "on";
  assert.deepEqual(labels(options, STAGE, SDM_FIELD), ["poly-sinc-mqa/mp3-lp"]);
});

// The pair's PCM ratio is integer, not 2x, so the odd-rate switch — which hides
// the 2x class alone — leaves it alone on both sides.
test("test_odd_rate_only_passes_the_split_ratio_pair_on_a_pcm_field", () => {
  const options = split();
  nOddRateOnly.value = true;
  assert.deepEqual(labels(options, STAGE, PCM_FIELD), ["poly-sinc-mqa/mp3-lp"]);
});

test("test_odd_rate_only_passes_the_split_ratio_pair_on_an_sdm_field", () => {
  const options = split();
  nOddRateOnly.value = true;
  assert.deepEqual(labels(options, STAGE, SDM_FIELD), ["poly-sinc-mqa/mp3-lp"]);
});

test("test_downsample_safe_only_hides_the_mqa_pair_on_a_pcm_field", () => {
  const options = split();
  nDownsafeOnly.value = true;
  assert.deepEqual(labels(options, STAGE, PCM_FIELD), []);
});

test("test_downsample_safe_only_passes_the_mqa_pair_on_an_sdm_field", () => {
  const options = split();
  nDownsafeOnly.value = true;
  assert.deepEqual(labels(options, STAGE, SDM_FIELD), ["poly-sinc-mqa/mp3-lp"]);
});

// --- selection state -----------------------------------------------------------
// Auto engaging on its own is the engine's doing, not the user's: it never
// reads as active narrowing. Any EXPLICIT setting — "on" or "off" alike — does.

test("test_auto_engaged_hides_are_not_active_narrowing", () => {
  classes(SDM_44_NET);
  assert.equal(narrowingActive.value, false);
});

test("test_hide_limited_on_is_active_narrowing", () => {
  classes();
  nHideLimited.value = "on";
  assert.equal(narrowingActive.value, true);
});

test("test_hide_limited_off_is_active_narrowing", () => {
  classes();
  nHideLimited.value = "off";
  assert.equal(narrowingActive.value, true);
});

test("test_an_engaged_odd_rate_switch_is_active_narrowing", () => {
  classes();
  nOddRateOnly.value = true;
  assert.equal(narrowingActive.value, true);
});

test("test_an_engaged_downsample_safe_switch_is_active_narrowing", () => {
  classes();
  nDownsafeOnly.value = true;
  assert.equal(narrowingActive.value, true);
});

test("test_reset_returns_hide_limited_to_auto", () => {
  classes();
  nHideLimited.value = "on";
  resetNarrowing();
  assert.equal(nHideLimited.value, "auto");
});

test("test_reset_returns_odd_rate_only_to_off", () => {
  classes();
  nOddRateOnly.value = true;
  resetNarrowing();
  assert.equal(nOddRateOnly.value, false);
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

// Every key on the rate side of the record, old and new alike, so a filter on
// the PUT body's keys reads back exactly the three the record now carries.
const RATE_KEYS = ["hide_limited", "odd_rate_only", "downsafe_only", "hide_2x", "hide_int", "ratio", "upsample_only"];

/**
 * The last PUT body a flush of one changed switch produced. The sentinel
 * stands in for a flush that sent nothing at all, so a client that never
 * writes fails here rather than passing on an empty key list.
 *
 * @param {{ value: unknown }} signal
 * @param {unknown} value
 * @returns {Promise<Facets>}
 */
async function flushed(signal, value) {
  const w = await persistReset();
  await hydrateNarrowing();
  signal.value = value;
  await flushNarrowing();
  return puts(w).at(-1) || { no_put_was_sent: true };
}

// The wire keys are pinned by NAME on the PUT body: of the rate-side keys the
// record has ever carried, the flush sends exactly the three new ones.

test("test_the_put_carries_the_three_rate_keys_and_no_legacy_ones", async () => {
  const sent = await flushed(nHideLimited, "on");
  assert.deepEqual(
    Object.keys(sent)
      .filter((k) => RATE_KEYS.includes(k) || k === "no_put_was_sent")
      .sort(),
    ["downsafe_only", "hide_limited", "odd_rate_only"],
  );
});

test("test_the_put_carries_hide_limited_as_the_tri_state_token", async () => {
  const sent = await flushed(nHideLimited, "on");
  assert.equal(sent.hide_limited, "on");
});

test("test_the_put_carries_odd_rate_only_as_a_real_boolean", async () => {
  const sent = await flushed(nOddRateOnly, true);
  assert.equal(sent.odd_rate_only, true);
});

test("test_the_put_carries_downsafe_only_as_a_real_boolean", async () => {
  const sent = await flushed(nDownsafeOnly, true);
  assert.equal(sent.downsafe_only, true);
});

// The read path pins the same key names: a stored value under the pinned key
// restores the switch on hydration.

test("test_a_persisted_hide_limited_on_restores_on_hydration", async () => {
  await persistReset({ facets: { hide_limited: "on" } });
  await hydrateNarrowing();
  assert.equal(nHideLimited.value, "on");
});

test("test_a_persisted_hide_limited_off_restores_on_hydration", async () => {
  await persistReset({ facets: { hide_limited: "off" } });
  await hydrateNarrowing();
  assert.equal(nHideLimited.value, "off");
});

test("test_a_persisted_odd_rate_switch_restores_on_hydration", async () => {
  await persistReset({ facets: { odd_rate_only: true } });
  await hydrateNarrowing();
  assert.equal(nOddRateOnly.value, true);
});

test("test_a_persisted_downsample_safe_switch_restores_on_hydration", async () => {
  await persistReset({ facets: { downsafe_only: true } });
  await hydrateNarrowing();
  assert.equal(nDownsafeOnly.value, true);
});

// A file an older HQPTuner left behind still carries the retired facets; the
// hydration neither chokes on them nor lets them narrow anything.

const LEGACY = { hide_2x: "on", hide_int: "on", ratio: "2x", upsample_only: true };

test("test_hydrating_a_legacy_rate_record_does_not_throw", async () => {
  await persistReset({ facets: LEGACY });
  await assert.doesNotReject(() => hydrateNarrowing());
});

test("test_hydrating_a_legacy_rate_record_narrows_nothing", async () => {
  const options = classes();
  await persistReset({ facets: LEGACY });
  await hydrateNarrowing();
  assert.deepEqual(labels(options), ALL_CLASSES);
});

// Nor does any legacy key migrate into a new switch: after hydrating the old
// record every rate switch still sits at its default. Pinned per switch — the
// narrows-nothing case above cannot see, say, `upsample_only:true` mapped onto
// the downsample-safe switch when the fixture holds no upsample-only filter.

test("test_a_legacy_record_leaves_hide_limited_at_auto", async () => {
  await persistReset({ facets: LEGACY });
  await hydrateNarrowing();
  assert.equal(nHideLimited.value, "auto");
});

test("test_a_legacy_record_leaves_the_odd_rate_switch_off", async () => {
  await persistReset({ facets: LEGACY });
  await hydrateNarrowing();
  assert.equal(nOddRateOnly.value, false);
});

test("test_a_legacy_record_leaves_the_downsample_safe_switch_off", async () => {
  await persistReset({ facets: LEGACY });
  await hydrateNarrowing();
  assert.equal(nDownsafeOnly.value, false);
});
