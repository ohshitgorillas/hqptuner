// Behavioral suite for the DSD processing lists of hqptuner/static/store/faceplate/lists/open.js and options.js: the
// four DSD keys (decimation, rate conversion, integrator, noise filter) open as one list kind, a kind that carries no
// narrowing console and no favorites, its rows are the drawer row's own options joined to the plain-names overlay of
// the same key, and narrowing leaves every option of such a list in place.
//
// The wire is the seam: the enumerations, State, /config form and overlays of tests/js/support/listsfixture.js, with
// the daemon's `noise_filter` and `integrator` form fields, a `noise_filter` plain-names section and the noise filter's
// per-option settings metadata prose added on top. The option names are the daemon's own enumeration names
// (tests/support/fixtures/config-form-6.0.4.html); the families and the prose are this file's own.
//
// open.js is imported under a built specifier so a checkout without its new exports fails per case, on an assertion,
// rather than at module link.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-lists/dsd-kind.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config, metadata } from "../../../../hqptuner/static/store/signals.js";
import { flushNarrowing } from "../../../../hqptuner/static/store/narrow/persist.js";
import { listOptions, narrowedOptions } from "../../../../hqptuner/static/store/faceplate/lists/options.js";
import { setFacet } from "../../../../hqptuner/static/store/faceplate/lists/facets.js";
import { rowOptions } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { favoritesWire } from "../../support/wire/favoriteswire.js";
import { loadLists, resetLists } from "../../support/listsfixture.js";

const OPEN = new URL("../../../../hqptuner/static/store/faceplate/lists/open.js", import.meta.url).href;
const open = await import(`${OPEN}`);

/** The four catalog keys of the DSD processing drawer that open a list. */
const DSD_KEYS = ["pcm_conversion", "sdm_conversion", "sdm_integrator", "noise_filter"];

/** A filter key, the kind the DSD keys are told apart from. */
const FILTER_KEY = "sdm_filter_1x";

/** The noise filter's family in the plain-names overlay, one per option, two families so the join is observable. */
const NOISE_FAMILIES = { standard: "Fam plain", low: "Fam plain", sac: "Fam corrected" };

/** The noise filter's options on the /config form: value, engine name. The value 7 sits at index 2. */
/** @type {[string, string][]} */
const NOISE_OPTIONS = [
  ["0", "standard"],
  ["1", "low"],
  ["7", "sac"],
];

/** The noise filter's per-option prose in the settings metadata, keyed by option value, one sentence each. */
const NOISE_PROSE = {
  0: "Prose fixture for value 0.",
  1: "Prose fixture for value 1.",
  7: "Prose fixture for value 7.",
};

/**
 * One /config form select field.
 *
 * @param {string} name
 * @param {[string, string][]} options value, engine name
 */
const selectField = (name, options) => ({
  name,
  type: "select",
  value: options[0][0],
  options: options.map(([value, label]) => ({ value, label })),
});

/** Add the daemon's noise filter and integrator fields, and the noise filter's plain-names section, to the wire. */
function loadDsd() {
  const form = /** @type {{ fields: unknown[] }} */ (config.value);
  config.value = {
    ...form,
    fields: [
      ...form.fields,
      selectField("noise_filter", NOISE_OPTIONS),
      selectField("integrator", [
        ["0", "IIR"],
        ["1", "FIR"],
        ["2", "CIC"],
      ]),
    ],
  };
  const meta = /** @type {{ plain_names: Record<string, unknown> }} */ (metadata.value);
  const entries = Object.fromEntries(
    Object.entries(NOISE_FAMILIES).map(([name, family]) => [name, { family, variant: null, leaf: name, short: name }]),
  );
  const settings = { dsp: { pdm_filter: { label: "", tooltip: "", options: NOISE_PROSE } } };
  metadata.value = {
    ...meta,
    settings,
    plain_names: { ...meta.plain_names, noise_filter: { entries, families: {} } },
  };
}

beforeEach(() => {
  favoritesWire();
  resetLists();
  loadLists();
  loadDsd();
});

afterEach(async () => {
  await flushNarrowing();
});

/**
 * The engine names a list holds, in its order.
 *
 * @param {{ v: string }[]} opts
 */
const names = (opts) => opts.map((o) => o.v);

/**
 * The engine names a drawer row offers, in its order.
 *
 * @param {string} key
 */
const rowNames = (key) => rowOptions(key).map((/** @type {{ label: string }} */ o) => o.label);

test("test_every_dsd_key_opens_as_the_dsd_kind_and_a_filter_key_does_not", () => {
  const dsd = [...DSD_KEYS, FILTER_KEY].map((k) => open.kindOf(k) === "dsd");
  assert.deepEqual(dsd, [true, true, true, true, false]);
});

test("test_a_dsd_list_has_no_console_where_a_filter_list_has_one", () => {
  assert.deepEqual([open.hasConsole?.("dsd"), open.hasConsole?.("filters")], [false, true]);
});

test("test_a_dsd_list_has_no_favorites_where_a_filter_list_has_them", () => {
  assert.deepEqual([open.hasFavorites?.("dsd"), open.hasFavorites?.("filters")], [false, true]);
});

test("test_a_noise_filter_list_holds_one_row_per_option_of_its_drawer_row", () => {
  assert.deepEqual(names(listOptions("noise_filter")), rowNames("noise_filter"));
});

test("test_a_simplified_noise_filter_row_carries_its_family_from_the_noise_filter_overlay", () => {
  loadLists({ plain: true });
  loadDsd();
  const fams = Object.fromEntries(listOptions("noise_filter").map((o) => [o.v, o.fam]));
  assert.deepEqual(fams, NOISE_FAMILIES);
});

test("test_a_noise_filter_row_carries_the_settings_metadata_prose_of_its_option_value", () => {
  const prose = /** @type {Record<string, string>} */ (NOISE_PROSE);
  const want = Object.fromEntries(NOISE_OPTIONS.map(([value, name]) => [name, prose[value]]));
  const got = Object.fromEntries(listOptions("noise_filter").map((o) => [o.v, o.d]));
  assert.deepEqual(got, want);
});

test("test_narrowing_leaves_every_option_of_an_integrator_list_in_place", () => {
  setFacet("quality", 3);
  setFacet("fav", true);
  assert.deepEqual(names(narrowedOptions("sdm_integrator", "1x", "")), rowNames("sdm_integrator"));
});
