// The narrow bar as its component suites read it: one reset that puts every
// module-level signal the bar reads back to a stated starting state, one render,
// and the markup readers that name a switch group by the `data-group` its own
// element carries rather than by the heading a reader sees above it.
//
// Shared by tests/js/components/narrowbar-lossy.test.js and
// tests/js/components/narrowbar-srcformat.test.js. Fakes sit at the wire and
// nothing of HQPTuner's is stubbed (docs/testing.md rule 4): state is driven by
// assigning the exported source signals the real payloads carry — the engine's
// own `<GetFilters/>` enumeration (protocol.md:226) and the static name-keyed
// overlay from /api/metadata — by resetNarrowing(), and by the descriptions
// preference's own signals.

import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { NarrowBar } from "../../../hqptuner/static/components/narrowbar/Bar.js";
import { config, matrixConfig, enums, metadata, engineState } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { staticWire } from "./wire.js";
import { elements, classes, text } from "./markup.js";

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */

/**
 * Put the bar back to a stated starting state. The keep-option preference is
 * held ON throughout, so a group gated on OPTION descriptions rather than on the
 * master "Setting descriptions" pref fails a case instead of passing it.
 *
 * @param {Record<string, unknown>[]} filters
 * @param {{ notes?: boolean }} [prefs]
 * @returns {Promise<void>}
 */
export async function resetBar(filters, { notes = true } = {}) {
  staticWire();
  engineState.value = {};
  enums.value = { filters };
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  config.value = { fields: [], file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: [] };
  resetNarrowing();
  keepOptionDescriptions.value = true;
  showDescriptions.value = notes;
  await discardAll();
}

/**
 * The bar as a caller mounts it. Props are passed through, so a caller that
 * mounts it with `srcFormat` off is rendered here the same way the page does.
 *
 * @param {Record<string, unknown>} [props]
 * @returns {string}
 */
export const renderBar = (props = {}) => render(html`<${NarrowBar} ...${props} />`);

/**
 * The characters a reader sees, with the entities the renderer emits put back.
 *
 * @param {string} s
 * @returns {string}
 */
export const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * What a reader sees inside an element.
 *
 * @param {MarkupElement} el
 * @returns {string}
 */
export const seen = (el) => decode(text(el));

/**
 * @param {MarkupElement} el
 * @returns {boolean}
 */
export const isSegment = (el) => classes(el).includes("segment");

/**
 * @param {MarkupElement} el
 * @param {MarkupElement} inner
 * @returns {boolean}
 */
export const encloses = (el, inner) =>
  inner.start >= el.start && inner.start + inner.html.length <= el.start + el.html.length;

/**
 * An element's attribute, as a reader sees it, or undefined.
 *
 * @param {MarkupElement} el
 * @param {string} name
 * @returns {string | undefined}
 */
export const attr = (el, name) => {
  const m = new RegExp(`(^|\\s)${name}="([^"]*)"`).exec(el.attrs);
  return m ? decode(m[2]) : undefined;
};

/**
 * Every element the bar marks with a group id, `data-group` — the group's own
 * machine identity, contract like any other wire-side marking, so a reworded
 * heading changes nothing (docs/testing.md rule 9).
 *
 * @param {string} out
 * @param {string} name
 * @returns {MarkupElement[]}
 */
const marked = (out, name) => elements(out).filter((el) => attr(el, "data-group") === name);

/**
 * Every element of the bar that both carries a group id and encloses a segmented
 * switch — the candidates a switch group is picked from.
 *
 * @param {string} out
 * @param {string} name
 * @returns {MarkupElement[]}
 */
function groupCandidates(out, name) {
  const segments = elements(out).filter(isSegment);
  return marked(out, name).filter((el) => segments.some((s) => encloses(el, s)));
}

/**
 * The switch group an id names: the smallest element of the bar that both
 * carries that id and encloses a segmented switch.
 *
 * @param {string} out
 * @param {string} name
 * @returns {MarkupElement}
 */
export function group(out, name) {
  const hits = groupCandidates(out, name);
  if (hits.length === 0) throw new Error(`no "${name}" switch group in the rendered bar`);
  return hits.reduce((a, b) => (a.html.length <= b.html.length ? a : b));
}

/**
 * Whether a rendered bar offers the switch group an id names.
 *
 * @param {string} out
 * @param {string} name
 * @returns {boolean}
 */
export const hasGroup = (out, name) => groupCandidates(out, name).length > 0;

/**
 * Whether the bar renders the group at all, segmented switch or not. The
 * companion `hasGroup` asks about the group's SHAPE, so on its own it also
 * answers false for a control that is still on screen and has merely stopped
 * being a segmented switch; an absence case asks both.
 *
 * @param {string} out
 * @param {string} name
 * @returns {boolean}
 */
export const mentions = (out, name) => marked(out, name).length > 0;

/**
 * How many reset buttons a rendering offers, named by the `narrow-reset` class
 * the button carries rather than by the word a reader presses. A CSS class is a
 * machine identifier, unlike the caption on it (docs/testing.md rule 9).
 *
 * @param {string} out
 * @returns {number}
 */
export const resets = (out) =>
  elements(out).filter((el) => el.name === "button" && classes(el).includes("narrow-reset")).length;

/**
 * The segmented switches inside one group, outermost first.
 *
 * @param {MarkupElement} region
 * @returns {MarkupElement[]}
 */
export const switchesIn = (region) =>
  elements(region.html)
    .filter(isSegment)
    .sort((a, b) => a.start - b.start);

/**
 * The wording on each segment of a group's switch, in order.
 *
 * @param {MarkupElement} region
 * @returns {string[]}
 */
export function segmentLabels(region) {
  const [strip] = switchesIn(region);
  if (!strip) throw new Error("no segmented switch in this group");
  return [...strip.html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => decode(m[1].trim()));
}
