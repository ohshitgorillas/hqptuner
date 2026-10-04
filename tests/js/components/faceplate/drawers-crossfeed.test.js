// Rendered suite for hqptuner/static/components/faceplate/drawers/Crossfeed.js, the Crossfeed drawer's block: the gate,
// the Bauer | Structural lines (the picked one holding its controls and copy, the other folded to its summary), what
// grays and what stays live, the writes its controls make, and which picture shows under the lines.
//
// Renders through preact-render-to-string; a click is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events. The store is driven at the wire by the staging fake, the /matrix form in
// `matrixConfig` and the rows in the /config file tree. Controls are found by option value (`data-v`), state-bearing
// classes and roles; every string asserted is a wire value the test put there or a number derived from one.
//
// Not reachable here: a slider drag and its release, which fire input and change events SSR never fires, and the
// plot's size, which follows the box it is laid out in. A browser run closes both.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/drawers-crossfeed.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { CrossfeedBody } from "../../../../hqptuner/static/components/faceplate/drawers/Crossfeed.js";
import { config, matrixConfig, metadata } from "../../../../hqptuner/static/store/signals.js";
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { liveParams, xfMode } from "../../../../hqptuner/static/store/xfeed/mode.js";
import { xfRefusal } from "../../../../hqptuner/static/store/faceplate/drawers/crossfeed.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../../../hqptuner/static/vendor/eqlab/core/matrixspec.js").PipelineRow} PipelineRow */

const EQ = "iir:type=peak;f=1000;q=1;g=-3";
const FC = 900;
const SCHEMA = { id: "crossfeed", title: "crossfeed", aria: "crossfeed", tabs: [] };

/** @param {string} source @param {string} mixdown @returns {PipelineRow} */
const row = (source, mixdown) => ({ gain: "-3", gainunit: "dB", mixdown, process: EQ, source });

/** @type {import("../../support/wire/wire.js").StagingWire} */
let wire;

/**
 * Load one state of the trees.
 *
 * @param {{ matrix?: boolean, enabled?: string, preset?: string, picked?: "bauer" | "structural" }} [s]
 */
async function load({ matrix = true, enabled = "1", preset = "default", picked = "bauer" } = {}) {
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: matrix },
      { name: "iir2fir", value: "0" },
      { name: "post_bauer_enabled", value: enabled },
      {
        name: "post_bauer_preset",
        value: preset,
        options: [
          { value: "default", label: "default" },
          { value: "custom", label: "custom" },
        ],
      },
      { name: "post_bauer_frequency", value: String(FC) },
      { name: "post_bauer_level", value: "7" },
    ],
  };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify([row("0", "0"), row("1", "1")]) } };
  await discardAll();
  xfMode.value = picked;
}

beforeEach(async () => {
  wire = stagingWire({ fallback: (w) => ok(w.staged) });
  metadata.value = null;
  liveParams.value = null;
  xfRefusal.value = "";
  await load();
});

/** Every element of the block's markup. @returns {MarkupElement[]} */
const markup = () => elements(render(html`<${CrossfeedBody} schema=${SCHEMA} />`));

/**
 * The elements inside the first element matching `pred`.
 *
 * @param {(el: MarkupElement) => boolean} pred
 * @returns {MarkupElement[]}
 */
function inside(pred) {
  const el = markup().find(pred);
  return el ? elements(el.html) : [];
}

/** @param {MarkupElement} e */
const isControl = (e) => ["button", "input", "select"].includes(e.name);
/** @param {MarkupElement[]} els */
const enabled = (els) => els.filter((e) => isControl(e) && !hasAttr(e, "disabled")).length;
/** @param {string} v @returns {(e: MarkupElement) => boolean} */
const line = (v) => (e) => classes(e).includes("xline") && attr(e, "data-v") === v;
/** @param {string} cls @returns {(e: MarkupElement) => boolean} */
const hasClass = (cls) => (e) => classes(e).includes(cls);

/**
 * Fire the handler of the first vnode matching `pred`.
 *
 * @param {(props: Record<string, unknown>) => boolean} pred
 * @param {string} [handler]
 */
async function fire(pred, handler = "onClick") {
  const { seen } = renderTree(html`<${CrossfeedBody} schema=${SCHEMA} />`);
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}));
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props[handler]);
  if (fn) await fn(undefined);
  await quiesce(wire);
}

test("test_the_picked_line_is_lit_and_the_other_folds", () => {
  const els = markup();
  const bauer = els.find(line("bauer"));
  const structural = els.find(line("structural"));
  assert.deepEqual(
    [bauer && classes(bauer).includes("cur"), structural && classes(structural).includes("fold")],
    [true, true],
  );
});

test("test_only_the_picked_line_holds_controls", () => {
  const bauer = inside(line("bauer")).filter(hasClass("xctl")).length;
  const structural = inside(line("structural")).filter(hasClass("xctl")).length;
  assert.deepEqual([bauer, structural], [1, 0]);
});

test("test_the_folded_line_prints_the_corner_it_would_install", async () => {
  await load({ preset: "custom", picked: "structural" });
  const sum = inside(line("bauer")).find(hasClass("xsum"));
  assert.equal(sum ? text(sum).includes(String(FC)) : false, true);
});

test("test_tapping_the_folded_lines_radio_picks_it", async () => {
  await fire((p) => p.role === "radio" && p["aria-checked"] === "false");
  assert.equal(xfMode.value, "structural");
});

test("test_a_bypassed_matrix_engine_disables_every_control", async () => {
  const live = enabled(markup());
  await load({ matrix: false });
  assert.deepEqual([live > 0, enabled(markup())], [true, 0]);
});

test("test_crossfeed_bypassed_leaves_the_gate_and_the_pick_live_and_grays_the_rest", async () => {
  await load({ enabled: "0" });
  const gate = enabled(inside(hasClass("xgate")));
  const controls = enabled(inside(hasClass("xctl")));
  const radios = markup().filter((e) => attr(e, "role") === "radio" && !hasAttr(e, "disabled")).length;
  assert.deepEqual([gate, controls, radios], [2, 0, 2]);
});

test("test_frequency_and_level_gray_off_the_custom_preset", async () => {
  const grayed = () => {
    const g = markup().find(hasClass("cgrp"));
    return g ? classes(g).includes("grayed") : null;
  };
  const preset = grayed();
  await load({ preset: "custom" });
  assert.deepEqual([preset, grayed()], [true, false]);
});

test("test_a_preset_tap_stages_that_preset", async () => {
  await fire((p) => p["data-v"] === "custom");
  assert.equal(effective("crossfeed_preset"), "custom");
});

test("test_the_gate_stages_the_picked_lines_switch", async () => {
  await load({ enabled: "1" });
  await fire((p) => p["data-v"] === "0");
  assert.equal(effective("crossfeed_enabled"), "0");
});

test("test_bauer_draws_its_plot_and_structural_its_listening_geometry", async () => {
  const pictures = () => {
    const els = markup();
    return [els.some(hasClass("xfplot")), els.some(hasClass("xfdiag"))];
  };
  const bauer = pictures();
  xfMode.value = "structural";
  assert.deepEqual(
    [bauer, pictures()],
    [
      [true, false],
      [false, true],
    ],
  );
});
