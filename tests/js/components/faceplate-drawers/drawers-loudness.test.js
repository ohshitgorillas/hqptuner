// Rendered suite for hqptuner/static/components/faceplate/drawers/Loudness.js, the Loudness drawer's block: the
// Bass | Treble switch with the shown side's four rows, the dot a hidden side's staged edit puts on the switch, what
// grays while loudness cannot act, the writes its controls make, the bounds boxes and the plot's applied figure.
//
// The restart mark: every loudness setting is a /matrix form field the engine reloads for
// (docs/spec/settings-classification.md), so each band row on the shown side carries the mark on its head, the bounds
// block carries one on its shared header with its boxes bare, and nothing else the block draws carries one, the
// playback readout included. The mark is found by its one style, the `rs` class token, and placed by markup position:
// a head is the run of markup from the end of the control before it to the end of its own control, so no copy and no
// layout is named.
//
// Renders through preact-render-to-string; a click is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events. The store is driven at the wire by the staging fake, the /matrix form in
// `matrixConfig`, the engine's reported volume in `volume`. Controls are found by schema key (`data-k`), option value
// (`data-v`) and state-bearing classes; every string asserted is a wire value or a number derived from one.
//
// Not reachable here: dragging a bound on the bar or a dot on the plot (pointer events SSR never fires), and the
// drawings' size, which follows the box they are laid out in. A browser run closes both.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-loudness.test.js

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
import { attr, classes, elements } from "../../support/markup.js";

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

/** The restart mark's one style, shared by every surface that carries it. */
const MARK = "rs";

/** The shown (low) side's band settings, each a restart setting with a row of its own. */
const BAND = ["loudness_low_level", "loudness_low_freq", "loudness_low_steep", "loudness_low_type"];

/** The bounds block's two settings, sharing one header. */
const RANGE = ["loudness_range_low", "loudness_range_high"];

/** @param {MarkupElement} e */
const end = (e) => e.start + e.html.length;

/** @param {MarkupElement} inner @param {MarkupElement} outer */
const within = (inner, outer) => inner.start >= outer.start && end(inner) <= end(outer);

/**
 * Whether the head of the control for `keys` carries the restart mark, or null when no control for them is drawn.
 * The control is the outermost wire-identified element (`data-k` or `data-v`) enclosing the first element keyed to
 * any of `keys`; its head runs from the end of the outermost wire-identified element before it to its own end.
 *
 * @param {MarkupElement[]} all
 * @param {string[]} keys
 * @returns {boolean | null}
 */
function headMarked(all, keys) {
  const keyed = all.filter((e) => keys.includes(attr(e, "data-k") ?? "")).sort((a, b) => a.start - b.start)[0];
  if (!keyed) return null;
  const wired = all.filter((e) => attr(e, "data-k") !== undefined || attr(e, "data-v") !== undefined);
  const top = wired.filter((e) => !wired.some((o) => o !== e && within(e, o)));
  const own = top.find((e) => within(keyed, e)) ?? keyed;
  const from = Math.max(0, ...top.filter((e) => end(e) <= own.start).map(end));
  return all.some((e) => classes(e).includes(MARK) && e.start >= from && end(e) <= end(own));
}

for (const key of BAND) {
  test(`test_the_${key}_row_carries_the_restart_mark_before_any_edit`, () => {
    assert.equal(headMarked(markup(), [key]), true);
  });
}

test("test_the_bounds_block_carries_the_restart_mark_on_its_header_before_any_edit", () => {
  assert.equal(headMarked(markup(), RANGE), true);
});

test("test_only_the_band_rows_and_the_bounds_header_carry_the_restart_mark", () => {
  assert.equal(markup().filter((e) => classes(e).includes(MARK)).length, BAND.length + 1);
});
