// Option lists, free of the DOM: what the hover tip says and where it lands beside its row, where a panel parks at its
// picker, how the narrowed list groups into families and variants, which placement columns survive narrowing, and how the
// Standard style fills its columns in engine order. components/option-list.js measures, builds and calls these.

/**
 * An option's narrowing facets (filters).
 *
 * @typedef {object} Facets
 * @property {number | null} [q]
 * @property {string[]} genre
 * @property {string[]} focus
 * @property {string} phase
 * @property {string} len
 * @property {boolean} adaptive
 * @property {string} apod
 * @property {boolean} up
 * @property {string | null} [ratio]
 * @property {string | null} [ratioPcm]
 * @property {string | null} [ratioSdm]
 */

/**
 * One option as the data lists it.
 *
 * @typedef {object} Opt
 * @property {string} v
 * @property {string} fam
 * @property {string | null} var
 * @property {string} leaf
 * @property {string} d
 * @property {string} [d2]
 * @property {Facets} [f]
 * @property {number} [gen]
 * @property {string} [tier]
 */

/** Facet labels by facet key, then by option value: the narrowing bar's own words. @typedef {Record<string, Record<string, string>>} Labels */

/** A size in layout px. @typedef {{w: number, h: number}} Size */

/**
 * One column of the custom placement: `split` gives its one family two columns of named variants; `title` heads a column
 * of several families; `then` adds a titled block under the column's families.
 *
 * @typedef {object} Placement
 * @property {string[]} fams
 * @property {string} [title]
 * @property {string[][]} [split]
 * @property {{title: string, fams: string[]}} [then]
 */

/**
 * A placement column after narrowing. A split names its family and the variants present in each half, and is a band
 * (two columns under one header) while both halves have rows. A stack lists the families present, and its `then` block
 * when any of that block's families is.
 *
 * @typedef {{kind: 'split', fam: string, halves: string[][], band: boolean}
 *   | {kind: 'stack', title: string | undefined, fams: string[], then: {title: string, fams: string[]} | null}} Column
 */

/** @type {Record<string, string>} */
const RATIO = { integer: "Integer", "2x": "2x", "1:1": "1:1", any: "Any" }; // v1 facet-data.js RATIOS + "Any" (facettip.js)
const ORD = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"]; // v1 options.js GENERATION_ORDINALS
const MARGIN = 12;

/**
 * The tip's facet rows in the narrowing bar's words, [label, value]; an option without facets has its Generation row.
 *
 * @param {Opt} o
 * @param {Labels} facet
 * @returns {[string, string][]}
 */
export function tipRows(o, facet) {
  const f = o.f;
  /** @type {[string, string][]} */
  const rows = [];
  if (!f) return o.gen && ORD[o.gen] ? [["Generation", ORD[o.gen]]] : [];
  if (f.q != null) rows.push(["Quality", `${f.q}/5`]);
  if (f.genre.length) rows.push(["Genre", f.genre.map((g) => facet.genre[g] ?? g).join(", ")]);
  if (f.focus.length) rows.push(["Focus", f.focus.map((g) => facet.focus[g] ?? g).join(", ")]);
  if (f.phase) rows.push(["Phase", facet.phase[f.phase] ?? f.phase]);
  if (f.len || f.adaptive)
    rows.push([
      "Length",
      f.adaptive ? (f.len ? `${facet.length[f.len]}, adaptive` : facet.length.adaptive) : facet.length[f.len],
    ]);
  const ratio =
    f.ratio != null
      ? (RATIO[f.ratio] ?? f.ratio)
      : [
          f.ratioPcm != null && `PCM ${RATIO[f.ratioPcm] ?? f.ratioPcm}`,
          f.ratioSdm != null && `SDM ${RATIO[f.ratioSdm] ?? f.ratioSdm}`,
        ]
          .filter(Boolean)
          .join(" · ");
  if (ratio) rows.push(["Ratio", ratio]);
  return rows;
}

/**
 * The tip's boolean chips.
 *
 * @param {Opt} o
 * @returns {string[]}
 */
export const tipChips = (o) =>
  o.f
    ? [
        o.f.apod === "half" ? "Half apodizing" : o.f.apod === "full" ? "Apodizing" : "",
        o.f.up ? "Upsample only" : "",
      ].filter(Boolean)
    : [];

/**
 * What the tip says: the raw engine name while Simplified hides it (null in Standard), the manual prose (Standard's own
 * where it differs), the facet rows and the chips.
 *
 * @param {Opt} o
 * @param {boolean} std   option style Standard
 * @param {Labels} facet
 * @returns {{name: string | null, text: string | undefined, rows: [string, string][], chips: string[]}}
 */
export function tipContent(o, std, facet) {
  return { name: std ? null : o.v, text: std ? o.d2 || o.d : o.d, rows: tipRows(o, facet), chips: tipChips(o) };
}

/**
 * The tip's corner on the plate, beside its row's column: right of it when there's room, else left; its top on the row,
 * clamped inside the plate.
 *
 * @param {{col: {x: number, w: number}, rowY: number, tip: Size, plate: Size}} o   the column's plate x and width, the
 *   row's plate y
 * @returns {{left: number, top: number}}
 */
export function tipAt({ col, rowY, tip, plate }) {
  const right = col.x + col.w + 10;
  const x = right + tip.w <= plate.w - MARGIN ? right : Math.max(MARGIN, col.x - tip.w - 10);
  return { left: Math.round(x), top: Math.round(Math.max(MARGIN, Math.min(rowY - 4, plate.h - MARGIN - tip.h))) };
}

/**
 * The panel's corner on the plate, parked at its picker: left edges aligned, below it when it fits, else above, else as
 * low as the plate allows; centered when no picker shows. Clamped inside the plate.
 *
 * @param {{panel: Size, trigger: {x: number, y: number, h: number} | null, plate: Size}} o   the picker's plate corner
 *   and height
 * @returns {{left: number, top: number}}
 */
export function parkAt({ panel, trigger, plate }) {
  let x = (plate.w - panel.w) / 2,
    y = (plate.h - panel.h) / 2;
  if (trigger) {
    x = trigger.x;
    const below = trigger.y + trigger.h + 6,
      above = trigger.y - panel.h - 6;
    y = below + panel.h <= plate.h - MARGIN ? below : above >= MARGIN ? above : plate.h - MARGIN - panel.h;
  }
  return {
    left: Math.round(Math.max(MARGIN, Math.min(x, plate.w - MARGIN - panel.w))),
    top: Math.round(Math.max(MARGIN, y)),
  };
}

/**
 * The list as families → groups (variant, or '' for none) → options, each in first-appearance order.
 *
 * @param {Opt[]} opts
 * @returns {Map<string, Map<string, Opt[]>>}
 */
export function groupTree(opts) {
  /** @type {Map<string, Map<string, Opt[]>>} */
  const fams = new Map();
  for (const o of opts) {
    let g = fams.get(o.fam);
    if (!g) fams.set(o.fam, (g = new Map()));
    const v = o.var ?? "";
    let rows = g.get(v);
    if (!rows) g.set(v, (rows = []));
    rows.push(o);
  }
  return fams;
}

/**
 * The placement's columns after narrowing: families the list lacks drop, and a column left with none drops.
 *
 * @param {Placement[]} place
 * @param {Map<string, Map<string, Opt[]>>} fams
 * @returns {Column[]}
 */
export function columns(place, fams) {
  /** @type {Column[]} */
  const out = [];
  for (const c of place) {
    const fs = c.fams.filter((f) => fams.has(f));
    const more = c.then ? c.then.fams.filter((f) => fams.has(f)) : [];
    if (!fs.length && !more.length) continue;
    if (c.split) {
      const fam = fs[0];
      const vs = fams.get(fam) ?? new Map();
      const halves = c.split.map((names) => names.filter((v) => vs.has(v)));
      out.push({ kind: "split", fam, halves, band: halves.every((half) => half.length > 0) });
      continue;
    }
    out.push({
      kind: "stack",
      title: c.title,
      fams: fs,
      then: c.then && more.length > 0 ? { title: c.then.title, fams: more } : null,
    });
  }
  return out;
}

/**
 * Standard: the narrowed list in engine order, down column after column. Each column holds ceil(full list / columns)
 * rows, so the full list fills them evenly and a narrowed one reflows from the top of the first.
 *
 * @param {Opt[]} opts
 * @param {{total: number, cols: number, order: string[]}} o   the full list's length, the column count, the engine order
 * @returns {Opt[][]}
 */
export function flatColumns(opts, { total, cols, order }) {
  const per = Math.ceil(total / cols);
  /** @param {string} v */
  const idx = (v) => {
    const i = order.indexOf(String(v));
    return i < 0 ? Infinity : i;
  };
  const list = [...opts].sort((a, b) => idx(a.v) - idx(b.v));
  const out = [];
  for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per));
  return out;
}
