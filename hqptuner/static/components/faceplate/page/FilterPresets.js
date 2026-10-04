// The Filter presets popover on the Resampling header, and the button that opens it. One row per preset: the pick
// (lamp, emoji, name, description), the filters it writes, its knobs, its error-correction mark and its pips. The lit
// row is the preset running now. Each flagship carries a fold line naming the subsets; opening it shows them as nested
// rows in that flagship's version, and ▾ on the first folds them again. The rows are store/faceplate/page/presets.js's.
// Parked to the left of its button.

import { useCallback } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { classNames } from "../../../model/shell/format.js";
import { foldSubsets, pickPreset, presetRows, showSubsets } from "../../../store/faceplate/page/presets.js";
import { MARK_LABEL } from "../../easy/marks.js";
import { HIRES_LABEL, HIRES_TIP } from "../../easy/Tile.js";
import { Popover, parkAt, triggerProps } from "../Popover.js";

/** @typedef {import("../../../store/faceplate/page/presets.js").PresetRow} PresetRow */
/** @typedef {import("../../../store/faceplate/page/presets.js").KnobView} KnobView */

/** The popover's id, as its button names it. */
export const FILTER_PRESETS = "presets";

const LABEL = "Filter presets";
const COLUMNS = ["Preset", "Filter", "Adjust", "Correction", "Resources"];
// The correction knob's label in the popover, shorter than the tile's: the column heading already says what it adjusts.
const CORRECTION_KNOB = "Correction";

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

/**
 * Error-correction coverage: filled disc full, half disc partial, ring none.
 *
 * @param {PresetRow["mark"]} mark
 */
function glyph(mark) {
  if (!mark) return null;
  const label = MARK_LABEL[mark];
  let shape = html`<circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" />`;
  if (mark === "full") shape = html`<circle cx="7" cy="7" r="6" fill="currentColor" />`;
  if (mark === "half") {
    shape = html`<circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" />
      <path d="M7 1.5 A5.5 5.5 0 0 1 7 12.5 Z" fill="currentColor" />`;
  }
  return html`<svg class="apod" data-mark=${mark} viewBox="0 0 14 14" role="img" aria-label=${label}>
    <title>${label}</title>${shape}
  </svg>`;
}

/** @param {PresetRow} row */
function cost(row) {
  if (row.costWord) return html`<span class="pips"><span class="w">${row.costWord}</span></span>`;
  return html`<span class="pips" role="img" aria-label=${`${row.pips} ${row.pips === 1 ? "pip" : "pips"}`}>
    ${Array.from({ length: row.pips }, (_, i) => html`<span class="pip" key=${String(i)}></span>`)}
  </span>`;
}

/**
 * One knob: its label and its positions, the one it stands at lit; another writes the preset there.
 *
 * @param {PresetRow} row
 * @param {KnobView} k
 */
function knob(row, k) {
  const label = k.id === "correction" ? CORRECTION_KNOB : k.label;
  return html`<span class="kseg" data-knob=${k.id} title=${k.tip || undefined}>
    <span class="kl">${label}</span>
    <span class="seg" role="radiogroup" aria-label=${`${row.title} ${label}`}>
      ${k.options.map(
        (o) =>
          html`<button
            type="button"
            class=${o.value === k.value ? "on" : undefined}
            data-v=${o.value}
            title=${o.tip || undefined}
            disabled=${row.grayed}
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
  html`<button type="button" class="pick" disabled=${row.grayed} onClick=${() => pickPreset(row.id, row.at)}>
    <span class=${row.current ? "lamp on" : "lamp"}></span>
    <span class="em" aria-hidden="true">${row.emoji}</span>
    <span class="pn">${row.title}${row.hires && html`<span class="hires" title=${HIRES_TIP}>${HIRES_LABEL}</span>`}</span>
    <span class="ds">${row.description}</span>
  </button>`;

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
    data-grayed=${row.grayed ? "1" : undefined}
  >
    ${pick(row)}
    <span class="fl">
      ${row.filters.map((f) => html`<span>${f.stage && html`<span class="k">${f.stage}</span>`}${f.name}</span>`)}
    </span>
    <span class="kn">${row.knobs.map((k) => knob(row, k))}</span>
    <span class="ap">${glyph(row.mark)}</span>
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
        ${COLUMNS.map((c, i) => html`<span class=${i === COLUMNS.length - 1 ? "r" : undefined}>${c}</span>`)}
      </div>
      <div class="frows">${rows.flatMap(withSubs)}</div>
    <//>
  `;
}

/** The Resampling header's button that opens the popover. */
export function FilterPresetsButton() {
  return html`<button type="button" class="btn" ...${triggerProps(FILTER_PRESETS, "dialog")}>${LABEL}</button>`;
}
