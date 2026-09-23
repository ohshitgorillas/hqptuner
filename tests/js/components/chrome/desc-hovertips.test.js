// Behavioral suite for the explanatory text that Setting descriptions governs
// at the sites that used to ignore it: with the preference on, the text stays
// inline and nothing hovers; with it off, the inline element goes and its words
// move to the hover tip of the control they explain.
//
// Each case is one relation read across two renders of the same site, once with
// `showDescriptions` on and once off: the decoded texts of the site's inline
// explanatory elements, paired with the decoded `title` of the tip target. The
// expected value is built from the on-state render itself, so no sentence the
// app owns is ever written here (docs/testing.md rule 9); what is pinned is that
// the element which leaves is the one whose words the tip then carries, and
// that the elements which stay are untouched.
//
// Elements and targets are found by class, `data-k`, `data-v`, `data-card` and
// `data-testid`, never by wording.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/chrome/desc-hovertips.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { System } from "../../../../hqptuner/static/components/tabs/SystemTab.js";
import { CrossfeedCard } from "../../../../hqptuner/static/components/xfeed/Card.js";
import { XfeedStrip, lensOn } from "../../../../hqptuner/static/components/xfeed/Comp.js";
import { Field } from "../../../../hqptuner/static/components/widgets/Field.js";
import {
  health,
  config,
  matrixConfig,
  metadata,
  engineState,
  enums,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import {
  showDescriptions,
  keepOptionDescriptions,
  setShowDescriptions,
} from "../../../../hqptuner/static/store/ui/prefs.js";
import { xfMode, liveParams, remember } from "../../../../hqptuner/static/store/xfeed/mode.js";
import { HEAD_RADIUS, SPEAKER_ANGLE } from "../../../../hqptuner/static/lib/binaural/geometry.js";
import { reset as resetField } from "../../support/field-harness.js";
import { staticWire, stagingWire } from "../../support/wire/wire.js";
import { section } from "../../support/tabform.js";
import { attr, classes, elements, hasAttr, labeled, text } from "../../support/markup.js";

/**
 * @typedef {import("../../support/markup.js").MarkupElement} MarkupElement
 * @typedef {import("../../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow
 * @typedef {[string[], string | undefined]} Reading
 */

// --- reading a render -----------------------------------------------------------

// What a reader sees: SSR's entity escapes undone, whitespace collapsed. The
// same normalization is applied to inline text and to a title, so the two are
// compared as the words a user reads rather than as their encodings.
/**
 * @param {string} s
 * @returns {string}
 */
const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * @param {MarkupElement} el
 * @returns {string}
 */
const words = (el) => decode(text(el));

// An element's hover tip, decoded; "" for a bare `title`, undefined for none.
/**
 * @param {MarkupElement} el
 * @returns {string | undefined}
 */
const tipOf = (el) => {
  const raw = attr(el, "title");
  if (raw !== undefined) return decode(raw);
  return hasAttr(el, "title") ? "" : undefined;
};

/**
 * @param {string} fragment
 * @param {string} cls
 * @returns {MarkupElement[]}
 */
const withClass = (fragment, cls) => elements(fragment).filter((el) => classes(el).includes(cls));

/**
 * @param {MarkupElement} outer
 * @param {MarkupElement} inner
 * @returns {boolean}
 */
const holds = (outer, inner) =>
  outer.start <= inner.start && outer.start + outer.html.length >= inner.start + inner.html.length;

/**
 * @param {MarkupElement[]} els
 * @returns {MarkupElement | undefined}
 */
const smallest = (els) =>
  els.reduce(
    (/** @type {MarkupElement | undefined} */ a, b) => (a && a.html.length <= b.html.length ? a : b),
    undefined,
  );

/**
 * @template T
 * @param {T | undefined} found
 * @param {string} what
 * @returns {T}
 */
const need = (found, what) => {
  if (found === undefined) throw new Error(`the render carries no ${what}`);
  return found;
};

// --- the HQPTuner card on the System tab ----------------------------------------

/**
 * @param {boolean} desc
 * @returns {Promise<void>}
 */
async function resetSystem(desc) {
  stagingWire();
  health.value = { info: {}, license: null };
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  matrixConfig.value = { fields: [] };
  config.value = { fields: [], file: {}, active: "", profiles: null };
  showDescriptions.value = desc;
  keepOptionDescriptions.value = true;
  await discardAll();
}

// One row of the card, by the `data-k` it wears: its `.field-note` texts, and
// the title on the row's root `.field`, the smallest `.field` holding that key.
/**
 * @param {string} key
 * @returns {(desc: boolean) => Promise<Reading>}
 */
const systemRow = (key) => async (desc) => {
  await resetSystem(desc);
  const card = section(render(html`<${System} />`), "hqptuner");
  const keyed = labeled(card, key);
  const root = need(
    smallest(withClass(card, "field").filter((el) => holds(el, keyed))),
    `.field around the row keyed "${key}"`,
  );
  return [withClass(root.html, "field-note").map(words), tipOf(root)];
};

// --- the crossfeed card, Bauer view ---------------------------------------------

/** @returns {PipelineRow[]} */
const pair = () => [
  { gain: "-3", gainunit: "dB", mixdown: "0", process: "iir:type=peak;f=1000;q=1;g=-3", source: "0" },
  { gain: "-3", gainunit: "dB", mixdown: "1", process: "iir:type=peak;f=1000;q=1;g=-3", source: "1" },
];

/**
 * @param {PipelineRow[]} rows
 * @param {boolean} desc
 * @returns {Promise<void>}
 */
async function resetCrossfeed(rows, desc) {
  staticWire();
  matrixConfig.value = {
    fields: [
      { name: "post_bauer_enabled", value: "1" },
      { name: "post_bauer_preset", value: "default" },
      { name: "post_bauer_frequency", value: "700" },
      { name: "post_bauer_level", value: "4.5" },
      { name: "iir2fir", value: "0" },
    ],
  };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify(rows) } };
  setShowDescriptions(desc);
  keepOptionDescriptions.value = false;
  xfMode.value = "bauer";
  liveParams.value = null;
  remember({ lambda: 1, angle: SPEAKER_ANGLE, headRadius: HEAD_RADIUS });
  lensOn.value = false;
  await discardAll();
}

/**
 * @param {boolean} desc
 * @returns {Promise<Reading>}
 */
async function crossfeedTop(desc) {
  await resetCrossfeed(pair(), desc);
  const out = render(html`<${CrossfeedCard} />`);
  const top = need(withClass(out, "xfs-top")[0], ".xfs-top stack");
  const views = elements(out).filter(
    (el) =>
      el.name === "span" &&
      classes(el).includes("segment") &&
      /\sdata-v="bauer"/.test(el.html) &&
      /\sdata-v="structural"/.test(el.html),
  );
  const target = need(smallest(views), "span.segment carrying the bauer and structural views");
  return [withClass(top.html, "field-note").map(words), tipOf(target)];
}

// --- the compensation strip ---------------------------------------------------

// The strip, with its `.xfc-scale` span texts and the title on the first
// element carrying `cls`. The slider is read off the strip alone; the mini plot
// is drawn by the Bauer card around it, so that row reads the card. A locked
// strip must render its range input disabled, or the fixture never reached the
// state the row names.
/**
 * @param {string} cls
 * @param {PipelineRow[]} rows
 * @param {boolean} locked
 * @param {"strip" | "card"} surface
 * @returns {(desc: boolean) => Promise<Reading>}
 */
const stripRow = (cls, rows, locked, surface) => async (desc) => {
  await resetCrossfeed(rows, desc);
  const out = surface === "card" ? render(html`<${CrossfeedCard} />`) : render(html`<${XfeedStrip} />`);
  const strip = surface === "card" ? need(withClass(out, "xfc-strip")[0], ".xfc-strip in the card").html : out;
  const range = need(
    elements(strip).find((el) => el.name === "input" && attr(el, "type") === "range"),
    "range input in the strip",
  );
  if (hasAttr(range, "disabled") !== locked)
    throw new Error(`the strip's range input is not ${locked ? "locked" : "unlocked"}`);
  const target = need(withClass(out, cls)[0], `.${cls} in the ${surface}`);
  return [withClass(strip, "xfc-scale").map(words), tipOf(target)];
};

// --- the rescan fields ----------------------------------------------------------

/**
 * @param {string} key
 * @param {boolean} autosave
 * @returns {(desc: boolean) => Promise<Reading>}
 */
const rescanRow = (key, autosave) => async (desc) => {
  await resetField({ desc, keep: false });
  config.value = { ...config.value, autosave };
  const out = render(html`<${Field} k=${key} />`);
  const button = need(
    elements(out).find((el) => attr(el, "data-testid") === "rescan"),
    `rescan button on ${key}`,
  );
  return [withClass(out, "field-rescan-cost").map(words), tipOf(button)];
};

// --- the sweep --------------------------------------------------------------------

const LOCKED = [pair()[0]];

/** @type {{ name: string, converted: number | null, read: (desc: boolean) => Promise<Reading> }[]} */
const ROWS = [
  { name: "the_show_descriptions_row", converted: 0, read: systemRow("showDescriptions") },
  { name: "the_keep_option_descriptions_row", converted: 0, read: systemRow("keepOptionDescriptions") },
  { name: "the_apodizing_indicator_row", converted: 0, read: systemRow("apodLight") },
  { name: "the_dyslexic_font_row", converted: 0, read: systemRow("dyslexic") },
  { name: "the_crossfeed_view_switch", converted: 0, read: crossfeedTop },
  { name: "the_unlocked_compensation_slider", converted: 1, read: stripRow("slidernum", pair(), false, "strip") },
  { name: "the_locked_compensation_slider", converted: 1, read: stripRow("slidernum", LOCKED, true, "strip") },
  { name: "the_compensation_mini_plot", converted: 1, read: stripRow("xfc-mini", pair(), false, "card") },
  { name: "the_alsa_device_rescan_button", converted: 0, read: rescanRow("alsa_device", true) },
  { name: "the_net_device_rescan_button", converted: 0, read: rescanRow("net_device", true) },
  // With autosave off the caption's sentence is false, so there is nothing to
  // convert: no caption inline and no tip, in either state.
  { name: "the_alsa_device_rescan_button_with_autosave_off", converted: null, read: rescanRow("alsa_device", false) },
];

// The relation a row owes, built from its own on-state reading: on, every inline
// text and no tip; off, the same texts less the converted one, and that one's
// words on the tip. A row whose on state carries no converted element owes a tip
// reading this marker, which no render produces. A row converting nothing owes
// no texts and no tip in both states.
/**
 * @param {Reading} on
 * @param {number | null} converted
 * @returns {{ on: Reading, off: Reading }}
 */
const owed = ([texts], converted) => {
  if (converted === null) return { on: [[], undefined], off: [[], undefined] };
  return {
    on: [texts, undefined],
    off: [
      texts.filter((_, i) => i !== converted),
      converted < texts.length ? texts[converted] : "(no converted element at the on state)",
    ],
  };
};

for (const row of ROWS) {
  test(`test_${row.name}_reads_its_explanation_inline_with_setting_descriptions_on_and_as_a_hover_tip_with_them_off`, async () => {
    const on = await row.read(true);
    const off = await row.read(false);
    assert.deepEqual({ on, off }, owed(on, row.converted));
  });
}
