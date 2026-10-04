// Rendered suite for hqptuner/static/components/faceplate/drawers/VolumeRange.js, the Volume drawer's Range block: the
// shared dBFS bar with the Min and Max brackets, the Startup pin, the loudness bounds and the live needle, the typed
// boxes under it, the loudness readouts, and the manual paragraphs beside them. What the block shows is decided in
// store/faceplate/drawers/volume.js, pinned in tests/js/store/faceplate/drawers-volume.test.js; this suite pins what
// the block draws from it and the write a typed box makes.
//
// Renders through preact-render-to-string. A typed value is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events; the store is driven at the wire by the staging fake. Controls and marks are
// found by their setting key (`data-k` on a box, `data-mark` on the bar); every string asserted is one the test put on the wire or into the metadata.
//
// Not reachable here: a drag on the bar, which reads the bar's on-screen box and takes pointer capture, and the bar
// redrawn at the width its well measures, which a resize observer reports. A browser run closes both.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/drawers-volume-range.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { VolumeRangeBody } from "../../../../hqptuner/static/components/faceplate/drawers/VolumeRange.js";
import {
  config,
  matrixConfig,
  metadata,
  volume,
  volumeDrag,
  volumeRange,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { quiesce, stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */

/**
 * @typedef {object} Running
 * @property {boolean} [fixed]     running fixed_volume_enabled
 * @property {string} [min]        running volume_min
 * @property {string} [startup]    running defaults_volume
 * @property {string} [max]        running volume_max
 * @property {boolean} [loudness]  running matrix engine and loudness both
 * @property {Record<string, string>} [report]  VolumeRange as the engine reports it
 */

const SCHEMA = { id: "volume", title: "volume-title", aria: "volume", tabs: [] };
const KEYS = ["volume_min", "startup_volume", "volume_max"];
const LOUD_KEYS = ["loudness_range_low", "loudness_range_high"];

/** Each setting's metadata: a label and a paragraph the suite can recognise. */
const META = {
  settings: {
    volume: Object.fromEntries(KEYS.map((k) => [k, { label: `${k}-label`, tooltip: `${k}-paragraph` }])),
    dsp: Object.fromEntries(LOUD_KEYS.map((k) => [k, { label: `${k}-label`, tooltip: `${k}-paragraph` }])),
  },
};

/** @type {StagingWire} */
let wire;

/** @param {Running} r */
function load(r = {}) {
  const s = {
    fixed: false,
    min: "-60",
    startup: "-20",
    max: "0",
    loudness: false,
    report: { enabled: "1", min: "-60", max: "0" },
    ...r,
  };
  config.value = {
    fields: [
      { name: "fixed_volume_enabled", value: s.fixed },
      { name: "volume_fixed", value: false },
      { name: "direct_sdm", value: false },
      { name: "volume_min", value: s.min },
      { name: "volume_max", value: s.max },
      { name: "defaults_volume", value: s.startup },
    ],
    file: { volume_fixed: "0" },
  };
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: s.loudness },
      { name: "post_loudness_enabled", value: s.loudness },
      { name: "post_loudness_rangelow", value: "-45" },
      { name: "post_loudness_rangehigh", value: "-15" },
    ],
  };
  volume.value = "-12.5";
  volumeDrag.value = null;
  volumeRange.value = s.report;
}

beforeEach(async () => {
  wire = stagingWire();
  metadata.value = META;
  load();
  await discardAll();
});

/** The block's markup, every element. */
const markup = () => elements(render(html`<${VolumeRangeBody} schema=${SCHEMA} />`));

/**
 * The block's markup for one running state.
 *
 * @param {Running} r
 */
const markupWith = (r) => (load(r), markup());

/**
 * The element of `tag` carrying `data-k` = `key`.
 *
 * @param {MarkupElement[]} els
 * @param {string} tag
 * @param {string} key
 */
const keyed = (els, tag, key) => els.find((el) => el.name === tag && attr(el, "data-k") === key);

/**
 * One attribute of each setting's box, in Min, Startup, Max order.
 *
 * @param {MarkupElement[]} els
 * @param {string} name
 */
const boxAttr = (els, name) => KEYS.map((k) => keyed(els, "input", k)).map((el) => el && attr(el, name));

/**
 * The bar's mark of each name (a setting key, or `needle`), as the dB it sits at.
 *
 * @param {MarkupElement[]} els
 * @param {string[]} names
 */
const marksAt = (els, names) =>
  names.map((n) => els.find((el) => attr(el, "data-mark") === n)).map((el) => el && attr(el, "data-db"));

/**
 * The text of every paragraph.
 *
 * @param {MarkupElement[]} els
 */
const paragraphs = (els) => els.filter((el) => el.name === "p").map(text);

// --- the boxes ---------------------------------------------------------------------------------------------------

test("test_each_box_holds_its_handles_effective_value", async () => {
  await edit("startup_volume", "-30");
  assert.deepEqual(boxAttr(markup(), "value"), ["-60", "-30", "0"]);
});

test("test_startup_is_fenced_by_min_and_max", () => {
  const fence = (/** @type {Running} */ r) => {
    const box = keyed(markupWith(r), "input", "startup_volume");
    return box && [attr(box, "min"), attr(box, "max")];
  };
  assert.deepEqual(
    [fence({}), fence({ min: "-70", max: "-3" })],
    [
      ["-60", "0"],
      ["-70", "-3"],
    ],
  );
});

test("test_a_typed_value_moves_its_handle_through_the_clamp", async () => {
  const { seen } = renderTree(html`<${VolumeRangeBody} schema=${SCHEMA} />`);
  const box = seen.find((v) => v.type === "input" && propsOf(v)["data-k"] === "volume_min");
  const onChange = /** @type {((e: unknown) => void) | undefined} */ (box && propsOf(box).onChange);
  onChange?.({ currentTarget: { value: "-10" } });
  await quiesce(wire);
  assert.equal(wire.staged.http.volume_min, "-20");
});

test("test_a_staged_handle_marks_its_box_dirty", async () => {
  await edit("volume_max", "-6");
  const dirty = KEYS.map((k) => keyed(markup(), "input", k)).map((el) => !!el && hasAttr(el, "data-dirty"));
  assert.deepEqual(dirty, [false, false, true]);
});

// --- gray --------------------------------------------------------------------------------------------------------

test("test_the_block_grays_whole_while_fixed_volume_is_on", () => {
  const grayed = (/** @type {Running} */ r) => {
    const root = markupWith(r).find((el) => classes(el).includes("vrange"));
    return root && classes(root).includes("grayed-range");
  };
  assert.deepEqual([grayed({}), grayed({ fixed: true })], [false, true]);
});

test("test_the_boxes_disable_while_the_block_is_grayed", () => {
  const off = (/** @type {Running} */ r) =>
    KEYS.map((k) => keyed(markupWith(r), "input", k)).map((el) => !!el && hasAttr(el, "disabled"));
  assert.deepEqual(
    [off({}), off({ fixed: true })],
    [
      [false, false, false],
      [true, true, true],
    ],
  );
});

// --- the bar -----------------------------------------------------------------------------------------------------

test("test_the_brackets_and_the_pin_sit_at_their_values", () => {
  assert.deepEqual(marksAt(markupWith({ min: "-70", startup: "-25", max: "-3" }), KEYS), ["-70", "-25", "-3"]);
});

test("test_the_loudness_bounds_ride_the_bar_while_loudness_runs", () => {
  assert.deepEqual(
    [marksAt(markupWith({}), LOUD_KEYS), marksAt(markupWith({ loudness: true }), LOUD_KEYS)],
    [
      [undefined, undefined],
      ["-45", "-15"],
    ],
  );
});

test("test_the_needle_rides_the_live_level_while_the_engine_reports_the_control", () => {
  const needle = (/** @type {Running} */ r) => marksAt(markupWith(r), ["needle"])[0];
  assert.deepEqual([needle({}), needle({ report: { enabled: "0", min: "-12", max: "0" } })], ["-12.5", undefined]);
});

// --- the loudness readouts and the manual ------------------------------------------------------------------------

test("test_the_loudness_readouts_show_while_loudness_runs", () => {
  const hidden = (/** @type {Running} */ r) => {
    const row = markupWith(r).find((el) => classes(el).includes("inl"));
    return row && hasAttr(row, "hidden");
  };
  assert.deepEqual([hidden({}), hidden({ loudness: true })], [true, false]);
});

test("test_the_manual_carries_each_settings_paragraph_from_the_metadata", () => {
  const said = paragraphs(markup());
  const carried = [...KEYS, ...LOUD_KEYS].map((k) => said.some((p) => p.includes(`${k}-paragraph`)));
  assert.deepEqual(carried, [true, true, true, true, true]);
});
