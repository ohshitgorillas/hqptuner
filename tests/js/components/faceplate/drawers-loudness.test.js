// Rendered suite for hqptuner/static/components/faceplate/drawers/Loudness.js, the Loudness drawer's block: the
// Bass | Treble switch with the shown side's four rows, the dot a hidden side's staged edit puts on the switch, what
// grays while loudness cannot act, the writes its controls make, the bounds boxes and the plot's applied figure.
//
// Renders through preact-render-to-string; a click is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events. The store is driven at the wire by the staging fake, the /matrix form in
// `matrixConfig`, the engine's reported volume in `volume`. Controls are found by schema key (`data-k`), option value
// (`data-v`) and state-bearing classes; every string asserted is a wire value or a number derived from one.
//
// Not reachable here: dragging a bound on the bar or a dot on the plot (pointer events SSR never fires), and the
// drawings' size, which follows the box they are laid out in. A browser run closes both.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/drawers-loudness.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { LoudnessBody } from "../../../../hqptuner/static/components/faceplate/drawers/Loudness.js";
import { config, liveOverride, matrixConfig, metadata, volume } from "../../../../hqptuner/static/store/signals.js";
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { loudnessSide } from "../../../../hqptuner/static/store/ui/ui.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const SCHEMA = { id: "loudness", title: "loudness", aria: "loudness", tabs: [] };
const TYPES = [
  { value: "lshelf", label: "lshelf" },
  { value: "peak", label: "peak" },
];

/** @type {import("../../support/wire/wire.js").StagingWire} */
let wire;

/**
 * Load the /matrix form with loudness on or off.
 *
 * @param {{ on?: boolean }} [s]
 */
async function load({ on = true } = {}) {
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: true },
      { name: "post_loudness_enabled", value: on },
      { name: "post_loudness_rangelow", value: "-60" },
      { name: "post_loudness_rangehigh", value: "-20" },
      { name: "post_loudness_lowtype", value: "lshelf", options: TYPES },
      { name: "post_loudness_lowfreq", value: "80" },
      { name: "post_loudness_lowsteep", value: "0.5" },
      { name: "post_loudness_lowlevel", value: "20" },
      { name: "post_loudness_hightype", value: "hshelf", options: TYPES },
      { name: "post_loudness_highfreq", value: "5000" },
      { name: "post_loudness_highsteep", value: "1" },
      { name: "post_loudness_highlevel", value: "10" },
    ],
  };
  config.value = {
    fields: [
      { name: "volume_min", value: "-60" },
      { name: "volume_max", value: "0" },
    ],
    file: {},
  };
  await discardAll();
}

beforeEach(async () => {
  wire = stagingWire({ fallback: (w) => ok(w.staged) });
  metadata.value = null;
  liveOverride.value = {};
  volume.value = "-40";
  loudnessSide.value = "low";
  await load();
});

/** Every element of the block's markup. @returns {MarkupElement[]} */
const markup = () => elements(render(html`<${LoudnessBody} schema=${SCHEMA} />`));
/** @param {string} cls @returns {(e: MarkupElement) => boolean} */
const hasClass = (cls) => (e) => classes(e).includes(cls);

/**
 * Fire the handler of the first vnode matching `pred`.
 *
 * @param {(props: Record<string, unknown>) => boolean} pred
 */
async function fire(pred) {
  const { seen } = renderTree(html`<${LoudnessBody} schema=${SCHEMA} />`);
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}));
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn(undefined);
  await quiesce(wire);
}

/** The schema keys of the band rows shown. */
const rowKeys = () =>
  markup()
    .filter(hasClass("lrow"))
    .map((e) => attr(e, "data-k"));

test("test_the_switch_shows_the_picked_sides_four_rows", () => {
  const bass = rowKeys();
  loudnessSide.value = "high";
  assert.deepEqual(
    [bass, rowKeys()],
    [
      ["loudness_low_type", "loudness_low_freq", "loudness_low_steep", "loudness_low_level"],
      ["loudness_high_type", "loudness_high_freq", "loudness_high_steep", "loudness_high_level"],
    ],
  );
});

test("test_the_hidden_side_holding_an_edit_carries_a_dot_on_its_switch_button", async () => {
  await edit("loudness_high_level", "6");
  const sw = markup().find(hasClass("lsw"));
  const dots = sw
    ? elements(sw.html)
        .filter((e) => e.name === "button")
        .map((e) => [attr(e, "data-v"), classes(e).includes("dirty")])
    : [];
  assert.deepEqual(dots, [
    ["low", false],
    ["high", true],
  ]);
});

test("test_loudness_off_disables_every_band_and_bound_control_and_says_why", async () => {
  const controls = () =>
    markup().filter((e) => (e.name === "input" || e.name === "button") && !hasAttr(e, "disabled")).length;
  const reason = () => {
    const gr = markup().find(hasClass("gr"));
    return gr ? !hasAttr(gr, "hidden") : false;
  };
  const on = [controls() > 0, reason()];
  await load({ on: false });
  assert.deepEqual(
    [on, [controls(), reason()]],
    [
      [true, false],
      [0, true],
    ],
  );
});

test("test_a_type_tap_stages_the_engine_token", async () => {
  await fire((p) => p["data-v"] === "peak");
  assert.equal(effective("loudness_low_type"), "peak");
});

test("test_a_side_tap_shows_that_side", async () => {
  await fire((p) => p["data-v"] === "high");
  assert.equal(loudnessSide.value, "high");
});

test("test_the_bounds_boxes_hold_the_staged_bounds", async () => {
  await edit("loudness_range_low", "-50");
  const box = (/** @type {string} */ k) => {
    const el = markup().find((e) => e.name === "input" && attr(e, "data-k") === k);
    return el ? attr(el, "value") : undefined;
  };
  assert.deepEqual([box("loudness_range_low"), box("loudness_range_high")], ["-50", "-20"]);
});

test("test_the_plot_names_the_share_of_shelving_the_volume_applies", () => {
  volume.value = "-50";
  const labels = markup()
    .filter((e) => e.name === "text" && attr(e, "data-trace") === "applied")
    .map(text);
  assert.equal(labels.join("").includes("75"), true);
});
