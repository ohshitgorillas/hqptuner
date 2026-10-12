// Rendered suite for hqptuner/static/components/faceplate/builders/ProfileSteps.js: a step page's title row with its
// count and close, its guide or skip line, its rows (none while skipped) and Back / Next landing past skipped steps;
// Listening's choice of the two ways to listen; Crossfeed's Off | Bauer | Structural lines, its "do you know your
// settings?" lines while engaged and the preset control or the whole block they lead to; DAC correction's gate and
// model rows; Loudness's gate row, its settings lines while engaged, the defaults staged or the block shown; and the
// Advanced settings page's three matrix engine rows and its way back to the overview.
//
// Driven at the wire, as tests/js/store/faceplate-builders/profile.test.js is: the stations and Fixed volume on
// `config`, the post-process form (the Bauer presets, the DAC models, the three gates, the loudness fields) on
// `matrixConfig`, staging through `stagingWire`'s real /api/config/stage path. The listening, the settings path each
// step takes and the page showing are the store's `meta`, `known` and `page`. Taps and changes are fired through the
// renderer's vnode seam, since render-to-string fires no events; every copy string asserted is read from the
// profile-data.js tables, every option the fixture's own.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-builders/profile-steps.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { StepPage, AdvancedPage } from "../../../../hqptuner/static/components/faceplate/builders/ProfileSteps.js";
import { config, matrixConfig, engineState } from "../../../../hqptuner/static/store/signals.js";
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import { edit, discardAll } from "../../../../hqptuner/static/store/actions.js";
import { schema } from "../../../../hqptuner/static/store/schema.js";
import { descriptions } from "../../../../hqptuner/static/store/matrix/descriptions.js";
import { NEW, OVERVIEW } from "../../../../hqptuner/static/model/builders/builder.js";
import { cur, staged, ask, refused } from "../../../../hqptuner/static/store/faceplate/builders/shell.js";
import { PB_STEPS } from "../../../../hqptuner/static/store/faceplate/builders/profile-data.js";
import {
  known,
  meta,
  page,
  openProfileBuilder,
  setListen,
} from "../../../../hqptuner/static/store/faceplate/builders/profile.js";
import { stagingWire, quiesce } from "../../support/wire/wire.js";
import { elements, attr, hasAttr, classes, text } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wheel.js").VNode} VNode */
/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

const LOADED = "Day";

/** The Bauer presets the matrix form offers, each with the fixture's own label. */
const BAUER = [
  { value: "default", label: "fx-Default" },
  { value: "cmoy", label: "fx-Moy" },
  { value: "jmeier", label: "fx-Meier" },
  { value: "custom", label: "fx-Custom" },
];
/** The DAC models the matrix form offers: none, and two models. */
const MODELS = [
  { value: "", label: "" },
  { value: "fx-dac-a", label: "fx-dac-a" },
  { value: "fx-dac-b", label: "fx-dac-b" },
];
/** The bass level the form holds, off the catalog's default. */
const LOW_LEVEL = "7";

/** The walk's step ids, in order. */
const IDS = PB_STEPS.map((s) => s.id);
/** Crossfeed's implementations, as the staged values name them. */
const XF = ["off", "bauer", "structural"];
/** The settings paths, as the store names them. */
const PATHS = ["preset", "values"];

/** A fresh /api/matrix payload: the post-process form with every gate off. */
const matrixTree = () => ({
  fields: [
    { name: "post_bauer_enabled", value: "0", options: [] },
    { name: "post_bauer_preset", value: "cmoy", options: BAUER },
    { name: "post_correction_enabled", value: "0", options: [] },
    { name: "post_correction_dac0", value: "fx-dac-a", options: MODELS },
    { name: "post_loudness_enabled", value: "0", options: [] },
    { name: "post_loudness_lowlevel", value: LOW_LEVEL, options: [] },
    { name: "post_loudness_rangelow", value: "-40", options: [] },
    { name: "post_loudness_rangehigh", value: "-10", options: [] },
  ],
  rows: [
    { gain: "0", gainunit: "dB", mixdown: "0", process: "", source: "0" },
    { gain: "0", gainunit: "dB", mixdown: "1", process: "", source: "1" },
  ],
  file_profiles: {},
  live_profiles: [],
  preset_profiles: { [LOADED]: [] },
  live_active: "",
});

/**
 * A fresh /config form: the stations, Day loaded, and Fixed volume.
 *
 * @param {{ fixed?: string }} [o]
 */
const configTree = ({ fixed = "0" } = {}) => ({
  fields: [{ name: "fixed_volume_enabled", value: fixed, options: [] }],
  file: {},
  profiles: { options: [{ value: "" }, { value: LOADED }, { value: "Night" }] },
  active: LOADED,
});

/** @type {StagingWire} */
let w;

beforeEach(async () => {
  w = stagingWire();
  engineState.value = {};
  config.value = configTree();
  matrixConfig.value = matrixTree();
  descriptions.value = {};
  await discardAll();
  staged.value = new Map();
  ask.value = null;
  refused.value = false;
  cur.value = { st: "", name: NEW };
  await openProfileBuilder();
  await quiesce(w);
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

/**
 * Stage one schema-key edit and let the wire settle.
 *
 * @param {string} key
 * @param {string} value
 */
async function staging(key, value) {
  await edit(key, value);
  await quiesce(w);
}

/**
 * Take one settings path on a step.
 *
 * @param {"crossfeed" | "loudness"} step
 * @param {string} v
 */
const path = (step, v) => {
  known.value = { ...known.value, [step]: v };
};

/** Listen on headphones with Bauer crossfeed engaged. */
async function bauerOn() {
  setListen("headphones");
  await staging("crossfeed_enabled", "1");
}

/** @param {string} id */
const step = (id) => html`<${StepPage} id=${id} />`;
const advanced = () => html`<${AdvancedPage} />`;

// --- markup ------------------------------------------------------------------------------------------------------

/**
 * Whether an element is a `name` carrying every class in `cls`.
 *
 * @param {MarkupElement | undefined} e
 * @param {string} name
 * @param {string[]} cls
 */
const isEl = (e, name, cls) => e !== undefined && e.name === name && cls.every((c) => classes(e).includes(c));

/**
 * Every element of a list that is a `name` with the classes in `cls`.
 *
 * @param {MarkupElement[]} all
 * @param {string} name
 * @param {...string} cls
 */
const every = (all, name, ...cls) => all.filter((e) => isEl(e, name, cls));

/**
 * The elements inside `e`, `e` itself left out; none when `e` is missing.
 *
 * @param {MarkupElement | undefined} e
 */
const inside = (e) => (e ? elements(e.html).slice(0, -1) : []);

/**
 * The elements directly inside `e`.
 *
 * @param {MarkupElement | undefined} e
 */
const kids = (e) => {
  const all = inside(e);
  return all.filter(
    (k) => !all.some((o) => o !== k && o.start <= k.start && o.start + o.html.length >= k.start + k.html.length),
  );
};

/**
 * What a reader sees inside an element, the renderer's entities decoded.
 *
 * @param {MarkupElement | undefined} e
 */
const said = (e) =>
  e
    ? text(e)
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&")
    : "";

/**
 * Every element of one render.
 *
 * @param {Parameters<typeof render>[0]} t
 */
const drawn = (t) => elements(render(t));

/**
 * The first `name.cls…` of one render.
 *
 * @param {Parameters<typeof render>[0]} t
 * @param {string} name
 * @param {...string} cls
 */
const one = (t, name, ...cls) => every(drawn(t), name, ...cls)[0];

/**
 * The elements inside a page's rows.
 *
 * @param {Parameters<typeof render>[0]} t
 */
const rowsOf = (t) => inside(one(t, "div", "pbsrows"));

/**
 * The `data-v` of each choice line in a list, in document order, those in `among` only.
 *
 * @param {MarkupElement[]} all
 * @param {string[]} among
 * @param {string} [cls]  a class the line also carries
 */
const lines = (all, among, cls) =>
  every(all, "div", "chline", ...(cls ? [cls] : []))
    .map((e) => attr(e, "data-v") ?? "")
    .filter((v) => among.includes(v));

/**
 * The `data-v` of each element pressed: lit, current, or checked.
 *
 * @param {MarkupElement[]} all
 */
const pressed = (all) =>
  all
    .filter(
      (e) =>
        attr(e, "data-v") !== undefined &&
        (classes(e).includes("on") ||
          classes(e).includes("cur") ||
          attr(e, "aria-pressed") === "true" ||
          attr(e, "aria-checked") === "true"),
    )
    .map((e) => attr(e, "data-v"));

/**
 * The element keyed `key` in a list.
 *
 * @param {MarkupElement[]} all
 * @param {string} key
 */
const keyedIn = (all, key) => all.find((e) => attr(e, "data-k") === key);

/**
 * How many blocks named `name` a list holds.
 *
 * @param {MarkupElement[]} all
 * @param {string} name
 */
const blocks = (all, name) => all.filter((e) => attr(e, "data-block") === name).length;

// --- vnodes ------------------------------------------------------------------------------------------------------

/** A vnode's classes. @param {VNode | undefined} v */
const vcls = (v) => (v ? String(propsOf(v).class ?? propsOf(v).className ?? "").split(/\s+/) : []);

/**
 * Whether a vnode is a host `name` carrying every class in `cls`.
 *
 * @param {VNode | undefined} v
 * @param {string} name
 * @param {...string} cls
 */
const isV = (v, name, ...cls) => v !== undefined && v.type === name && cls.every((c) => vcls(v).includes(c));

/**
 * Whether a value is a vnode.
 *
 * @param {unknown} c
 * @returns {c is VNode}
 */
const isVNode = (c) => typeof c === "object" && c !== null && "type" in c && "props" in c;

/**
 * The vnodes directly under `v`, empty slots left out.
 *
 * @param {VNode | undefined} v
 * @returns {VNode[]}
 */
const vkids = (v) => (v ? [propsOf(v).children].flat(Infinity).filter(isVNode) : []);

/**
 * `v` and every vnode under it, in document order; a component's own output is not under it.
 *
 * @param {VNode | undefined} v
 * @returns {VNode[]}
 */
const descend = (v) => (v ? [v, ...vkids(v).flatMap(descend)] : []);

/**
 * The first host vnode of one render carrying attribute `name` = `value`.
 *
 * @param {Parameters<typeof render>[0]} t
 * @param {string} name
 * @param {string} value
 */
const vby = (t, name, value) =>
  renderTree(t).seen.find((v) => typeof v.type === "string" && propsOf(v)[name] === value);

/**
 * Fire one handler of a vnode, if it carries it, and let the wire settle.
 *
 * @param {VNode | undefined} v
 * @param {string} [handler]
 * @param {Record<string, unknown>} [extra]  what the event carries beyond the no-op methods
 */
async function fire(v, handler = "onClick", extra = {}) {
  const fn = v ? propsOf(v)[handler] : undefined;
  if (typeof fn === "function") await fn({ preventDefault: () => {}, stopPropagation: () => {}, ...extra });
  await quiesce(w);
}

/**
 * Tap the control whose value is `v`: the button itself, else the radio of its line.
 *
 * @param {Parameters<typeof render>[0]} t
 * @param {string} v
 */
const tap = (t, v) => {
  const hit = vby(t, "data-v", v);
  return fire(hit?.type === "button" ? hit : descend(hit).find((n) => n.type === "button"));
};

/**
 * Tap the button whose value is `v` inside the row keyed `key`.
 *
 * @param {Parameters<typeof render>[0]} t
 * @param {string} key
 * @param {string} v
 */
const tapIn = (t, key, v) =>
  fire(descend(vby(t, "data-k", key)).find((n) => n.type === "button" && propsOf(n)["data-v"] === v));

/**
 * Pick `value` in the select inside the row keyed `key`.
 *
 * @param {Parameters<typeof render>[0]} t
 * @param {string} key
 * @param {string} value
 */
const pickIn = (t, key, value) => {
  const box = descend(vby(t, "data-k", key)).find((n) => n.type === "select");
  const target = { value };
  return fire(box, "onChange", { target, currentTarget: target });
};

/**
 * Tap the nav button at `at` (negative counts from the end).
 *
 * @param {Parameters<typeof render>[0]} t
 * @param {number} at
 */
const tapNav = (t, at) => {
  const nav = renderTree(t).seen.find((v) => isV(v, "div", "pbnav"));
  return fire(
    descend(nav)
      .filter((v) => v.type === "button")
      .at(at),
  );
};

// --- the step page -----------------------------------------------------------------------------------------------

test("test_the_guide_line_is_marked_skip_while_the_step_skips", () => {
  assert.equal(classes(one(step("crossfeed"), "p", "pbguide")).includes("skip"), true);
});

test("test_the_guide_line_is_not_marked_skip_once_the_step_applies", () => {
  setListen("headphones");
  assert.equal(classes(one(step("crossfeed"), "p", "pbguide")).includes("skip"), false);
});

test("test_the_rows_are_empty_while_the_step_skips", () => {
  assert.equal(rowsOf(step("crossfeed")).length, 0);
});

test("test_back_from_the_first_step_shows_the_overview", async () => {
  page.value = IDS[0];
  await tapNav(step(IDS[0]), 0);
  assert.equal(page.value, OVERVIEW);
});

// --- listening ---------------------------------------------------------------------------------------------------

test("test_listening_holds_one_row", () => {
  assert.deepEqual(
    kids(one(step("listen"), "div", "pbsrows")).map((k) => isEl(k, "div", ["drow"])),
    [true],
  );
});

test("test_listening_presses_speakers_while_the_chain_bypasses_crossfeed", () => {
  assert.deepEqual(pressed(rowsOf(step("listen"))), ["speakers"]);
});

test("test_listening_presses_the_way_the_edit_listens", () => {
  setListen("headphones");
  assert.deepEqual(pressed(rowsOf(step("listen"))), ["headphones"]);
});

test("test_tapping_the_other_way_to_listen_answers_it", async () => {
  await tap(step("listen"), "headphones");
  assert.equal(meta.value.listen, "headphones");
});

// --- crossfeed ---------------------------------------------------------------------------------------------------

test("test_crossfeed_marks_off_while_the_chain_bypasses_it", () => {
  setListen("headphones");
  assert.deepEqual(lines(rowsOf(step("crossfeed")), XF, "cur"), ["off"]);
});

test("test_crossfeed_marks_bauer_once_the_chain_engages_it", async () => {
  setListen("headphones");
  await staging("crossfeed_enabled", "1");
  assert.deepEqual(lines(rowsOf(step("crossfeed")), XF, "cur"), ["bauer"]);
});

test("test_tapping_bauer_engages_crossfeed", async () => {
  setListen("headphones");
  await tap(step("crossfeed"), "bauer");
  assert.equal(effective("crossfeed_enabled"), "1");
});

test("test_tapping_off_bypasses_crossfeed", async () => {
  await bauerOn();
  await tap(step("crossfeed"), "off");
  assert.equal(effective("crossfeed_enabled"), "0");
});

test("test_crossfeed_asks_for_no_settings_path_while_bypassed", () => {
  setListen("headphones");
  assert.equal(lines(rowsOf(step("crossfeed")), PATHS).length, 0);
});

test("test_crossfeed_asks_for_both_settings_paths_while_engaged", async () => {
  setListen("headphones");
  await staging("crossfeed_enabled", "1");
  assert.equal(lines(rowsOf(step("crossfeed")), PATHS).length, 2);
});

for (const v of PATHS) {
  test(`test_crossfeed_marks_the_${v}_path_once_taken`, async () => {
    await bauerOn();
    path("crossfeed", v);
    assert.deepEqual(lines(rowsOf(step("crossfeed")), PATHS, "cur"), [v]);
  });
}

test("test_tapping_enter_my_values_takes_that_path_for_crossfeed", async () => {
  await bauerOn();
  path("crossfeed", "preset");
  await tap(step("crossfeed"), "values");
  assert.equal(known.value.crossfeed, "values");
});

test("test_the_preset_path_offers_the_forms_bauer_presets", async () => {
  await bauerOn();
  path("crossfeed", "preset");
  const ctl = keyedIn(drawn(step("crossfeed")), "crossfeed_preset");
  const words = inside(ctl)
    .filter((e) => e.name === "option" || e.name === "button")
    .map(said);
  assert.deepEqual(
    words,
    BAUER.map((b) => b.label),
  );
});

for (const { name, taken, shown } of [
  { name: "test_the_preset_path_shows_no_crossfeed_block", taken: "preset", shown: 0 },
  { name: "test_the_values_path_shows_the_crossfeed_block", taken: "values", shown: 1 },
]) {
  test(name, async () => {
    await bauerOn();
    path("crossfeed", taken);
    assert.equal(blocks(rowsOf(step("crossfeed")), "crossfeed"), shown);
  });
}

// --- DAC correction ----------------------------------------------------------------------------------------------

test("test_tapping_engage_stages_dac_correction_on", async () => {
  await tapIn(step("correction"), "dac_correction_enabled", "1");
  assert.equal(effective("dac_correction_enabled"), "1");
});

test("test_the_model_row_offers_the_forms_dac_models", () => {
  const model = keyedIn(rowsOf(step("correction")), "dac_correction_profile");
  const box = every(inside(model), "select")[0];
  assert.deepEqual(
    every(inside(box), "option").map((o) => attr(o, "value") ?? (hasAttr(o, "value") ? "" : undefined)),
    MODELS.map((m) => m.value),
  );
});

test("test_picking_a_model_stages_it", async () => {
  await pickIn(step("correction"), "dac_correction_profile", "fx-dac-b");
  assert.equal(effective("dac_correction_profile"), "fx-dac-b");
});

// --- loudness ----------------------------------------------------------------------------------------------------

test("test_loudness_holds_only_its_gate_row_while_off", () => {
  const k = kids(one(step("loudness"), "div", "pbsrows"));
  assert.deepEqual(
    k.map((r) => attr(r, "data-k")),
    ["loudness_enabled"],
  );
});

test("test_loudness_asks_for_no_settings_path_while_off", () => {
  assert.equal(lines(rowsOf(step("loudness")), PATHS).length, 0);
});

test("test_loudness_asks_for_both_settings_paths_while_engaged", async () => {
  await staging("loudness_enabled", "1");
  assert.equal(lines(rowsOf(step("loudness")), PATHS).length, 2);
});

for (const v of PATHS) {
  test(`test_loudness_marks_the_${v}_path_once_taken`, async () => {
    await staging("loudness_enabled", "1");
    path("loudness", v);
    assert.deepEqual(lines(rowsOf(step("loudness")), PATHS, "cur"), [v]);
  });
}

test("test_tapping_enter_my_values_takes_that_path_for_loudness", async () => {
  await staging("loudness_enabled", "1");
  path("loudness", "preset");
  await tap(step("loudness"), "values");
  assert.equal(known.value.loudness, "values");
});

test("test_the_preset_path_shows_no_loudness_block", async () => {
  await staging("loudness_enabled", "1");
  path("loudness", "preset");
  assert.equal(blocks(rowsOf(step("loudness")), "loudness"), 0);
});

test("test_tapping_enter_my_values_shows_the_loudness_block", async () => {
  await staging("loudness_enabled", "1");
  path("loudness", "preset");
  await tap(step("loudness"), "values");
  assert.equal(blocks(rowsOf(step("loudness")), "loudness"), 1);
});

test("test_tapping_use_the_defaults_stages_the_bass_levels_default", async () => {
  await staging("loudness_enabled", "1");
  path("loudness", "values");
  await tap(step("loudness"), "preset");
  assert.equal(String(effective("loudness_low_level")), String(schema.loudness_low_level.def));
});

// --- advanced settings -------------------------------------------------------------------------------------------

test("test_advanced_settings_holds_the_engine_expand_hf_and_iir_to_fir_rows", () => {
  const rows = every(drawn(advanced()), "div", "drow").map((r) => attr(r, "data-k") ?? "");
  assert.deepEqual(rows.sort(), ["matrix_engine", "matrix_expand_hf", "matrix_iir2fir"]);
});

test("test_tapping_overview_shows_the_overview", async () => {
  page.value = "advanced";
  await tapNav(advanced(), 0);
  assert.equal(page.value, OVERVIEW);
});
