// Rendered suite for hqptuner/static/components/faceplate/drawers/modes.js, the DSD Processing, Resampling and Shaping
// drawers' schemas drawn by the stage drawer: each tab's rows in order, the FFT length row shown only while its tab's
// filter is FFT-family, the tab each drawer opens on and the status word and idle state of the mode not running, the
// tab dot a staged restart edit puts on its own tab, and Shaping's DAC fields and DAC bits note.
//
// Renders `Drawer` through preact-render-to-string; a click is fired through the vnode seam
// (tests/js/support/vnodeseam.js) and the store is driven at the wire by the staging fake: /api/state into
// `engineState`, the daemon's /config form into `config`. Rows are found by catalog key (`data-k`), fields by id
// (`data-field`), tabs by id (`data-tab`), options by value (`data-v`); every string asserted is a wire value or a
// number the fixture put on the wire.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-modes-schema.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import {
  DSD_DRAWER,
  RESAMPLING_DRAWER,
  SHAPING_DRAWER,
} from "../../../../hqptuner/static/components/faceplate/drawers/modes.js";
import {
  config,
  engineState,
  engineStatus,
  enums,
  metadata,
  pendingPreset,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { pickApplyMode, showTab, shownTab } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { dacChip, dacType, setDacChip, setDacType } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { elements, attr, classes, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

const FILTERS = [
  { value: "1", label: "sinc-L" },
  { value: "2", label: "FFT" },
];

/**
 * Load the /config form: each chain's 1x and Nx filter by value, the backend and its DAC bits.
 *
 * @param {{ pcm1x?: string, pcmnx?: string, sdm1x?: string, sdmnx?: string, bits?: number }} [f]
 */
function load({ pcm1x = "1", pcmnx = "1", sdm1x = "1", sdmnx = "1", bits = 0 } = {}) {
  config.value = {
    fields: [
      { name: "filter1x", type: "select", value: pcm1x, options: FILTERS },
      { name: "filter", type: "select", value: pcmnx, options: FILTERS },
      { name: "oversampling1x", type: "select", value: sdm1x, options: FILTERS },
      { name: "oversampling", type: "select", value: sdmnx, options: FILTERS },
      { name: "dsd_6db", type: "checkbox", value: false },
      { name: "sdm_conversion", type: "select", value: "0", options: [{ value: "0", label: "0" }] },
      { name: "backend", type: "select", value: "alsa" },
      { name: "alsa_bits", type: "number", value: bits },
    ],
    file: {},
    active: "",
  };
}

/** The mode drawers, each opened and closed once so no tab picked by an earlier case holds. */
const MODE_DRAWERS = [DSD_DRAWER, RESAMPLING_DRAWER, SHAPING_DRAWER];

beforeEach(async () => {
  stagingWire();
  load();
  engineState.value = { state: "0", active_chain: "sdm" };
  engineStatus.value = {};
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openPopover.value = null;
  for (const d of MODE_DRAWERS) {
    openStage.value = d.id;
    openStage.value = null;
  }
  setDacType("other");
  setDacChip("other");
  cancel();
  await discardAll();
  pickApplyMode("apply");
});

/**
 * Every element of a drawer's markup, in document order.
 *
 * @param {DrawerSchema} schema
 * @returns {MarkupElement[]}
 */
const markup = (schema) => elements(render(html`<${Drawer} schema=${schema} />`)).sort((a, b) => a.start - b.start);

/**
 * Each tab panel's items in order: a row's key, a field's id, or `head` for a section header.
 *
 * @param {DrawerSchema} schema
 * @returns {Record<string, (string | undefined)[]>}
 */
function itemsByTab(schema) {
  const panels = markup(schema).filter((e) => classes(e).includes("dpanel"));
  return Object.fromEntries(
    panels.map((p) => [
      attr(p, "data-tab"),
      elements(p.html)
        .sort((a, b) => a.start - b.start)
        .filter((e) => classes(e).includes("drow") || classes(e).includes("msec"))
        .map((e) => (classes(e).includes("msec") ? "head" : (attr(e, "data-k") ?? attr(e, "data-field")))),
    ]),
  );
}

/**
 * The ids of the tabs carrying a dirty dot.
 *
 * @param {DrawerSchema} schema
 * @returns {(string | undefined)[]}
 */
const dottedTabs = (schema) =>
  markup(schema)
    .filter((e) => attr(e, "role") === "tab" && classes(e).includes("dirty"))
    .map((e) => attr(e, "data-tab"));

/**
 * The elements inside a field, found by its id.
 *
 * @param {string} id
 * @returns {MarkupElement[]}
 */
function inField(id) {
  const row = markup(SHAPING_DRAWER).find((e) => attr(e, "data-field") === id);
  return row ? elements(row.html) : [];
}

/**
 * The first vnode in a subtree whose props match `pred`.
 *
 * @param {unknown} node
 * @param {(props: Record<string, unknown>) => boolean} pred
 * @returns {VNode | undefined}
 */
function findIn(node, pred) {
  if (Array.isArray(node)) return node.map((n) => findIn(n, pred)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  const v = /** @type {VNode} */ (node);
  if (v.props && pred(v.props)) return v;
  return findIn(v.props?.children, pred);
}

/**
 * Tap option `value` of Shaping's field `id`.
 *
 * @param {string} id
 * @param {string} value
 */
async function tapField(id, value) {
  const { seen } = renderTree(html`<${Drawer} schema=${SHAPING_DRAWER} />`);
  const field = seen.find((v) => v.props?.["data-field"] === id);
  const hit = findIn(field?.props.children, (p) => p["data-v"] === value);
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
}

test("test_dsd_processing_draws_the_dsd_source_rows_of_each_output_mode", () => {
  assert.deepEqual(itemsByTab(DSD_DRAWER), {
    pcm: ["dsd_gain_6db", "noise_filter", "pcm_conversion"],
    sdm: ["direct_sdm", "sdm_integrator"],
  });
});

test("test_resampling_draws_each_modes_filters_and_its_sdm_tab_under_two_section_heads", () => {
  load({ pcm1x: "2", sdmnx: "2" });
  assert.deepEqual(itemsByTab(RESAMPLING_DRAWER), {
    pcm: ["pcm_filter_1x", "pcm_filter_nx", "fft_size"],
    sdm: ["head", "sdm_filter_1x", "sdm_filter_nx", "fft_size", "head", "sdm_conversion"],
  });
});

test("test_the_fft_length_row_shows_only_on_the_tab_whose_filter_is_fft_family", () => {
  load({ sdmnx: "2" });
  const tabs = itemsByTab(RESAMPLING_DRAWER);
  const fft = (/** @type {string} */ tab) => (tabs[tab] ?? []).includes("fft_size");
  assert.deepEqual([fft("pcm"), fft("sdm")], [false, true]);
});

test("test_the_fft_length_row_follows_a_staged_filter_pick", async () => {
  await edit("pcm_filter_nx", "2");
  assert.equal((itemsByTab(RESAMPLING_DRAWER).pcm ?? []).includes("fft_size"), true);
});

test("test_a_mode_drawer_opens_on_the_running_mode", () => {
  const sdm = MODE_DRAWERS.map((d) => shownTab(d));
  engineState.value = { state: "0", active_chain: "pcm" };
  const pcm = MODE_DRAWERS.map((d) => shownTab(d));
  assert.deepEqual(
    [sdm, pcm],
    [
      ["sdm", "sdm", "sdm"],
      ["pcm", "pcm", "pcm"],
    ],
  );
});

test("test_only_the_tab_of_the_mode_not_running_carries_a_status_word", () => {
  const worded = (/** @type {string} */ id) => {
    const tab = markup(DSD_DRAWER).find((e) => attr(e, "role") === "tab" && attr(e, "data-tab") === id);
    const word = tab ? elements(tab.html).find((e) => classes(e).includes("cst")) : undefined;
    return word ? text(word) !== "" : false;
  };
  assert.deepEqual([worded("pcm"), worded("sdm")], [true, false]);
});

test("test_a_mode_drawer_showing_the_mode_not_running_reads_idle", () => {
  const idle = () => {
    const aside = markup(SHAPING_DRAWER).find((e) => e.name === "aside");
    return aside ? classes(aside).includes("idle") : null;
  };
  const running = idle();
  showTab(SHAPING_DRAWER.id, "pcm");
  assert.deepEqual([running, idle()], [false, true]);
});

test("test_a_staged_dsd_source_gain_dots_the_pcm_tab_of_dsd_processing", async () => {
  await edit("dsd_gain_6db", "1");
  assert.deepEqual(dottedTabs(DSD_DRAWER), ["pcm"]);
});

test("test_a_staged_rate_conversion_dots_the_sdm_tab_of_resampling", async () => {
  await edit("sdm_conversion", "1");
  assert.deepEqual(dottedTabs(RESAMPLING_DRAWER), ["sdm"]);
});

/** Each row naming its own label, by catalog key, with the drawer it is in and its settings metadata key. */
const LABELED = [
  { key: "pcm_conversion", drawer: DSD_DRAWER, meta: "pdm_conversion" },
  { key: "direct_sdm", drawer: DSD_DRAWER, meta: "direct_sdm" },
  { key: "sdm_integrator", drawer: DSD_DRAWER, meta: "sdm_integrator" },
  { key: "sdm_conversion", drawer: RESAMPLING_DRAWER, meta: "sdm_conversion" },
];

for (const { key, drawer, meta } of LABELED) {
  test(`test_the_${key}_row_prints_its_own_label_with_a_sublabel_in_place_of_the_metadatas`, () => {
    metadata.value = { settings: { dsp: { [meta]: { label: "label-fixture", tooltip: "para-fixture" } } } };
    const row = markup(drawer).find((e) => attr(e, "data-k") === key);
    const inside = row ? elements(row.html) : [];
    const label = inside.find((e) => e.name === "b");
    assert.deepEqual(
      [label ? text(label) !== "label-fixture" : false, inside.some((e) => classes(e).includes("s"))],
      [true, true],
    );
  });
}

test("test_shaping_draws_the_dac_field_beside_each_modes_shaper", () => {
  assert.deepEqual(itemsByTab(SHAPING_DRAWER), {
    pcm: ["dactype", "pcm_dither"],
    sdm: ["dacchip", "sdm_modulator"],
  });
});

test("test_tapping_a_dac_type_sets_it_at_once", async () => {
  await tapField("dactype", "r2r");
  assert.equal(dacType.value, "r2r");
});

test("test_tapping_a_dac_chip_sets_it_at_once", async () => {
  await tapField("dacchip", "ess");
  assert.equal(dacChip.value, "ess");
});

test("test_the_dac_type_field_lights_the_type_held", () => {
  setDacType("r2r");
  const on = inField("dactype").find((e) => e.name === "button" && classes(e).includes("on"));
  assert.equal(on ? attr(on, "data-v") : undefined, "r2r");
});

test("test_shapings_pcm_tab_notes_the_dac_bits_the_output_holds", () => {
  load({ bits: 24 });
  const panel = markup(SHAPING_DRAWER).find((e) => classes(e).includes("dpanel") && attr(e, "data-tab") === "pcm");
  const note = panel ? elements(panel.html).find((e) => classes(e).includes("mnote")) : undefined;
  assert.equal(note ? text(note).includes("24") : false, true);
});
