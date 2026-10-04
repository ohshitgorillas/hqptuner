// Narrowing, built into the filter list sheet: the facet bar along the sheet's head, one button per
// facet reading its state, each opening its own popover with its controls and its hint (v1's model: the hint copy sits with
// the controls it explains). Narrowing shows only here: the page carries no tags. State and matching live in lib/narrow.js;
// every count is live. The popovers' controls: narrow-filters/controls.js.

import { h } from "../../lib/shell/dom.js";
import { popover } from "../../lib/shell/popover.js";
import { toPlate, PLATE_W } from "../../lib/shell/plate.js";
import { select } from "../controls/seg.js";
import { BAR, MOD_BAR, DITHER_BAR } from "../../data/lists/narrow-facets.js";
import {
  chipPressed,
  deadChip,
  facetShown,
  narrowing,
  stateKeys,
  summary,
} from "../../../../hqptuner/static/model/shell/narrow-view.js";
import { defaults, state, change, reset, subscribe } from "../../lib/narrowing/narrow.js";
import { facetBody, hint, itemsOf, mark, modeSeg, optionsOf, rowsOf } from "./narrow-filters/controls.js";

/** @typedef {import('../../lib/narrowing/narrow.js').NarrowState} State */
/** @typedef {import('./narrow-filters/controls.js').BarFacet} BarFacet */
/** @typedef {import('./narrow-filters/controls.js').ListKind} ListKind */
/** @typedef {string | (string | Node)[]} Face  what a facet button reads: text, or text and apodizing marks */

/**
 * One mounted facet bar, shared by the helpers here and in narrow-filters/controls.js.
 *
 * @typedef {object} Bar
 * @property {{ el: HTMLElement, fn: () => string }[]} counts  live preview counts, refreshed on every change
 * @property {{ f: BarFacet, b: HTMLElement, v: HTMLElement, kind: ListKind }[]} btns  each facet's button and readout
 * @property {string} stage     the open list's stage
 * @property {ListKind} kind    the open list's kind
 * @property {HTMLElement} resetBtn
 * @property {HTMLElement[]} sets  one console per list kind
 * @property {HTMLElement} el
 */

/**
 * The facet's state, short, in the list's own vocabulary: '' when it isn't narrowing. stage = the list's stage.
 * Bounded (long states broke the bar): one pick reads its label; several read `N · AND` / `N · OR` (the
 * facet's combine mode; Phase and Length always union); rate rules read their v1 tag, several `N rules`.
 *
 * @param {BarFacet} f
 * @param {State} st
 * @param {string} stage
 * @returns {Face}
 */
function stateText(f, st, stage) {
  const s = summary(f, st, stage);
  if (!s) return "";
  if ("apod" in s) return s.apod === "only" ? [mark("full"), " only"] : [mark("full"), " + ", mark("half")];
  if ("labels" in s) return s.labels.join(" · ");
  if ("picks" in s) return `${s.picks} · ${s.mode.toUpperCase()}`;
  if ("rules" in s) return `${s.rules} rules`;
  return "On";
}
/**
 * Every state a facet can show, for sizing its button once to the longest (the bar never changes width).
 *
 * @param {BarFacet} f
 * @returns {Face[]}
 */
function allStates(f) {
  if (f.apod) return [[mark("full"), " only"], [mark("full"), " + ", mark("half")], "All"];
  if (f.kind === "seg") return rowsOf(f)[0].options.map((o) => o.label);
  if (f.kind === "chips")
    return [...optionsOf(f).map((o) => o.label), `${optionsOf(f).length} · AND`, `${optionsOf(f).length} · OR`, "Any"];
  if (f.kind === "checks") return [...itemsOf(f).map((i) => i.tag), `${itemsOf(f).length} rules`, "Off"];
  return ["On", "Off"];
}
// What an idle facet reads (its default, never blank: the bar is a row of readouts).
/** @type {Record<string, string>} */
const IDLE = { chips: "Any", toggle: "Off", checks: "Off" };
/** @param {BarFacet} f */
const idleText = (f) => (f.kind === "seg" ? rowsOf(f)[0].options[0].label : IDLE[f.kind]);

// One console per list kind: filters | modulators (rate floor + favorites) | dithers (rate marker).
// Favorites is one switch shared by filters and modulators (v1), so it has a button in both.
/** @type {BarFacet[]} */
const FILTER_FACETS = BAR.flat();
const FAV = /** @type {BarFacet} */ (FILTER_FACETS.find((f) => f.key === "fav"));
/** @type {Record<ListKind, BarFacet[]>} */
const SETS = { filters: FILTER_FACETS, modulators: [...MOD_BAR.flat(), FAV], dithers: DITHER_BAR.flat() };

/**
 * Drop under the button, left edges flush, clamped inside the plate.
 *
 * @param {HTMLElement} panel
 * @param {HTMLElement} b
 */
function place(panel, b) {
  const r = toPlate(b.getBoundingClientRect());
  panel.style.left = `${Math.round(Math.min(Math.max(22, r.x), PLATE_W - 22 - panel.offsetWidth))}px`;
  panel.style.top = `${Math.round(r.y + b.offsetHeight + 6)}px`;
}

/**
 * One facet's button in the console for list kind `k`, with its popover appended to the plate.
 *
 * @param {Bar} bar
 * @param {HTMLElement} plate
 * @param {BarFacet} f
 * @param {ListKind} k
 */
function facetButton(bar, plate, f, k) {
  const v = h("span.fv2");
  // Favorites: a plain On / Off switch, no popover (its hint rides as the tooltip).
  if (f.key === "fav") {
    const b = h(
      "button.fbtn",
      {
        type: "button",
        aria: { pressed: false },
        title: /** @type {string[]} */ (f.hint).join(" "),
        on: { click: () => change(String(f.key), !state()[String(f.key)]) },
      },
      h("span.fl", { text: f.label }),
      v,
    );
    bar.btns.push({ f, b, v, kind: k });
    return b;
  }
  const b = h("button.fbtn", { type: "button", aria: { haspopup: "dialog" } }, h("span.fl", { text: f.label }), v);
  const panel = h(
    "div.pop.fpop2",
    { role: "dialog", "aria-label": f.label },
    h("div.fph", {}, h("span.t", { text: f.label }), modeSeg(f)),
    facetBody(bar, f, k),
    hint(f),
  );
  plate.append(panel);
  popover({ trigger: b, panel, onToggle: (open) => open && place(panel, b) });
  bar.btns.push({ f, b, v, kind: k });
  return b;
}

/**
 * Size each visible button once to its longest possible state (call with the bar laid out, real fonts loaded).
 *
 * @param {Bar} bar
 */
function fit(bar) {
  if (!bar.el.offsetParent) return;
  for (const { f, b, v } of bar.btns) {
    if (b.dataset.sized || !b.offsetParent) continue;
    b.dataset.sized = "1";
    const keep = [...v.childNodes];
    let w = 0;
    for (const sx of allStates(f)) {
      v.replaceChildren(...[sx].flat());
      w = Math.max(w, b.offsetWidth);
    }
    v.replaceChildren(...keep);
    b.style.width = `${Math.ceil(w)}px`;
  }
}

/**
 * The popovers' controls read the state: chips pressed, segments and checks picked, dead chips disabled.
 *
 * @param {State} st
 */
function paintControls(st) {
  /** @type {NodeListOf<HTMLElement>} */
  const chipSets = document.querySelectorAll(".fpop2 .nchips[data-facet]");
  for (const g of chipSets) {
    const k = /** @type {string} */ (g.dataset.facet);
    /** @type {NodeListOf<HTMLElement>} */
    const chips = g.querySelectorAll(".nchip");
    for (const c of chips) c.setAttribute("aria-pressed", String(chipPressed(st, k, c.dataset.v)));
  }
  /** @type {NodeListOf<HTMLElement>} */
  const facetSegs = document.querySelectorAll(".fpop2 .seg[data-facet]");
  for (const g of facetSegs) select(g, /** @type {string | number} */ (st[/** @type {string} */ (g.dataset.facet)]));
  /** @type {NodeListOf<HTMLElement>} */
  const modeSegs = document.querySelectorAll(".fpop2 .seg[data-mode]");
  for (const g of modeSegs) select(g, /** @type {string} */ (st[g.dataset.mode + "Mode"]));
  /** @type {NodeListOf<HTMLInputElement>} */
  const checks = document.querySelectorAll(".fpop2 input[data-facet]");
  for (const i of checks) i.checked = !!st[/** @type {string} */ (i.dataset.facet)];
  // A chip whose pick would empty both lists is dead (v1 labels.js tagRowOff, its 0/0 case), unless it is picked.
  /** @type {NodeListOf<HTMLButtonElement>} */
  const all = document.querySelectorAll(".fpop2 .nchip");
  for (const c of all) {
    const n = /** @type {Element} */ (c.querySelector(".c"));
    c.disabled = deadChip(c.getAttribute("aria-pressed") === "true", n.textContent);
    c.title = c.disabled ? "No filters with this property match the current selections." : "";
  }
}

/**
 * @param {Bar} bar
 * @param {State} st
 */
function render(bar, st) {
  for (const { f, b, v } of bar.btns) {
    const s = stateText(f, st, bar.stage);
    v.replaceChildren(...[s || idleText(f)].flat());
    b.classList.toggle("on", !!(Array.isArray(s) ? s.length : s));
    if (f.key === "fav") b.setAttribute("aria-pressed", String(!!st.fav));
    b.hidden = !facetShown(f, bar.stage);
  }
  const live = narrowing(stateKeys(SETS[bar.kind]), st, defaults());
  bar.resetBtn.classList.toggle("idle", !live); // its slot stays: nothing in the bar ever moves
  for (const c of bar.counts) c.el.textContent = c.fn();
  paintControls(st);
}

/**
 * Show the console for a list kind ('filters' | 'modulators' | 'dithers') at a stage.
 *
 * @param {Bar} bar
 * @param {ListKind} k
 * @param {string} s
 */
function show(bar, k, s) {
  bar.kind = k;
  bar.stage = s;
  for (const c of bar.sets) c.hidden = c.dataset.kind !== k;
  render(bar, state());
}

/**
 * The facet bar: one button per facet in clusters (data BAR), each reading its state; tapping one opens its popover, the
 * facet's controls with its hint under them, verbatim. Favorites is the exception: the button itself switches it. Every count is live. Returns {el, setStage(stage)}.
 * @param {HTMLElement} plate
 */
export function mountFacetBar(plate) {
  /** @type {Bar} */
  const bar = {
    counts: [],
    btns: [],
    stage: "1x",
    kind: "filters",
    resetBtn: h("button.fbreset", {
      type: "button",
      text: "Reset",
      on: { click: () => reset(stateKeys(SETS[bar.kind])) },
    }),
    sets: [],
    el: h("div.fbar", { role: "group", "aria-label": "Narrow" }),
  };
  bar.sets = Object.entries(SETS).map(([k, fs]) =>
    h(
      "div.fbc",
      { data: { kind: k } },
      fs.map((f) => facetButton(bar, plate, f, /** @type {ListKind} */ (k))),
    ),
  );
  bar.el.append(...bar.sets, bar.resetBtn);
  subscribe((st) => render(bar, st));
  render(bar, state());
  return {
    el: bar.el,
    fit: () => fit(bar),
    /**
     * @param {ListKind} k
     * @param {string} s
     */
    show: (k, s) => show(bar, k, s),
  };
}
