// Rendered suite for the factory-default mark of hqptuner/static/components/faceplate/lists/OptionList.js: in a picker
// window, the option whose engine name is the setting's recorded factory default carries the default mark and no other
// option does, a setting with no recorded default marks no option, and the window's legend explains the mark exactly
// when the window shows it, the filter legend keeping its own entries beside it.
//
// The factory default reaches the page as `settings.<group>.<entry>.default` in the /api/metadata bundle, the engine's
// option name. The PCM and SDM filter windows at one stage read one entry (`dsp.filter_1x`, `dsp.filter_nx`); the
// dither, the modulator and the four DSD windows read their own.
//
// Renders through preact-render-to-string. The store is driven at the wire (tests/js/support/listsfixture.js), with
// the daemon's four DSD form fields added (option names from tests/support/fixtures/config-form-6.0.4.html), a
// third option on the dormant PCM chain's Nx field, and a default recorded on each entry. Every default is a name
// this file writes, each entry's different from every other's, so a window reading another entry marks the wrong row.
// Rows are found by `role="option"` and their engine name (`data-v`). A mark is an element carrying `data-mark`: the
// default mark is `data-mark="default"` inside a row; a legend entry is a `data-mark` element outside every row,
// valued `default`, `apod`, `half`, `quality` or `fav` for the mark it explains. No copy is asserted.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-lists/default-mark.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { OptionList } from "../../../../hqptuner/static/components/faceplate/lists/OptionList.js";
import { openList } from "../../../../hqptuner/static/store/faceplate/view.js";
import { config, metadata } from "../../../../hqptuner/static/store/signals.js";
import { flushNarrowing } from "../../../../hqptuner/static/store/narrow/persist.js";
import { setFacet } from "../../../../hqptuner/static/store/faceplate/lists/facets.js";
import { hydrateFavorites, nFavOnly } from "../../../../hqptuner/static/store/narrow/favorites.js";
import { favoritesWire } from "../../support/wire/favoriteswire.js";
import { attr, elements } from "../../support/markup.js";
import { loadLists, resetLists } from "../../support/listsfixture.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/** The mark value a row's default mark and its legend entry carry. */
const DEFAULT_MARK = "default";

/** The marks the filter legend explains besides the default: apodizing, half apodizing, quality, favorite. */
const FILTER_MARKS = ["apod", "fav", "half", "quality"];

/** The factory default this file records on each `dsp` entry: an engine name, different for every entry. */
const DEFAULTS = {
  filter_1x: "poly-sinc-gauss-long",
  filter_nx: "sinc-M",
  pcm_dither: "TPDF",
  sdm_modulator: "ASDM5",
  sdm_integrator: "FIR",
  sdm_conversion: "narrow",
  pdm_filter: "low",
  pdm_conversion: "single-steep",
};

/**
 * One /config form select field: value, engine name.
 *
 * @param {string} name
 * @param {[string, string][]} options
 */
const selectField = (name, options) => ({
  name,
  type: "select",
  value: options[0][0],
  options: options.map(([value, label]) => ({ value, label })),
});

/** The daemon's four DSD processing fields, three options each. */
const DSD_FIELDS = [
  selectField("integrator", [
    ["0", "IIR"],
    ["1", "FIR"],
    ["2", "CIC"],
  ]),
  selectField("sdm_conversion", [
    ["0", "wide"],
    ["1", "narrow"],
    ["2", "XFi"],
  ]),
  selectField("noise_filter", [
    ["0", "standard"],
    ["1", "low"],
    ["7", "sac"],
  ]),
  selectField("pcm_conversion", [
    ["0", "traditional"],
    ["1", "single-steep"],
    ["9", "sinc-M"],
  ]),
];

/** The PCM Nx form field gains sinc-M, so the Nx default is one of its options too. */
const SINC_ON_PCM_NX = { value: "9", label: "sinc-M" };

/**
 * The `dsp` settings entries, each carrying `default` where `defaults` names one.
 *
 * @param {Record<string, string>} defaults
 */
const dspEntries = (defaults) =>
  Object.fromEntries(
    Object.keys(DEFAULTS).map((k) => [
      k,
      k in defaults ? { label: "", tooltip: "", default: defaults[k] } : { label: "", tooltip: "" },
    ]),
  );

/**
 * Serve the DSD fields, the widened PCM Nx field, and the settings bundle with `defaults` recorded.
 *
 * @param {Record<string, string>} defaults
 */
function serve(defaults) {
  const form = /** @type {{ fields: { name: string, options?: unknown[] }[] }} */ (config.value);
  config.value = {
    ...form,
    fields: [
      ...form.fields.map((f) => (f.name === "filter" ? { ...f, options: [...(f.options ?? []), SINC_ON_PCM_NX] } : f)),
      ...DSD_FIELDS,
    ],
  };
  metadata.value = { .../** @type {object} */ (metadata.value), settings: { dsp: dspEntries(defaults) } };
}

beforeEach(() => {
  favoritesWire();
  resetLists();
  loadLists();
  serve(DEFAULTS);
});

afterEach(async () => {
  await flushNarrowing();
});

/**
 * Open a key's list over the body with `value` running in its field.
 *
 * @param {string} key
 * @param {string} value
 */
function open(key, value) {
  openList.value = { key, stage: key.endsWith("_nx") ? "nx" : "1x", value, pick: () => undefined };
}

/** Every element the list draws, in document order. @returns {MarkupElement[]} */
const markup = () => elements(render(html`<${OptionList} />`)).sort((a, b) => a.start - b.start);

/**
 * Whether `inner` sits inside `outer`.
 *
 * @param {MarkupElement} inner
 * @param {MarkupElement} outer
 */
const within = (inner, outer) => inner.start > outer.start && inner.start < outer.start + outer.html.length;

/** The engine names of the rows that carry the default mark, in list order. */
function markedRows() {
  const all = markup();
  return all
    .filter((e) => attr(e, "role") === "option")
    .filter((row) => all.some((e) => attr(e, "data-mark") === DEFAULT_MARK && within(e, row)))
    .map((row) => attr(row, "data-v"));
}

/** The marks the window's legend explains: every `data-mark` outside a row, sorted. */
function legendMarks() {
  const all = markup();
  const rows = all.filter((e) => attr(e, "role") === "option");
  return all
    .filter((e) => attr(e, "data-mark") !== undefined && !rows.some((row) => within(e, row)))
    .map((e) => attr(e, "data-mark"))
    .sort();
}

/** How many legend entries explain the default mark. */
const defaultEntries = () => legendMarks().filter((m) => m === DEFAULT_MARK).length;

/**
 * One picker window: its list key, the entry its default is read from, and a running option that is not the default.
 *
 * @typedef {object} Window
 * @property {string} key
 * @property {keyof typeof DEFAULTS} entry
 * @property {string} running
 */

/** @type {Window[]} */
const WINDOWS = [
  { key: "sdm_filter_1x", entry: "filter_1x", running: "IIR" },
  { key: "pcm_filter_1x", entry: "filter_1x", running: "none" },
  { key: "sdm_filter_nx", entry: "filter_nx", running: "IIR" },
  { key: "pcm_filter_nx", entry: "filter_nx", running: "none" },
  { key: "pcm_dither", entry: "pcm_dither", running: "none" },
  { key: "sdm_modulator", entry: "sdm_modulator", running: "ASDM7EC 512+fs" },
  { key: "sdm_integrator", entry: "sdm_integrator", running: "0" },
  { key: "sdm_conversion", entry: "sdm_conversion", running: "0" },
  { key: "noise_filter", entry: "pdm_filter", running: "0" },
  { key: "pcm_conversion", entry: "pdm_conversion", running: "0" },
];

for (const w of WINDOWS) {
  test(`test_the_${w.key}_window_marks_only_the_option_its_settings_entry_records_as_default`, () => {
    open(w.key, w.running);
    assert.deepEqual(markedRows(), [DEFAULTS[w.entry]]);
  });
}

test("test_a_setting_with_no_recorded_default_marks_no_option_while_its_sibling_stage_marks_its_own", () => {
  const { filter_1x: _none, ...rest } = DEFAULTS;
  serve(rest);
  open("sdm_filter_1x", "IIR");
  const unrecorded = markedRows();
  open("sdm_filter_nx", "IIR");
  assert.deepEqual([unrecorded, markedRows()], [[], [DEFAULTS.filter_nx]]);
});

/** One window of each list kind: filters, dither, modulator, DSD processing. */
const KINDS = WINDOWS.filter((w) => ["sdm_filter_1x", "pcm_dither", "sdm_modulator", "noise_filter"].includes(w.key));

for (const w of KINDS) {
  test(`test_the_${w.key}_window_showing_the_default_mark_explains_it_once_in_its_legend`, () => {
    open(w.key, w.running);
    assert.equal(defaultEntries(), 1);
  });
}

test("test_a_window_whose_default_option_is_narrowed_out_drops_the_default_from_its_legend", () => {
  open("sdm_filter_nx", "IIR");
  const shown = defaultEntries();
  setFacet("quality", 3);
  assert.deepEqual([shown, defaultEntries()], [1, 0]);
});

/** The spec's family the Simplified filter outline places first, and under which it draws the filter key. */
const POLYPHASE_SINC = "Polyphase sinc";

/**
 * Simplified option style, with poly-sinc-gauss-long the one Polyphase sinc filter, sinc-M and IIR starred, and the
 * favorites-only switch on: the Polyphase sinc family narrows out of view while the Nx default, sinc-M, stays a row.
 */
async function simplifiedWithoutPolyphaseSinc() {
  loadLists({ plain: true });
  serve(DEFAULTS);
  const meta = /** @type {{ plain_names: { filters: { entries: Record<string, object> } } }} */ (metadata.value);
  const filters = meta.plain_names.filters;
  const gauss = { family: POLYPHASE_SINC, variant: "Var A", leaf: "Leaf gauss", short: "gauss" };
  metadata.value = {
    ...meta,
    plain_names: {
      ...meta.plain_names,
      filters: { ...filters, entries: { ...filters.entries, "poly-sinc-gauss-long": gauss } },
    },
  };
  favoritesWire({ filters: ["sinc-M", "IIR"] });
  await hydrateFavorites();
  nFavOnly.value = true;
  open("sdm_filter_nx", "IIR");
}

test("test_a_simplified_filter_window_with_polyphase_sinc_narrowed_out_explains_the_default_mark", async () => {
  await simplifiedWithoutPolyphaseSinc();
  assert.equal(defaultEntries(), 1);
});

test("test_a_simplified_filter_window_with_polyphase_sinc_narrowed_out_keeps_the_filter_legends_entries", async () => {
  await simplifiedWithoutPolyphaseSinc();
  assert.deepEqual(
    legendMarks().filter((m) => m !== DEFAULT_MARK),
    FILTER_MARKS,
  );
});

test("test_the_filter_legend_keeps_its_own_entries_beside_the_default", () => {
  open("sdm_filter_1x", "IIR");
  assert.deepEqual(
    legendMarks().filter((m) => m !== DEFAULT_MARK),
    FILTER_MARKS,
  );
});
