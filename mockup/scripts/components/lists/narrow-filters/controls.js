// Narrowing, a facet popover's controls: the AND / OR mode, the chips, the segmented rows and the checkboxes, each with
// its live count, and the hint under them. The facet bar (narrow-filters.js) builds its popovers from these.

import { h } from "../../../lib/shell/dom.js";
import { seg } from "../../controls/seg.js";
import { apodMark } from "../../../lib/controls/apod.js";
import { state, change, preview, count, chainList } from "../../../lib/narrowing/narrow.js";

/** @typedef {import('../../../model/shell/narrow-view.js').Facet} Facet */
/** @typedef {import('../../../lib/narrowing/narrow.js').FacetValue} FacetValue */
/** @typedef {import('../narrow-filters.js').Bar} Bar */
/** @typedef {import('../../../model/shell/narrow-view.js').Option & { v: string, tag?: string }} ChipOption */
/** @typedef {import('../../../model/shell/narrow-view.js').Option & { v: string | number, tag?: string }} SegOption */
/**
 * One segmented row: its state key and options, the stage it narrows, whether that stage shows, its aria label.
 *
 * @typedef {Omit<import('../../../model/shell/narrow-view.js').Row, 'options'>
 *   & { options: SegOption[], aria: string, stage?: string, showStage?: boolean }} BarRow
 */
/** @typedef {import('../../../model/shell/narrow-view.js').Item & { label: string }} BarItem */
/**
 * A facet as data/narrow-facets.js writes it for the bar: the model's Facet with its label, its hint paragraphs, a
 * toggle's chip, and the rows', options' and items' own words.
 *
 * @typedef {Omit<Facet, 'rows' | 'options' | 'items'> & { label: string, prefix?: boolean, hint?: (string | string[])[],
 *   chip?: { label: string }, rows?: BarRow[], options?: ChipOption[], items?: BarItem[] }} BarFacet
 */
/** @typedef {'filters' | 'modulators' | 'dithers'} ListKind */

/**
 * The apodizing mark of a kind that has one.
 *
 * @param {'full' | 'half'} kind
 */
export const mark = (kind) => /** @type {HTMLSpanElement} */ (apodMark(kind));
/**
 * A seg facet's rows.
 *
 * @param {BarFacet} f
 */
export const rowsOf = (f) => /** @type {BarRow[]} */ (f.rows);
/**
 * A chips facet's options.
 *
 * @param {BarFacet} f
 */
export const optionsOf = (f) => /** @type {ChipOption[]} */ (f.options);
/**
 * A checks facet's items.
 *
 * @param {BarFacet} f
 */
export const itemsOf = (f) => /** @type {BarItem[]} */ (f.items);

/**
 * Hint paragraphs: strings or [bold lead-in, rest]; `prefix` opens the first with "HQPTuner Hints:".
 *
 * @param {BarFacet} f
 */
export const hint = (f) =>
  f.hint &&
  h(
    "div.nhint",
    {},
    f.hint.map((p, i) =>
      h(
        "p",
        {},
        i === 0 && f.prefix && [h("strong", { text: "HQPTuner Hints:" }), " "],
        Array.isArray(p) ? [h("strong", { text: p[0] }), p[1]] : p,
      ),
    ),
  );

/**
 * A chip / segment's count: the 1x·Nx filter lists for filter facets, the list itself for shaper facets.
 *
 * @param {ListKind} k
 * @param {Record<string, FacetValue>} over
 */
const countFor = (k, over) => (k === "filters" ? preview(over) : String(count(k, "1x", { ...state(), ...over })));

/**
 * A live preview count, refreshed on every change.
 *
 * @param {Bar} bar
 * @param {string} cls
 * @param {() => string} fn
 */
const cnt = (bar, cls, fn) => {
  const el = h(`span.${cls}`);
  bar.counts.push({ el, fn });
  return el;
};

/**
 * A chips facet's picks with `v` switched.
 *
 * @param {string} k
 * @param {string} v
 */
const toggled = (k, v) => {
  const sel = /** @type {string[]} */ (state()[k]);
  return sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v];
};

/**
 * A combining facet's AND / OR segment, its own default mode leftmost; null for a facet that doesn't combine.
 *
 * @param {BarFacet} f
 */
export function modeSeg(f) {
  if (!f.combine) return null;
  const st = state();
  return h(
    "span.mode",
    {},
    seg({
      tag: "span",
      cls: "mini",
      aria: `Combine ${f.label}`,
      attrs: { "data-mode": String(f.key) },
      // Default leftmost: each facet's own default mode first (genre OR, focus AND).
      options:
        st[f.key + "Mode"] === "or"
          ? [
              { v: "or", label: "OR" },
              { v: "and", label: "AND" },
            ]
          : [
              { v: "and", label: "AND" },
              { v: "or", label: "OR" },
            ],
      value: /** @type {string} */ (st[f.key + "Mode"]),
      onChange: (v) => change(f.key + "Mode", v),
    }),
  );
}

/**
 * @param {Bar} bar
 * @param {{ v: string, label: string }} o
 * @param {() => void} onClick
 * @param {() => string} n
 */
function chip(bar, o, onClick, n) {
  return h(
    "button.nchip",
    { type: "button", data: { v: o.v }, aria: { pressed: false }, on: { click: onClick } },
    o.label,
    cnt(bar, "c", n),
  );
}

/**
 * An Apodizing segment's marks: the full mark for Only, full + half for +½, none for All (it keeps its label).
 *
 * @param {string | number} v
 */
const apodFace = (v) =>
  v === "only"
    ? h("span.amk", {}, mark("full"))
    : v === "half"
      ? h("span.amk", {}, mark("full"), "+", mark("half"))
      : null;

/**
 * One segmented row of a seg facet, each segment carrying the count its pick lands on.
 *
 * @param {Bar} bar
 * @param {BarFacet} f
 * @param {BarRow} r
 */
function segRow(bar, f, r) {
  const s = seg({
    tag: "span",
    aria: r.aria,
    attrs: { "data-facet": r.key },
    options: r.options,
    value: /** @type {string | number} */ (state()[r.key]),
    onChange: (v) => change(r.key, typeof r.options[0].v === "number" ? Number(v) : v),
  });
  s.querySelectorAll("button").forEach((b, i) => {
    // Apodizing's segments speak the rows' own marks (v1's circled A / ½) in place of their labels.
    const face = f.apod && apodFace(r.options[i].v);
    if (face) b.replaceChildren(face);
    // Each segment carries the count its pick lands on: that stage's list for a staged row, 1x·Nx otherwise.
    const over = { [r.key]: r.options[i].v };
    b.append(
      cnt(bar, "c", () => (r.stage ? String(count(chainList(), r.stage, { ...state(), ...over })) : preview(over))),
    );
  });
  return h(
    "div.nrow",
    {},
    r.stage && r.showStage !== false && h("span.stg", { text: r.stage === "nx" ? "Nx" : "1x" }),
    s,
  );
}

/**
 * The controls in a facet's popover: its chips, its one chip, its segmented rows or its checkboxes.
 *
 * @param {Bar} bar
 * @param {BarFacet} f
 * @param {ListKind} k
 */
export function facetBody(bar, f, k) {
  const key = String(f.key);
  switch (f.kind) {
    case "chips":
      return h(
        "div.nchips",
        { data: { facet: f.key } },
        optionsOf(f).map((o) =>
          chip(
            bar,
            o,
            () => change(key, toggled(key, o.v)),
            () => countFor(k, { [key]: toggled(key, o.v) }),
          ),
        ),
      );
    case "toggle":
      return h(
        "div.nchips",
        { data: { facet: f.key } },
        chip(
          bar,
          { v: "on", .../** @type {{ label: string }} */ (f.chip) },
          () => change(key, !state()[key]),
          () => countFor(k, { [key]: !state()[key] }),
        ),
      );
    case "seg":
      return rowsOf(f).map((r) => segRow(bar, f, r));
    case "checks":
      return itemsOf(f).map((i) =>
        h(
          "div.nrow",
          {},
          h(
            "label.chk",
            {},
            h("input", {
              type: "checkbox",
              data: { facet: i.key },
              on: { change: (e) => change(i.key, /** @type {HTMLInputElement} */ (e.target).checked) },
            }),
            h("span", { text: i.label }),
            cnt(bar, "c", () => preview({ [i.key]: !state()[i.key] })),
          ),
        ),
      );
    default:
      return null;
  }
}
