// Rendered suite for hqptuner/static/components/faceplate/drawers/Crossfeed.js, the Crossfeed drawer's block: the gate,
// the Bauer | Structural lines (the picked one holding its controls and copy, the other folded to its summary), what
// grays and what stays live, the writes its controls make, and which picture shows under the lines.
//
// The restart mark: the gate and the Bauer controls write http-lane settings the engine restarts for
// (docs/spec/settings-classification.md, Bauer crossfeed enable, preset and params), so each carries the mark on its
// own head; the Bauer | Structural lines are a view choice and carry none. The mark is found by its test handle, its
// `data-testid`, and a head is told apart by which controls the smallest element holding it and the control encloses.
//
// Renders through preact-render-to-string; a click is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events. The store is driven at the wire by the staging fake, the /matrix form in
// `matrixConfig` and the rows in the /config file tree. Controls are found by option value (`data-v`), state-bearing
// classes and roles; every string asserted is a wire value the test put there or a number derived from one.
//
// Not reachable here: a slider drag and its release, which fire input and change events SSR never fires, and the
// plot's size, which follows the box it is laid out in. A browser run closes both.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-crossfeed.test.js

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

/** The restart mark's test handle, shared by every surface that carries it. */
const MARK = "restart-mark";

/** @param {MarkupElement} e  whether the element is a restart mark */
const isMark = (e) => attr(e, "data-testid") === MARK;

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

/** A control's identity: its option value, its schema key, or its role. @param {MarkupElement} e */
const ident = (e) => attr(e, "data-v") ?? attr(e, "data-k") ?? attr(e, "role") ?? e.name;

/** @param {MarkupElement} outer @param {MarkupElement} inner */
const holds = (outer, inner) =>
  outer.start <= inner.start && inner.start + inner.html.length <= outer.start + outer.html.length;

/** Every element of the block's markup under one root, in document order. @returns {MarkupElement[]} */
const rooted = () =>
  elements(render(html`<div><${CrossfeedBody} schema=${SCHEMA} /></div>`)).sort((a, b) => a.start - b.start);

/**
 * The smallest element that holds every one of `anchors` and a restart mark, or undefined when none does.
 *
 * @param {MarkupElement[]} els
 * @param {MarkupElement[]} anchors
 * @returns {MarkupElement | undefined}
 */
function markHolder(els, anchors) {
  const marks = els.filter(isMark);
  const holders = els.filter(
    (e) => anchors.length > 0 && anchors.every((a) => holds(e, a)) && marks.some((m) => holds(e, m)),
  );
  return holders.sort((a, b) => a.html.length - b.html.length)[0];
}

/**
 * The controls enclosed by the smallest element that holds every control `anchor` picks and a restart mark, by
 * identity and sorted; empty when no element holds both. A mark on the anchor's own head yields the anchor's controls
 * alone; a mark found only on a shared or distant head yields more.
 *
 * @param {(e: MarkupElement) => boolean} anchor
 * @returns {string[]}
 */
function nearestMark(anchor) {
  const els = rooted();
  const head = markHolder(
    els,
    els.filter((e) => isControl(e) && anchor(e)),
  );
  return head
    ? els
        .filter((e) => isControl(e) && holds(head, e))
        .map(ident)
        .sort()
    : [];
}

/**
 * How many controls, number boxes aside, the smallest element holding a line's `nth` control of one kind and a
 * restart mark encloses; 0 when no element holds both. A mark on that control's own label yields 1, the control alone
 * (its number box is its partner, not another control); a mark found only on a shared or distant head yields more.
 *
 * @param {string} v the line's option value
 * @param {(e: MarkupElement) => boolean} kind
 * @param {number} nth
 * @returns {number}
 */
function controlsUnderNearestMark(v, kind, nth) {
  const els = rooted();
  const ln = els.find(line(v));
  const anchor = ln ? els.filter((e) => holds(ln, e) && kind(e))[nth] : undefined;
  const head = anchor ? markHolder(els, [anchor]) : undefined;
  return head ? els.filter((e) => isControl(e) && attr(e, "type") !== "number" && holds(head, e)).length : 0;
}

/** @param {string[]} values @returns {(e: MarkupElement) => boolean} */
const option = (values) => (e) => values.includes(attr(e, "data-v") ?? "");
/** @param {string} key @returns {(e: MarkupElement) => boolean} */
const keyed = (key) => (e) => attr(e, "data-k") === key;

const GATE = ["0", "1"];
const PRESETS = ["custom", "default"];
const FREQUENCY = "crossfeed_frequency";
const LEVEL = "crossfeed_level";

for (const { name, anchor, own } of [
  { name: "test_the_gates_name_carries_its_own_restart_mark", anchor: option(GATE), own: GATE },
  { name: "test_the_bauer_preset_label_carries_its_own_restart_mark", anchor: option(PRESETS), own: PRESETS },
  { name: "test_the_frequency_label_carries_its_own_restart_mark", anchor: keyed(FREQUENCY), own: [FREQUENCY] },
  { name: "test_the_level_label_carries_its_own_restart_mark", anchor: keyed(LEVEL), own: [LEVEL] },
]) {
  test(name, async () => {
    await load({ preset: "custom" });
    assert.deepEqual(nearestMark(anchor), own);
  });
}

for (const { name, checked } of [
  { name: "test_the_picked_bauer_lines_name_carries_no_restart_mark", checked: "true" },
  { name: "test_the_folded_structural_lines_name_carries_no_restart_mark", checked: "false" },
]) {
  test(name, async () => {
    await load({ preset: "custom" });
    const radio = (/** @type {MarkupElement} */ e) =>
      attr(e, "role") === "radio" && attr(e, "aria-checked") === checked;
    assert.equal(nearestMark(radio).length > 1, true);
  });
}

/** @param {MarkupElement} e */
const isSelect = (e) => e.name === "select";
/** @param {MarkupElement} e */
const isSlider = (e) => e.name === "input" && attr(e, "type") === "range";

// The Structural controls stage pipeline rows and the compensation control writes the same way, so each writes the
// pipelines setting, an http field the engine restarts for. Their option lists and labels are copy, so each is found
// by its kind and its place among its line's controls of that kind, in the spec's order.
for (const { name, picked, kind, nth } of [
  {
    name: "test_the_structural_preset_label_carries_its_own_restart_mark",
    picked: "structural",
    kind: isSelect,
    nth: 0,
  },
  { name: "test_the_speaker_angle_label_carries_its_own_restart_mark", picked: "structural", kind: isSlider, nth: 0 },
  {
    name: "test_the_head_circumference_label_carries_its_own_restart_mark",
    picked: "structural",
    kind: isSlider,
    nth: 1,
  },
  {
    name: "test_the_center_character_label_carries_its_own_restart_mark",
    picked: "structural",
    kind: isSlider,
    nth: 2,
  },
  {
    name: "test_the_crossfeed_compensation_label_carries_its_own_restart_mark",
    picked: "bauer",
    kind: isSlider,
    nth: 0,
  },
]) {
  test(name, async () => {
    await load({ preset: "custom", picked: /** @type {"bauer" | "structural"} */ (picked) });
    assert.equal(controlsUnderNearestMark(picked, kind, nth), 1);
  });
}
