// Shared harness for the components/Field.js suites — field.test.js (binding,
// classes, values, constraints, option sources, graying, unit/hint/rescan) and
// fielddesc.test.js (hover titles, inline notes, per-selection descriptions).
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// Rendering goes through preact-render-to-string against the VENDORED preact
// bundle (tests/js/vendor-resolve.js maps the importmap specifiers), so the
// suites exercise the code that ships rather than an npm substitute.
//
// State is driven through the store's exported source signals plus a faked wire
// for the staging round-trip (docs/testing.md rule 4 — no store function is ever
// stubbed). `reset()` reassigns EVERY signal Field reads on every call rather
// than only the ones a case cares about: module-level signals persist for the
// life of the process, so a partial reset makes tests pass alone and fail in
// sequence. `staged` is not exported, so it is cleared via discardAll().

import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Field } from "../../../hqptuner/static/components/Field.js";
import { config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import { staticWire } from "./wire.js";

// --- the wire ---------------------------------------------------------------
// Real REST paths, real response shapes (hqptuner/static/lib/api.js).

/** @typedef {import("./wire.js").StagedBuffer} StagedBuffer */

/**
 * One entry of a /api/config or /api/matrix field list: the name and value
 * every entry carries, plus the form metadata a /config field brings with it —
 * `options`, `min`, `max` and the rest, which the index signature admits.
 *
 * @typedef {{ [key: string]: unknown, name: string, value: unknown }} ConfigField
 */

/** @param {StagedBuffer} [staged] */
function wire(staged = { live: {}, http: {} }) {
  staticWire(staged);
}

// --- static metadata --------------------------------------------------------
// The /api/metadata payload shape: settings.json prose keyed by group, plus the
// filters.json / shapers.json name-keyed overlays.

export const META = {
  settings: {
    output: {
      output_mode: { label: "Output mode", tooltip: "Mode prose." },
      pcm_rate: { label: "PCM", tooltip: "Rate prose." },
      buffer_time: { label: "Buffer time", tooltip: "Buffer prose." },
      output_device: { label: "Output Device", tooltip: "Device prose." },
    },
    volume: {
      volume_max: { label: "Max volume", tooltip: "Max prose." },
    },
    dsp: {
      sdm_integrator: {
        label: "Integrator",
        tooltip: "Integrator prose.",
        options: { 0: "Fast integrator.", 1: "Slow integrator." },
      },
      filter_1x: { label: "1x filter", tooltip: "Filter prose." },
      shaper: { label: "Shaper", tooltip: "Shaper prose." },
    },
  },
  filters: {
    filters: {
      "sinc-M": { description: "A very long sinc." },
      "xtr-mp": { description: "Extra transient." },
      // The manual's caveat sentences ride alongside the description as
      // `notes` (hqptuner/data/filters.json); three shapes of overlay record
      // carry one: description + notes, empty description + notes, and notes
      // with no description key at all.
      "sinc-S": { description: "A short sinc.", notes: "Not recommended." },
      "sinc-V": { description: "", notes: "Only note." },
      "sinc-W": { notes: "Bare note." },
    },
    aliases: { "poly-sinc-xtr-mp": "xtr-mp" },
    two_stage_note: "Two stage oversampling.",
  },
  shapers: {
    pcm_dithers: {
      TPDF: { description: "Triangular dither." },
      NS9: { min_rate_hz: 352800 },
      NS1: { description: "First noise shaper.", notes: "Produces ultrasonic noise." },
    },
    sdm_modulators: {
      ASDM7: { description: "Seventh order modulator." },
      // A modulator the constraint file gives a rate FLOOR: below it the engine
      // produces no output at all, so the option row grays. The value sits
      // between the DSD512 and DSD1024 tiers, as the file's own floors do — the
      // manual states MHz thresholds rather than tiers.
      ASDM7EC: { min_rate_hz: 40960000 },
      // A second floor, so the reason a grayed row carries can be shown to name
      // the floor it was given rather than one constant. 6144000 is the DSD128
      // tier.
      ASDM5: { min_rate_hz: 6144000 },
      AHM5EC5L: { description: "Fifth order AHM.", notes: "Limited SNR." },
    },
  },
};

// --- reset ------------------------------------------------------------------

// The matrix defaults to ENGAGED. A post-process field under a bypassed matrix is
// grayed for that reason alone (store/schema.js matrixBypassed), which is a
// different behaviour from the ones these suites pin — a case that wants the
// bypass passes its own `matrix`.
const MATRIX_ENGAGED = [{ name: "enabled", value: "1" }];

/**
 * @param {{
 *   fields?: ConfigField[],
 *   matrix?: ConfigField[],
 *   meta?: import("../../../hqptuner/static/store/prose.js").Metadata,
 *   desc?: boolean,
 *   keep?: boolean,
 * }} [fixture]
 * @returns {Promise<void>}
 */
export async function reset({ fields = [], matrix = MATRIX_ENGAGED, meta = META, desc = true, keep = true } = {}) {
  wire();
  engineState.value = {};
  enums.value = null;
  metadata.value = meta;
  config.value = { fields, file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: matrix };
  showDescriptions.value = desc;
  keepOptionDescriptions.value = keep;
  resetNarrowing();
  await discardAll();
}

// Stage one http-lane edit against a wire that echoes it back, exactly as the
// server's pending buffer would.
/**
 * @param {string} key
 * @param {string | number | boolean} value
 * @param {Record<string, unknown>} http
 * @returns {Promise<void>}
 */
export async function stageEdit(key, value, http) {
  wire({ live: {}, http });
  await edit(key, value);
}

// --- rendering --------------------------------------------------------------
// SSR escapes entities; the contract is the text a user reads, not its encoding.

/**
 * @param {string} k
 * @returns {string}
 */
export const field = (k) =>
  render(html`<${Field} k=${k} />`)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

/** @param {string} out */
const rootAttrs = (out) => out.slice(0, out.indexOf(">"));

/** @param {string} out */
const classOf = (out) => (/class="([^"]*)"/.exec(rootAttrs(out)) || [])[1] || "";

/**
 * @param {string} out
 * @returns {string | undefined}
 */
export const titleOf = (out) => (/title="([^"]*)"/.exec(rootAttrs(out)) || [])[1];

/**
 * @param {string} out
 * @param {string} c
 * @returns {boolean}
 */
export const hasClass = (out, c) => classOf(out).split(/\s+/).includes(c);

/**
 * Text of one of the field's three prose lines (note / desc / gray reason).
 *
 * @param {string} out
 * @param {string} cls
 * @returns {string | null}
 */
export function line(out, cls) {
  const m = new RegExp(`<div class="${cls}">([\\s\\S]*?)</div>`).exec(out);
  return m ? m[1] : null;
}

// Locate the field's control row — the <div class="control">…</div> element the
// spec names. The class attribute must carry `control` as a whole token, so
// wrappers classed `field-control`, `control-row` or `controls` are not it.
// Nested <div>s are honoured. Null when there is no control row.
/**
 * @param {string} out
 * @returns {{ outer: number, start: number, end: number, after: number } | null}
 */
function findControlRow(out) {
  const openers = /<div\b[^>]*>/g;
  let open;
  while ((open = openers.exec(out || "")) !== null) {
    const cls = (/\bclass="([^"]*)"/.exec(open[0]) || [])[1] || "";
    if (!cls.split(/\s+/).includes("control")) continue;
    const start = open.index + open[0].length;
    const tags = /<(\/?)div\b[^>]*>/g;
    tags.lastIndex = start;
    let depth = 1;
    let m;
    while ((m = tags.exec(out)) !== null) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) return { outer: open.index, start, end: m.index, after: tags.lastIndex };
    }
    return null;
  }
  return null;
}

/**
 * Inner HTML of the field's control row. Null when there is no control row.
 *
 * @param {string} out
 * @returns {string | null}
 */
export function controlRow(out) {
  const at = findControlRow(out);
  return at ? out.slice(at.start, at.end) : null;
}

/**
 * The field with its control-row element excised — everything a caption sibling
 * of the control row would live in. Unchanged when there is no control row.
 *
 * @param {string} out
 * @returns {string}
 */
export function outsideControlRow(out) {
  const at = findControlRow(out);
  return at ? out.slice(0, at.outer) + out.slice(at.after) : out;
}

/**
 * Text of the gray-reason element in a fragment, whatever tag carries the class.
 * Found in two steps, the way advice() below does it: one regex that matches an
 * opening tag and a separate test of its class attribute. Asking a single
 * pattern for "a tag whose attributes contain this class somewhere" leaves the
 * engine re-splitting the attribute run at every offset, which is super-linear.
 *
 * @param {string} fragment
 * @returns {string | null}
 */
export function grayReason(fragment) {
  const openers = /<(\w+)\b[^<>]*>/g;
  let open;
  while ((open = openers.exec(fragment || "")) !== null) {
    const cls = (/\bclass="([^"]*)"/.exec(open[0]) || [])[1] || "";
    if (!/\bfield-gray-reason\b/.test(cls)) continue;
    const rest = fragment.slice(open.index + open[0].length);
    const close = new RegExp(`</${open[1]}>`).exec(rest);
    return close ? rest.slice(0, close.index) : null;
  }
  return null;
}

/**
 * Text of the advisory element in a fragment, whatever tag carries the class.
 * Distinct from the gray reason: an advisory says a setting does not apply to
 * the staged output mode, while leaving it editable.
 *
 * The class is matched as a WHOLE TOKEN, split on whitespace the way hasClass
 * does, because `-` is a word boundary: a `\bfield-advice\b` needle happily
 * matches `field-advice-note` and would report a different element's text as
 * the advisory.
 *
 * @param {string} fragment
 * @returns {string | null}
 */
export function advice(fragment) {
  const openers = /<(\w+)\b[^<>]*>/g;
  let open;
  while ((open = openers.exec(fragment || "")) !== null) {
    const cls = (/\bclass="([^"]*)"/.exec(open[0]) || [])[1] || "";
    if (!cls.split(/\s+/).includes("field-advice")) continue;
    const rest = fragment.slice(open.index + open[0].length);
    const close = new RegExp(`</${open[1]}>`).exec(rest);
    return close ? rest.slice(0, close.index) : null;
  }
  return null;
}

/**
 * @param {string} out
 * @param {string} cls
 * @returns {string | null}
 */
export const span = (out, cls) => {
  const m = new RegExp(`<span class="${cls}">([\\s\\S]*?)</span>`).exec(out);
  return m ? m[1] : null;
};

/**
 * @param {string} fragment
 * @param {string} name
 * @returns {string | undefined}
 */
export const attrOf = (fragment, name) => (new RegExp(`\\b${name}="([^"]*)"`).exec(fragment || "") || [])[1];

// Options come in two markups: native <option> tags, and the combobox's
// .dd-opt rows (desc-carrying dropdowns, controls/Combobox.js). Both expose
// the same {a, label} shape — a grayed row's aria-disabled satisfies the same
// \bdisabled\b probe the native attribute does.
/**
 * @param {string} out
 * @returns {{ a: string, label: string }[]}
 */
const opts = (out) => [
  ...[...out.matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)].map((m) => ({ a: m[1], label: m[2] })),
  // the favorite-star button is a row affordance, not label text
  ...[...out.matchAll(/<div([^>]*\bclass="dd-opt[^"]*"[^>]*)>([\s\S]*?)<\/div>/g)].map((m) => ({
    a: m[1],
    label: m[2].replace(/<button[^>]*\bdd-fav\b[^>]*>[\s\S]*?<\/button>/g, "").trim(),
  })),
];
/**
 * @param {string} out
 * @returns {string[]}
 */
export const optionLabels = (out) => opts(out).map((o) => o.label);

/**
 * @param {string} out
 * @param {string} label
 * @returns {{ a: string, label: string } | undefined}
 */
export const optionByLabel = (out, label) => opts(out).find((o) => o.label.startsWith(label));

/**
 * @param {string} out
 * @returns {string | null}
 */
export const activeSegment = (out) => {
  const m = /<button[^>]*class="seg active"[^>]*>([\s\S]*?)<\/button>/.exec(out);
  return m ? m[1].trim() : null;
};

/**
 * @param {string} out
 * @returns {boolean}
 */
export const isDisabled = (out) => /<(?:input|select)[^>]*\bdisabled\b/.test(out);
