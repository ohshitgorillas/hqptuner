// Rendered suite for hqptuner/static/components/faceplate/settings/visual.js, the Visual settings drawer's schema drawn
// by the stage drawer, and its readouts printed through the Settings rail: each tab's fields and block in order, a field
// tap writing its preference, a readout printing the label of the option its field lights, the hidden-stages readout, and
// the accent readout's swatch. The Display row, the display-format choice, is found by the four format ids it offers
// (tests/js/support/fields-offering.js), not by an id; its signal is read off the prefs module namespace with optional
// access, so a module without it fails those cases on their assertions.
//
// Renders `Drawer` through preact-render-to-string; a click is fired through the vnode seam
// (tests/js/support/vnodeseam.js), and the preferences are driven by assigning their exported signals. The theme store's
// document is a fake root (tests/js/store/theme.test.js shape), storage a fake map. Fields are found by id
// (`data-field`), blocks by name (`data-block`), options by value (`data-v`); a rail row by its readout's id. No label
// is asserted: a readout's text is compared with the label the drawer lights.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/visual.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { VISUAL_DRAWER, VISUAL_READOUTS } from "../../../../hqptuner/static/components/faceplate/settings/visual.js";
import { alertPlan } from "../../../../hqptuner/static/model/shell/alerts.js";
import { settingsRail } from "../../../../hqptuner/static/store/faceplate/settings/rail.js";
import { ACCENTS } from "../../../../hqptuner/static/store/faceplate/settings/visual.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import {
  HIDEABLE_STAGES,
  apodLight,
  bottomBar,
  hiddenStages,
  plainNames,
  topOfPage,
} from "../../../../hqptuner/static/store/ui/prefs.js";
import * as uiPrefs from "../../../../hqptuner/static/store/ui/prefs.js";
import { accent, accentHex, dyslexic } from "../../../../hqptuner/static/store/ui/theme.js";
import { fieldsOffering } from "../../support/fields-offering.js";
import { renderTree } from "../../support/vnodeseam.js";
import { elements, attr, classes, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */

/**
 * The globals the preference setters touch, viewed as optional members.
 *
 * @type {{ document?: unknown, localStorage?: unknown }}
 */
const env = globalThis;

/** @type {{ [k: string]: unknown, displayFormat?: { value: string } }} */
const prefs = uiPrefs;

const AUTO = "auto";
const EXPANDED = "expanded";
const NORMAL = "normal";
const COMPACT = "compact";
const FORMATS = [AUTO, EXPANDED, NORMAL, COMPACT];

/** @param {string} format */
function choose(format) {
  if (prefs.displayFormat) prefs.displayFormat.value = format;
}

/** A storage that keeps what it is handed. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (/** @type {string} */ k) => (map.has(k) ? map.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => map.set(k, v),
    removeItem: (/** @type {string} */ k) => map.delete(k),
  };
}

/** A root element the way the theme store touches it. */
const fakeDocument = () => ({
  documentElement: { dataset: {}, style: { setProperty: () => undefined, removeProperty: () => undefined } },
});

beforeEach(() => {
  env.localStorage = fakeStorage();
  plainNames.value = false;
  apodLight.value = "off";
  dyslexic.value = false;
  accent.value = "amber";
  accentHex.value = "";
  topOfPage.value = "auto";
  bottomBar.value = "switcher";
  hiddenStages.value = [];
  openStage.value = null;
  choose(AUTO);
});

afterEach(() => {
  delete env.document;
  delete env.localStorage;
});

/** Every element of the drawer's markup, in document order. @returns {MarkupElement[]} */
const markup = () => elements(render(html`<${Drawer} schema=${VISUAL_DRAWER} />`)).sort((a, b) => a.start - b.start);

/**
 * The elements inside one field.
 *
 * @param {string} id
 * @returns {MarkupElement[]}
 */
function inField(id) {
  const row = markup().find((e) => attr(e, "data-field") === id);
  return row ? elements(row.html) : [];
}

/**
 * What the lit option of a field reads, or null when none is lit.
 *
 * @param {string} id
 * @returns {string | null}
 */
function litLabel(id) {
  const on = inField(id).find((e) => e.name === "button" && classes(e).includes("on"));
  return on ? text(on) : null;
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
 * Tap option `value` of field `id`.
 *
 * @param {string} id
 * @param {string} value
 */
async function tap(id, value) {
  const { seen } = renderTree(html`<${Drawer} schema=${VISUAL_DRAWER} />`);
  const field = seen.find((v) => v.props?.["data-field"] === id);
  const hit = findIn(field?.props.children, (p) => p["data-v"] === value);
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
}

/**
 * The Settings rail row of one readout, by the readout's id.
 *
 * @param {string} id
 */
function railRow(id) {
  const [entry] = settingsRail(
    [{ id: "visual", name: "visual", readouts: VISUAL_READOUTS }],
    alertPlan([], {}),
    null,
    ACCENTS,
  );
  return entry.rows[VISUAL_READOUTS.findIndex((r) => r.id === id)];
}

/** The hidden-stages readout's control, or one printing the bare value without it. */
const hideControl = () => VISUAL_READOUTS.find((r) => r.id === "vhide")?.control ?? { type: "none" };

test("test_tapping_simplified_turns_plain_names_on", async () => {
  await tap("vstyle", "simplified");
  assert.equal(plainNames.value, true);
});

test("test_tapping_the_dyslexic_font_on_switches_the_font_on", async () => {
  env.document = fakeDocument();
  await tap("vdys", "1");
  assert.equal(dyslexic.value, true);
});

test("test_tapping_spectrum_puts_the_spectrum_at_the_top_of_the_page", async () => {
  await tap("vfill", "spectrum");
  assert.equal(topOfPage.value, "spectrum");
});

/** Per readout, the state that lights a non-default option of its field. */
const LIT = {
  vstyle: () => (plainNames.value = true),
  vapod: () => (apodLight.value = "uncorrected"),
  vdys: () => (dyslexic.value = true),
  vfill: () => (topOfPage.value = "profile"),
  vbottom: () => (bottomBar.value = "none"),
};

for (const [id, set] of Object.entries(LIT)) {
  test(`test_the_${id}_readout_prints_the_option_its_field_lights`, () => {
    set();
    assert.equal(railRow(id)?.text, litLabel(id));
  });
}

test("test_the_hidden_readout_offers_every_hideable_stage", () => {
  assert.deepEqual(
    hideControl().options?.map((o) => o.v),
    HIDEABLE_STAGES,
  );
});

test("test_the_accent_readout_swatches_a_custom_hex", () => {
  accentHex.value = "#123456";
  assert.equal(railRow("vacc")?.swatch, "#123456");
});

test("test_the_accent_readout_swatches_the_picked_preset_without_a_custom_hex", () => {
  accent.value = "violet";
  assert.equal(railRow("vacc")?.swatch, ACCENTS.find((a) => a.v === "violet")?.hex);
});

/** The id of the Display row, or a name no field carries when the drawer draws none. */
const displayRow = () =>
  fieldsOffering(render(html`<${Drawer} schema=${VISUAL_DRAWER} />`), FORMATS)[0] ?? "(no display row)";

/**
 * The option value the Display row lights, or null when none is lit.
 *
 * @returns {string | null}
 */
function litFormat() {
  const on = inField(displayRow()).find((e) => e.name === "button" && classes(e).includes("on"));
  return on ? (attr(on, "data-v") ?? null) : null;
}

test("test_the_visual_drawer_draws_one_field_offering_the_four_display_formats", () => {
  assert.equal(fieldsOffering(render(html`<${Drawer} schema=${VISUAL_DRAWER} />`), FORMATS).length, 1);
});

test("test_the_display_row_lights_the_display_format_currently_chosen", () => {
  choose(COMPACT);
  const compact = litFormat();
  choose(NORMAL);
  assert.deepEqual([compact, litFormat()], [COMPACT, NORMAL]);
});

test("test_tapping_a_display_format_chooses_it", async () => {
  choose(COMPACT);
  await tap(displayRow(), EXPANDED);
  assert.equal(prefs.displayFormat?.value, EXPANDED);
});

test("test_the_display_row_carries_one_explanatory_paragraph", () => {
  assert.equal(inField(displayRow()).filter((e) => e.name === "p" && text(e) !== "").length, 1);
});

test("test_the_display_readout_prints_the_display_format_its_field_lights", () => {
  const id = displayRow();
  const readout = () => railRow(id)?.text ?? "(no readout)";
  choose(COMPACT);
  const compact = [readout(), litLabel(id)];
  choose(EXPANDED);
  const expanded = [readout(), litLabel(id)];
  assert.deepEqual([compact[0], expanded[0]], [compact[1], expanded[1]]);
});
