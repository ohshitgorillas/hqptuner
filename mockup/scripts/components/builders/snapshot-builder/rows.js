import { h } from "../../../lib/shell/dom.js";
import { seg } from "../../controls/seg.js";
import { vselect, optionStyle } from "../../lists/vselect.js";
import { SNAP_ROWS } from "../../../data/builders/snapshots.js";
import { CHAIN_NAMES } from "../../../data/stages/conversion.js";
import { classNames } from "../../../../../hqptuner/static/model/shell/format.js";
import { isChain, snapRow } from "../../../../../hqptuner/static/model/builders/snapshot.js";
import { change } from "./edit.js";

/** @typedef {import('../snapshot-builder.js').Snap} Snap */
/** @typedef {import('../snapshot-builder.js').Live} Live */
/** @typedef {import('../../../../../hqptuner/static/model/builders/snapshot.js').Edit} Edit */
/** @typedef {import('../../../../../hqptuner/static/model/builders/snapshot.js').RowView} RowView */
/** @typedef {import('../../../../../hqptuner/static/model/builders/snapshot.js').Engine} Engine */
/** @typedef {import('../../../data/builders/snapshots.js').SnapRow} SnapRow */
/** @typedef {import('../../../data/stages/conversion.js').Chain} Chain */
/** @typedef {import('../../../data/settings/common.js').Option} Option */

// ── Live values ─────────────────────────────────────────────────────────
/**
 * The live value in the words the snapshot's control uses: the same Option style as the pickers (Visual settings).
 *
 * @param {SnapRow} row
 * @param {Edit} e
 * @param {string} v
 * @returns {string}
 */
const labelOf = (row, e, v) => {
  if (row.kind === "seg")
    return /** @type {Option[]} */ (row.options).find((o) => o.v === v)?.label ?? (v === "auto" ? "Auto" : v);
  if (row.kind === "list" && optionStyle() !== "standard")
    return /** @type {NonNullable<SnapRow['list']>} */ (row.list)(e.vals.mode).find((o) => o.v === v)?.label ?? v;
  return v;
};

/**
 * Fill every included row from the engine (Mode first: the chain rows follow it).
 *
 * @param {Edit} x
 * @param {Live} L
 */
export function takeAll(x, L) {
  if (x.inc.has("mode")) x.vals.mode = L.run;
  for (const row of SNAP_ROWS) {
    if (!x.inc.has(row.id) || row.id === "mode") continue;
    if (isChain(row.id)) x.vals[x.vals.mode][row.id] = L[x.vals.mode][row.id];
    else x.vals[row.id] = /** @type {Engine} */ (L)[row.id];
  }
}

/**
 * The include box: it attaches the row to the snapshot, or leaves it out.
 *
 * @param {Snap} S
 * @param {SnapRow} row
 * @param {RowView} d
 * @param {string} label
 * @returns {HTMLElement}
 */
const incBox = (S, row, d, label) =>
  h("button.binc", {
    type: "button",
    role: "checkbox",
    aria: { checked: d.on, label: `Attach ${label}` },
    disabled: d.gated,
    on: {
      click: () =>
        change(S, (x) => {
          if (x.inc.has(row.id)) x.inc.delete(row.id);
          else x.inc.add(row.id);
        }),
    },
  });

/**
 * The row's control: a segment, a select, or the chain's list picker.
 *
 * @param {SnapRow} row
 * @param {{ value: string, label: string, ch: Chain }} at  the snapshot's value, the row's label, the snapshot's chain
 * @param {(v: string) => void} set
 * @returns {HTMLElement}
 */
function controlOf(row, { value, label, ch }, set) {
  const options = /** @type {Option[]} */ (row.options);
  if (row.kind === "seg") return seg({ aria: label, options, value, onChange: set });
  if (row.kind === "select") return vselect({ aria: label, options, value, onChange: set });
  return vselect({
    id: `bd-${ch}${row.id}`,
    aria: `${CHAIN_NAMES[ch]} ${label}`,
    options: /** @type {NonNullable<SnapRow['list']>} */ (row.list)(ch),
    value,
    onChange: set,
  });
}

/**
 * The engine's value, marked where it differs on an attached row and where it is idle.
 *
 * @param {RowView} d
 * @param {string} liveTxt
 * @returns {HTMLElement}
 */
const liveCell = (d, liveTxt) =>
  // Differences mark only on attached rows (an excluded row is left as is on recall, so it can't differ).
  h(
    "div.vfd.blive",
    { class: d.differs && d.on && "diff", title: d.idle ? `${liveTxt} · idle` : liveTxt },
    h("span.v", {}, h("span.bt", { text: liveTxt }), d.idle && h("span.bidle", { text: "· idle" })),
  );

/**
 * One row of the page: include box | stage + setting | the snapshot's value | ← | the engine's live value.
 *
 * @param {Snap} S
 * @param {SnapRow} row
 * @param {Edit} e
 * @returns {HTMLElement}
 */
export function rowEl(S, row, e) {
  const ch = e.vals.mode;
  const d = snapRow(row, e, S.live());
  const label = typeof row.label === "function" ? row.label(ch) : row.label;

  const box = incBox(S, row, d, label);

  /** @param {string} nv */
  const set = (nv) =>
    change(S, (x) => {
      if (isChain(row.id)) x.vals[x.vals.mode][row.id] = nv;
      else x.vals[row.id] = nv;
    });
  const ctlWrap = h("div.bval", { class: !d.on && "grayed" }, controlOf(row, { value: d.value, label, ch }, set));
  if (!d.on)
    for (const b of /** @type {NodeListOf<HTMLButtonElement | HTMLSelectElement>} */ (
      ctlWrap.querySelectorAll("button,select")
    ))
      b.disabled = true;

  const take = h("button.round.btake", {
    type: "button",
    "aria-label": `${label}: use the live value`,
    text: "←",
    disabled: !d.take,
    on: { click: () => set(row.id === "mode" ? S.live().run : d.live) },
  });

  const liveTxt = labelOf(row, e, d.live);
  return h(
    "div.brow",
    { class: classNames(!row.stage && "cont", !d.on && "off"), data: { id: row.id } },
    box,
    h("div.bset", {}, row.stage && h("span.bst2", { text: row.stage }), h("span.bl", {}, h("b", { text: label }))),
    ctlWrap,
    take,
    liveCell(d, liveTxt),
  );
}
