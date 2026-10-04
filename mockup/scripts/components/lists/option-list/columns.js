// Option lists, placement and columns: where each list's families land (PLACE, STD_COLS), where a panel parks, the
// family / variant / row parts and their folds, and the render that fills the columns.

import { h } from "../../../lib/shell/dom.js";
import { LISTS, GROUPS } from "../../../data/lists/option-lists.js";
import { narrowed, kindOf } from "../../../lib/narrowing/narrow.js";
import { optionStyle } from "../vselect.js";
import { toPlate, PLATE_W, PLATE_H } from "../../../lib/shell/plate.js";
import { ENGINE_ORDER } from "../../../data/lists/engine-order.js";
import { dacType } from "../../../lib/narrowing/dactype.js";
import { parkAt, groupTree, columns, flatColumns } from "../../../../../hqptuner/static/model/shell/option-list.js";
import { showTip, hideTip } from "./tip.js";
import { cur, legend, row } from "./rows.js";

/** @typedef {import('../option-list.js').ListUi} ListUi */
/** @typedef {import('../../../../../hqptuner/static/model/shell/option-list.js').Opt} Opt */
/** @typedef {import('../../../../../hqptuner/static/model/shell/option-list.js').Placement} Placement */
/** @typedef {import('../../../../../hqptuner/static/model/shell/option-list.js').Column} Column */
/** @typedef {Extract<Column, { kind: 'split' }>} SplitColumn */
/** @typedef {Extract<Column, { kind: 'stack' }>} StackColumn */
/** @typedef {Map<string, Map<string, Opt[]>>} Families */
/** @typedef {import('../../../lib/narrowing/narrow.js').Kind} Kind */

/**
 * Custom placement per list kind: columns left to right. A column holds families top to bottom; `split` gives its one
 * family two columns of named variants when it is taller than one; `title` heads a column of several families (`Other`);
 * `then` adds a titled block under a column's families. A family a list doesn't have (PCM-only Misc) or that narrowing
 * empties just drops.
 *
 * @type {Record<Kind, Placement[]>}
 */
const PLACE = {
  filters: [
    // Polyphase sinc's two columns, by lineage rather than list order (custom over general): the base,
    // extended and steepest forms | the Gaussian and half-band forms, then the lossy-source pair.
    {
      fams: ["Polyphase sinc"],
      split: [
        ["Base", "Extended frequency response", "Extended frequency response v2", "Extreme roll-off and attenuation"],
        ["Gaussian", "Gaussian half-band", "Half-band", "MQA and MP3"],
      ],
    },
    // Pure sinc (PCM's Misc under it), then Analog-style under its own `Other` title; Conventional and Interpolation
    // under the last column's.
    { fams: ["Pure sinc", "Misc"], then: { title: "Other", fams: ["Analog-style"] } },
    { title: "Other", fams: ["Conventional", "Interpolation"] },
  ],
  // Modulators: Hybrid over Fixed in the first column, then Adaptive over two.
  modulators: [{ fams: ["Hybrid", "Fixed"] }, { fams: ["Adaptive"], split: [["Fifth order"], ["Seventh order"]] }],
  dithers: [{ fams: ["Noise shaping", "Additive", "None"] }], // one column, families stacked (a panel, not a sheet)
};

/**
 * Standard: columns per list kind. Each column holds ceil(full list / columns) rows, so the full list fills them evenly and
 * a narrowed one reflows from the top of the first column (fewer columns, never gaps).
 */
/** List kinds that open as a panel at their picker rather than a sheet over the body. */
export const PANEL = new Set(["modulators", "dithers"]);

/** @type {Record<Kind, number>} */
const STD_COLS = { filters: 3, modulators: 2, dithers: 1 }; // filters: the longest engine name + marks won't fit four across at 10.2″

/** @type {Record<Kind, { families: Record<string, string>, variants: Record<string, string> }>} */
const BLURBS = GROUPS;

/** @type {Set<string>} */
const folded = new Set(); // collapsed groups, keyed per kind (v1: the two chains' filter lists share one fold)
// DAC type (lib/dactype.js) collapses the groups the manual calls the wrong fit; a tap still opens them. `byDac` = the keys
// it folded.
/** @type {Set<string>} */
const byDac = new Set();
/**
 * Fold the groups the DAC type calls the wrong fit, reopening the ones it folded before.
 *
 * @param {{ r2r: string, ess: string }} d
 */
export function dacFolds({ r2r, ess }) {
  for (const k of byDac) folded.delete(k);
  byDac.clear();
  const keys = [
    ...(r2r === "1" ? ["dithers|Additive|*"] : []),
    ...(ess === "1" ? ["Fixed", "Adaptive", "Hybrid"].map((f) => `modulators|${f}|Seventh order`) : []),
  ];
  for (const k of keys) {
    folded.add(k);
    byDac.add(k);
  }
}
dacFolds(dacType());

/**
 * Park the panel at its picker (model/option-list.js parkAt); centered when the picker isn't showing.
 *
 * @param {ListUi} ui
 */
function park(ui) {
  const el = ui.sh.el,
    tr = ui.cur?.trigger;
  const panel = { w: el.offsetWidth, h: el.offsetHeight };
  const shown = tr?.isConnected && tr.offsetParent;
  const trigger = shown ? { ...toPlate(tr.getBoundingClientRect()), h: tr.offsetHeight } : null;
  const at = parkAt({ panel, trigger, plate: { w: PLATE_W, h: PLATE_H } });
  el.style.left = `${at.left}px`;
  el.style.top = `${at.top}px`;
}

// ── Parts ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** @param {ListUi} ui */
const gr = (ui) => BLURBS[kindOf(cur(ui).list)];
/**
 * @param {ListUi} ui
 * @param {string} f
 * @param {string} v
 */
const vkey = (ui, f, v) => `${kindOf(cur(ui).list)}|${f}|${v}`;
/**
 * @param {ListUi} ui
 * @param {string} k
 */
function toggle(ui, k) {
  folded.has(k) ? folded.delete(k) : folded.add(k);
  render(ui);
}

/**
 * Family header: `<Family> family`, engraved, its rule running to the column's (band's) right edge and turning down there,
 * so the header visibly covers every column it heads; its blurb under it (v1). Families don't fold.
 *
 * @param {ListUi} ui
 * @param {string} f
 * @param {boolean} [sub]
 */
function famHead(ui, f, sub) {
  // A family without variants (dithers) folds at its header when DAC type collapses it (or the user taps it).
  const bare = kindOf(cur(ui).list) === "dithers";
  const k = vkey(ui, f, "*");
  const shut = bare && folded.has(k);
  const name = bare
    ? h(
        "button.ohd.ofold",
        { type: "button", aria: { expanded: !shut }, on: { click: () => toggle(ui, k) } },
        `${f} family`,
      )
    : h("span.ohd", { text: `${f} family` });
  return h(
    "div.ofam",
    { class: sub && "sub" },
    h("div.ofh", {}, name, !sub && h("span.ln")),
    !shut && gr(ui).families[f] && h("div.oblurb", { text: gr(ui).families[f] }),
  );
}
/**
 * Variant: subheader + its blurb (v1), then its rows; or bare rows for a family without variants.
 *
 * @param {ListUi} ui
 * @param {string} f
 * @param {string} v
 * @param {Opt[]} rows
 */
function group(ui, f, v, rows) {
  const k = vkey(ui, f, v || "*");
  const shut = folded.has(k);
  const b = v && gr(ui).variants[`${f}|${v}`];
  return h(
    "div.ogrp",
    { class: v ? "var" : "bare" },
    v && h("button.osub", { type: "button", aria: { expanded: !shut }, on: { click: () => toggle(ui, k) } }, v),
    v && !shut && b && h("div.oblurb", { text: b }),
    !shut && rows.map((o) => row(ui, o)),
  );
}

/**
 * A family's groups, by variant ('' for none).
 *
 * @param {Families} fams
 * @param {string} f
 */
const variantsOf = (fams, f) => /** @type {Map<string, Opt[]>} */ (fams.get(f));

/**
 * A family's header, then its groups in list order.
 *
 * @param {ListUi} ui
 * @param {Families} fams
 * @param {string} f
 * @param {boolean} sub
 */
const parts = (ui, fams, f, sub) => [
  famHead(ui, f, sub),
  ...[...variantsOf(fams, f)].map(([v, rows]) => group(ui, f, v, rows)),
];
/**
 * A column title (`Other`) over its families.
 *
 * @param {ListUi} ui
 * @param {Families} fams
 * @param {string} title
 * @param {string[]} fs
 */
const titled = (ui, fams, title, fs) => [
  h("div.ofam.ctitle", {}, h("div.ofh", {}, h("span.ohd.static", { text: title }), h("span.ln"))),
  fs.map((f) => h("div.ostack", {}, parts(ui, fams, f, true))),
];

// ── Layout ────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Fill the open list's columns from its narrowed options, in the current option style.
 *
 * @param {ListUi} ui
 */
export function render(ui) {
  const { cur: open, sh, cols } = ui;
  if (!open || !sh.isOpen) return;
  const keepTip = ui.tipOpt; // the rows are rebuilt (narrowing, favorites, folds, a late font): the tip follows its option
  const opts = narrowed(open.list, open.stage, open.value);
  ui.n.textContent = `${opts.length} of ${LISTS[open.list].length}`;
  sh.el.dataset.style = optionStyle();
  if (optionStyle() === "standard") {
    cols.replaceChildren(...flat(ui, opts));
    placed(ui, keepTip);
    return;
  }
  cols.replaceChildren();
  const fams = groupTree(opts);
  cols.replaceChildren(
    ...columns(PLACE[kindOf(open.list)], fams).map((c) =>
      c.kind === "split" ? splitCol(ui, fams, c) : stackCol(ui, fams, c),
    ),
  );
  placed(ui, keepTip);
}

/**
 * A split family: two columns under one header while both halves have rows, else one; the filter marks' key under it.
 *
 * @param {ListUi} ui
 * @param {Families} fams
 * @param {SplitColumn} c
 */
function splitCol(ui, fams, c) {
  const head = famHead(ui, c.fam);
  const vs = variantsOf(fams, c.fam);
  const [a, b] = c.halves.map((names) => names.map((v) => group(ui, c.fam, v, /** @type {Opt[]} */ (vs.get(v)))));
  const key = kindOf(cur(ui).list) === "filters" && legend(); // the row marks' key, under Polyphase sinc
  return c.band
    ? h("div.oband", {}, head, h("div.osubs", {}, h("div.ocol", {}, a), h("div.ocol", {}, b)), key)
    : h("div.ocol", {}, head, a, b, key);
}

/**
 * A column of stacked families, or of titled ones; its `then` block under them.
 *
 * @param {ListUi} ui
 * @param {Families} fams
 * @param {StackColumn} c
 */
function stackCol(ui, fams, c) {
  return h(
    "div.ocol",
    { class: c.title && "titled" },
    c.title ? titled(ui, fams, c.title, c.fams) : c.fams.map((f) => h("div.ostack", {}, parts(ui, fams, f, false))),
    c.then && h("div.othen", {}, titled(ui, fams, c.then.title, c.then.fams)),
  );
}

/**
 * After a render: a panel re-parks (its size follows the list), then the tip follows its option.
 *
 * @param {ListUi} ui
 * @param {Opt | null} keepTip
 */
function placed(ui, keepTip) {
  if (ui.sh.el.classList.contains("opanel")) park(ui);
  keep(ui, keepTip);
}

/**
 * @param {ListUi} ui
 * @param {Opt | null} keepTip
 */
function keep(ui, keepTip) {
  if (!keepTip) return;
  /** @type {NodeListOf<HTMLElement>} */
  const rows = ui.cols.querySelectorAll(".orow");
  const again = [...rows].find((r) => r.dataset.v === String(keepTip.v));
  again ? showTip(ui, keepTip, again) : hideTip(ui);
}

/**
 * Standard: the narrowed list in engine order, down column after column; the filter marks' key along the foot.
 *
 * @param {ListUi} ui
 * @param {Opt[]} opts
 */
function flat(ui, opts) {
  const { list } = cur(ui);
  const kind = kindOf(list);
  const order = { total: LISTS[list].length, cols: STD_COLS[kind], order: ENGINE_ORDER[list] };
  const out = flatColumns(opts, order).map((rows) =>
    h(
      "div.ocol.flat",
      {},
      rows.map((o) => row(ui, o)),
    ),
  );
  if (kind === "filters") out.push(legend());
  return out;
}
