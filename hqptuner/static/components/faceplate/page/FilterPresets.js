// The Filter presets popover on the Resampling header, and the button that opens it. One row per preset: the pick
// (lamp, emoji, name, description), the filters it writes, its emphasis choice, its error-correction mark (or, on a
// nested row that offers it, the error-correction on / off choice in the mark's place) and its pips. The lit
// row is the preset running now. Each flagship carries a fold line naming the subsets; opening it shows them as nested
// rows in that flagship's version, and ▾ on the first folds them again. The rows are store/faceplate/page/presets.js's.
// Parked to the left of its button.

import { useCallback } from "preact/hooks";
import { classNames, html } from "../../../lib/dom.js";
import { foldSubsets, pickPreset, presetRows, showSubsets } from "../../../store/faceplate/page/presets.js";
import { AMark } from "../NameFace.js";
import { Popover, parkAt, triggerProps } from "../Popover.js";

/** @typedef {import("../../../store/faceplate/page/presets.js").PresetRow} PresetRow */
/** @typedef {import("../../../store/faceplate/page/presets.js").KnobView} KnobView */

/** The popover's id, as its button names it. */
export const FILTER_PRESETS = "presets";

// What the popover calls a row's error-correction mark, its accessible name and its title.
//
// Constants rather than copy read through `easyProse`. Prose arrives with the
// metadata and is empty until it does, which for a caption means a line that
// appears a moment late, but for an `aria-label` means an image with no name at
// all on first paint.
/** @type {Record<string, string>} */
const MARK_LABEL = {
  full: "Full error correction",
  half: "Partial error correction",
  none: "No error correction",
};

// The hi-res badge's two strings. Constants rather than copy read through
// `easyProse`, for the reason MARK_LABEL gives: prose arrives with the
// metadata and is empty until it does, and a badge sourced from it
// would paint an empty pill on first render and fill in a moment later.
//
// One string serves as both the hover tip and the badge's accessible name. The
// badge reads "Hi-Res", which names the thing without saying anything about it,
// so the sentence is what a screen reader should hear.
const HIRES_LABEL = "Hi-Res";
const HIRES_TIP =
  "Uses a special hi-res-optimized filter at rates above 48 kHz; these filters can also be used for Lossy content";

const LABEL = "Filter presets";
// The heads of the two columns that hold a knob. Each also names its knob's radiogroup, after the row's title: a
// constant, so the name is there on first paint, before the knob prose arrives with the metadata.
const EMPHASIS_HEAD = "Emphasis";
const CORRECTION_HEAD = "Correction";
// Each column's name, carried as `data-col` on its head and on every row's cell in it, and the head's text.
/** @type {[string, string][]} */
const COLUMNS = [
  ["preset", "Preset"],
  ["filter", "Filter"],
  ["emphasis", EMPHASIS_HEAD],
  ["correction", CORRECTION_HEAD],
  ["resources", "Resources"],
];

// Left of the button, its top level with the button's, kept 22 px off the plate's left edge and 14 px off its foot.
/** @type {{ side: import("../../../model/shell/place.js").Side, foot: number, at: import("../../../model/shell/place.js").Place }} */
const HOW = { side: [22, null], foot: 14, at: { x: "before", y: "top", gap: 12 } };

/** @param {HTMLElement} panel */
function parkLeft(panel) {
  const at = parkAt(panel, HOW);
  if (!at) return;
  panel.style.left = `${Math.round(at.left)}px`;
  panel.style.top = `${Math.round(at.top)}px`;
}

/** @param {PresetRow} row */
function cost(row) {
  if (row.costWord) return html`<span class="pips" data-col="resources"><span class="w">${row.costWord}</span></span>`;
  return html`<span class="pips" data-col="resources" role="img" aria-label=${`${row.pips} ${row.pips === 1 ? "pip" : "pips"}`}>
    ${Array.from({ length: row.pips }, (_, i) => html`<span class="pip" key=${String(i)}></span>`)}
  </span>`;
}

/**
 * One knob: its positions, the one it stands at lit; another writes the preset there. Its column's head names it.
 *
 * @param {PresetRow} row
 * @param {KnobView} k
 * @param {string} head  the head of the column it stands in
 */
function knob(row, k, head) {
  return html`<span class="kseg" data-knob=${k.id} title=${k.tip || undefined}>
    <span class="seg" role="radiogroup" aria-label=${`${row.title} ${head}`}>
      ${k.options.map(
        (o) =>
          html`<button
            type="button"
            class=${o.value === k.value ? "on" : undefined}
            data-v=${o.value}
            title=${o.tip || undefined}
            onClick=${() => (o.value === k.value ? undefined : pickPreset(row.id, { ...row.at, [k.id]: o.value }))}
          >
            ${o.label}
          </button>`,
      )}
    </span>
  </span>`;
}

/**
 * The pick: lamp, emoji, name (with the hi-res badge) and description.
 *
 * @param {PresetRow} row
 */
const pick = (row) =>
  html`<button type="button" class="pick" data-col="preset" onClick=${() => pickPreset(row.id, row.at)}>
    <span class=${row.current ? "lamp on" : "lamp"}></span>
    <span class="em" aria-hidden="true">${row.emoji}</span>
    <span class="pn">${row.title}${row.hires && html`<span class="hires" title=${HIRES_TIP}>${HIRES_LABEL}</span>`}</span>
    <span class="ds">${row.description}</span>
  </button>`;

/**
 * The Correction column's cell: the error-correction on / off choice where the row offers it, else the row's mark.
 *
 * @param {PresetRow} row
 */
function correction(row) {
  if (row.correction)
    return html`<span class="kn" data-col="correction">${knob(row, row.correction, CORRECTION_HEAD)}</span>`;
  return html`<span class="ap" data-col="correction"><${AMark} kind=${row.mark} label=${MARK_LABEL[row.mark]} /></span>`;
}

/**
 * One row; a nested one carries its flagship as `data-lane`, and the first of a pair the button that folds them.
 *
 * @param {PresetRow} row
 * @param {boolean} [first]
 * @param {string} [names]  the nested pair's names, for the fold button's label
 */
const presetRow = (row, first = false, names = "") =>
  html`<div
    class=${classNames("frow", row.under && "sub", row.current && "cur", first && "first", row.open && "opened")}
    data-preset=${row.id}
    data-lane=${row.under || undefined}
  >
    ${pick(row)}
    <span class="fl" data-col="filter">
      ${row.filters.map((f) => html`<span>${f.stage && html`<span class="k">${f.stage}</span>`}${f.name}</span>`)}
    </span>
    <span class="kn" data-col="emphasis">
      ${row.knobs.filter((k) => k !== row.correction).map((k) => knob(row, k, EMPHASIS_HEAD))}
    </span>
    ${correction(row)}
    ${cost(row)}
    ${first && html`<button type="button" class="fsubx" aria-label=${`Hide ${names}`} onClick=${foldSubsets}></button>`}
  </div>`;

/**
 * A folded flagship's line: ▸ and its subsets' names, the lit one amber. A press opens it, folding any other.
 *
 * @param {PresetRow} row
 * @param {string} names
 */
const foldLine = (row, names) =>
  html`<button
    type="button"
    class="fsubs"
    data-lane=${row.id}
    aria-expanded="false"
    aria-label=${`Show ${names} for ${row.title}`}
    onClick=${() => showSubsets(row.id)}
  >
    ${row.subs.map(
      (s) =>
        html`<span class=${s.current ? "cur" : undefined} data-preset=${s.id}>
          <span class="em" aria-hidden="true">${s.emoji}</span>${s.title}
        </span>`,
    )}
  </button>`;

/** @param {PresetRow} row */
function withSubs(row) {
  if (!row.subs.length) return [presetRow(row)];
  const names = row.subs.map((s) => s.title).join(" and ");
  if (!row.open) return [presetRow(row), foldLine(row, names)];
  return [presetRow(row), ...row.subs.map((s, i) => presetRow(s, i === 0, names))];
}

/** The Filter presets popover. */
export function FilterPresets() {
  const rows = presetRows();
  const open = rows.find((r) => r.open)?.id || "";
  // Re-parks when a flagship opens or folds: the panel's height changed under it.
  const park = useCallback((/** @type {HTMLElement} */ panel) => parkLeft(panel), [open]);
  return html`
    <${Popover} id=${FILTER_PRESETS} cls="fpop" role="dialog" label=${LABEL} park=${park}>
      <div class="fhead">
        ${COLUMNS.map(
          ([col, head]) => html`<span class=${col === "resources" ? "r" : undefined} data-col=${col}>${head}</span>`,
        )}
      </div>
      <div class="frows">${rows.flatMap(withSubs)}</div>
    <//>
  `;
}

/** The Resampling header's button that opens the popover. */
export function FilterPresetsButton() {
  return html`<button type="button" class="btn" ...${triggerProps(FILTER_PRESETS, "dialog")}>${LABEL}</button>`;
}
