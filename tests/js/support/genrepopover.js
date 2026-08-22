// The narrow bar's facet popovers as the suites that read a CHOICE ROW read
// them: one reset that puts the bar's source signals back to a stated starting
// state, one way to open a facet, and the row readers.
//
// Shared by tests/js/components/narrowbar.test.js,
// tests/js/components/narrowbar-genre-any.test.js and
// tests/js/components/narrowbar-genre-merge.test.js. Fakes sit at the wire and
// nothing of HQPTuner's is stubbed (docs/testing.md rule 4): state is driven by
// assigning the exported source signals the real payloads carry — the engine's
// own `<GetFilters/>` enumeration (protocol.md:226) and the static name-keyed
// genre overlay from /api/metadata — and by resetNarrowing().
//
// A popover renders nothing until it is open, and it opens on its button's
// click handler; preact-render-to-string never fires one and there is no DOM
// here, so a facet is opened the way tests/js/components/narrowbar.test.js
// opens one: by invoking the onClick the button carries, collected through
// preact's own `options.vnode` creation hook (the renderer's public seam,
// third-party surface). Which facet is open is a module private that outlives a
// test and resetNarrowing() does not touch, so the click is a TOGGLE and the
// starting state is read off the screen rather than assumed.
//
// Reading rows out of the emitted HTML couples these suites to the bar's
// element structure — the `data-multi` block a facet lives in, the button
// inside it, and the `data-v` each row's label carries. Accepted: SSR is the
// house pattern for component suites and there is no browser harness on this
// host. A markup change fails those cases for a reason that is not a
// regression; check the shape before reading the failure as one.

import { options } from "preact";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { NarrowBar } from "../../../hqptuner/static/components/narrowbar/Bar.js";
import { config, matrixConfig, enums, metadata, engineState } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import { staticWire } from "./wire.js";

/** @typedef {import("./wheel.js").VNode} VNode */

/**
 * A vnode whose props carry a click handler, as `buttonsIn` selects for.
 *
 * @typedef {{
 *   type: string | Function,
 *   props: import("./wheel.js").VNodeProps & { onClick: (event: unknown) => void },
 * }} ClickableVNode
 */

/**
 * Put the bar back to a stated starting state: the given engine enumeration,
 * the given static genre overlay, the given /config form fields (the dropdowns
 * a row's count chip counts), and every narrowing facet at its default.
 *
 * @param {Record<string, unknown>[]} filters
 * @param {{ overlay?: Record<string, { genre?: string[] }>, fields?: Record<string, unknown>[] }} [scenario]
 * @returns {Promise<void>}
 */
export async function resetNarrowBar(filters, { overlay = {}, fields = [] } = {}) {
  staticWire();
  engineState.value = {};
  enums.value = { filters };
  metadata.value = {
    settings: {},
    filters: { filters: overlay, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  config.value = { fields, file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: [] };
  resetNarrowing();
  await discardAll();
}

/**
 * One render, with every vnode preact built along the way. `options.vnode` is
 * preact's own creation hook; it is restored even if the render throws.
 *
 * @returns {{ out: string, seen: VNode[] }}
 */
function renderBar() {
  /** @type {VNode[]} */
  const seen = [];
  const previous = options.vnode;
  options.vnode = (/** @type {VNode} */ vnode) => {
    seen.push(vnode);
    if (previous) previous(vnode);
  };
  try {
    return { out: render(html`<${NarrowBar} />`), seen };
  } finally {
    options.vnode = previous;
  }
}

/**
 * The bar as a caller mounts it, as HTML.
 *
 * @returns {string}
 */
export const renderNarrowBar = () => renderBar().out;

/**
 * Every button inside one vnode, in document order.
 *
 * @param {unknown} node
 * @param {ClickableVNode[]} [found]
 * @returns {ClickableVNode[]}
 */
function buttonsIn(node, found = []) {
  if (Array.isArray(node)) {
    for (const kid of node) buttonsIn(kid, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  const v = /** @type {VNode} */ (node);
  if (v.type === "button" && v.props && typeof v.props.onClick === "function")
    found.push(/** @type {ClickableVNode} */ (node));
  return buttonsIn(v.props && v.props.children, found);
}

/**
 * One click on the given facet's own button, as a pointer would land on it.
 * Anything other than exactly one match throws rather than clicking something
 * else: a restructured bar must fail loudly, not open the wrong facet.
 *
 * @param {string} name
 * @returns {void}
 */
function clickFacet(name) {
  const blocks = renderBar().seen.filter((v) => v && v.props && v.props["data-multi"] === name);
  if (blocks.length !== 1) throw new Error(`expected one ${name} facet, found ${blocks.length}`);
  const buttons = buttonsIn(blocks[0]);
  if (buttons.length !== 1) throw new Error(`expected one button for ${name}, found ${buttons.length}`);
  buttons[0].props.onClick({ preventDefault() {}, stopPropagation() {} });
}

/**
 * One facet's own block, so nothing is read off the rest of the bar.
 *
 * @param {string} out
 * @param {string} name
 * @returns {string}
 */
function facet(out, name) {
  const start = out.indexOf(`data-multi="${name}"`);
  if (start < 0) throw new Error(`no facet block for ${name} in the rendered bar`);
  const rest = out.slice(start + 1);
  const ends = ["data-multi=", "narrow-switchcols"].map((m) => rest.indexOf(m)).filter((i) => i >= 0);
  return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
}

// A choice row is the `<label>` carrying the option's own wire value in
// `data-v`, so a row is named by that value and never by the caption beside the
// input (docs/testing.md rule 9).
//
// The value may be the EMPTY STRING — a legitimate wire value (the phase
// taxonomy's "no phase" is one) — and preact-render-to-string emits an empty
// attribute VALUELESS, as `<label class data-v>` rather than `data-v=""`. So the
// quotes are optional here, the same way markup.js `hasAttr` treats them, or the
// empty row is invisible to every reader below and a suite silently asserts
// about a shorter list than the popover offers. What stays mandatory is the
// attribute itself: `data-v` is what makes a `<label>` a choice row, and a label
// without one must still not match. The lookahead is what keeps `data-value` and
// friends out.
const DATA_V = `data-v(?:=("[^"]*"))?(?=[\\s>]|$)`;
const ROW = new RegExp(`<label([^<>]*\\s${DATA_V}[^<>]*)>([\\s\\S]*?)</label>`, "g");
const VALUE = new RegExp(`(^|\\s)${DATA_V}`);

/**
 * @param {string} block
 * @returns {{ attrs: string, body: string }[]}
 */
const rowsOf = (block) => [...block.matchAll(ROW)].map((m) => ({ attrs: m[1], body: m[3] }));

/**
 * One row's wire value. A valueless `data-v` is how the empty string reaches the
 * markup, so it reads back as the empty string rather than as no row at all.
 *
 * @param {string} attrs
 * @returns {string}
 */
const valueOf = (attrs) => {
  const quoted = (VALUE.exec(attrs) || [])[2];
  return quoted ? quoted.slice(1, -1) : "";
};

/**
 * @param {string} body
 * @returns {string}
 */
const inputOf = (body) => (/<input[^<>]*>/.exec(body) || [""])[0];

/**
 * The choice rows of one facet's popover: an input's type and the wire value of
 * the row it sits in. A shut popover renders none.
 *
 * @param {string} block
 * @returns {{ type: string, value: string }[]}
 */
export const popoverRows = (block) =>
  rowsOf(block)
    .map((r) => ({ type: (/\btype="([^"]*)"/.exec(inputOf(r.body)) || [])[1] || "", value: valueOf(r.attrs) }))
    .filter((r) => r.type !== "");

/**
 * The named facet's own block, with its popover open.
 *
 * @param {string} name
 * @returns {string}
 */
export function openFacet(name) {
  clickFacet(name);
  const block = () => facet(renderBar().out, name);
  if (popoverRows(block()).length === 0) clickFacet(name);
  return block();
}

/**
 * One row of an open popover, found by the wire value it offers.
 *
 * @param {string} block
 * @param {string} value
 * @returns {{ attrs: string, body: string }}
 */
function rowByValue(block, value) {
  const hit = rowsOf(block).find((r) => valueOf(r.attrs) === value);
  if (!hit) throw new Error(`no row offering "${value}" in this popover`);
  return hit;
}

/**
 * The count chip on one row. Its text is the active chain's pair of counts,
 * "<1x>/<Nx>", so a caller reads the half it means rather than the whole string.
 *
 * @param {string} block
 * @param {string} label
 * @returns {string}
 */
export function countChip(block, label) {
  const m = /<span class="opt-count[^"]*">([^<]*)<\/span>/.exec(rowByValue(block, label).body);
  if (!m) throw new Error(`no count chip on the ${label} row`);
  return m[1];
}

/**
 * The Nx half of a count chip's "<1x>/<Nx>" text.
 *
 * @param {string} text
 * @returns {number}
 */
export const nxOf = (text) => Number(text.split("/")[1]);

/**
 * The visible caption of every button inside one facet's block, tags stripped
 * and whitespace squeezed: the facet's own toggle, plus whatever controls the
 * open popover offers as buttons.
 *
 * @param {string} block
 * @returns {string[]}
 */
export const buttonCaptions = (block) =>
  block
    .split("<button")
    .slice(1)
    .map((part) => {
      const inner = part.slice(part.indexOf(">") + 1);
      const end = inner.indexOf("</button>");
      const caption = end < 0 ? inner : inner.slice(0, end);
      return caption
        .split(">")
        .map((piece) => piece.split("<")[0])
        .join("")
        .trim();
    });

/**
 * The wire values of the rows whose input renders checked.
 *
 * @param {string} block
 * @returns {string[]}
 */
export const checkedRows = (block) =>
  rowsOf(block)
    .filter((r) => /(^|\s)checked(\s|=|\/|>)/.test(inputOf(r.body)))
    .map((r) => valueOf(r.attrs));

/**
 * Whether the checkbox of one row renders unavailable.
 *
 * @param {string} block
 * @param {string} label
 * @returns {boolean}
 */
export function rowIsDisabled(block, label) {
  const input = inputOf(rowByValue(block, label).body);
  if (!input) throw new Error(`the "${label}" row carries no input`);
  return /(^|\s)disabled(\s|=|\/|>)/.test(input);
}

/**
 * Whether one row's `<label>` element carries the inert marker.
 *
 * @param {string} block
 * @param {string} label
 * @returns {boolean}
 */
export function rowIsMarkedOff(block, label) {
  const names = (/class="([^"]*)"/.exec(rowByValue(block, label).attrs) || ["", ""])[1].split(/\s+/);
  return names.includes("off");
}
