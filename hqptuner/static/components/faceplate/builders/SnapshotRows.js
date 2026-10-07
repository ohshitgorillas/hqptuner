// The snapshot rows of the builder: the column heads, Use live settings in the Live head, then one row per view (the
// include box, the stage and setting, the snapshot's value, ← and the engine's live value). What each row holds,
// differs from and takes is store/faceplate/builders/snapshot.js's; every tap hands the edit back through its change().

import { Fragment } from "preact";
import { html } from "../../../lib/dom.js";
import { classNames } from "../../../model/shell/format.js";
import { isChain } from "../../../model/builders/snapshot.js";
import { idFor, selectedLabel } from "../../../store/prose.js";
import { openOptionList } from "../../../store/faceplate/view.js";
import { rawOptions } from "../../../store/faceplate/lists/options.js";
import { SNAP_ROWS, change, editNow, liveNow, takeAll } from "../../../store/faceplate/builders/snapshot.js";
import { snapshotRows } from "../../../store/faceplate/builders/rows.js";
import { segButtons } from "../drawer/controls.js";

/** @typedef {import("../../../store/faceplate/builders/rows.js").SnapView} SnapView */
/** @typedef {(v: string) => void} Set  writes one row's value into the edit */

/**
 * The writer of row `id`'s value: a chain row's under the edit's chain, every other row's by its id.
 *
 * @param {string} id
 * @returns {Set}
 */
const setter = (id) => (v) =>
  change((x) => {
    if (isChain(id)) x.vals[x.vals.mode][id] = v;
    else x.vals[id] = v;
  });

/**
 * Hold row `id` in the snapshot, or let it go.
 *
 * @param {string} id
 */
const toggle = (id) =>
  change((x) => {
    if (x.inc.has(id)) x.inc.delete(id);
    else x.inc.add(id);
  });

/**
 * The catalog key of row `id` on the snapshot's chain.
 *
 * @param {string} id
 * @returns {string}
 */
function chainKey(id) {
  const key = SNAP_ROWS.find((r) => r.id === id)?.key ?? "";
  return typeof key === "string" ? key : key[editNow().vals.mode];
}

/** The column heads: Snapshot over the values, Live over the engine's, with Use live settings. */
const heads = () => html`
  <div class="brow bcols">
    <span></span>
    <span></span>
    <span class="bct">Snapshot</span>
    <span></span>
    <span class="bct blh">
      <span>Live</span>
      <button type="button" class="btn sm" onClick=${() => change(takeAll)}>Use live settings</button>
    </span>
  </div>
`;

/**
 * A list row's picker: the snapshot's value, opening the option list on the snapshot's chain key at the held ID's
 * engine name; a pick writes the picked name's enum ID, and a name the key's list does not carry writes nothing.
 *
 * @param {SnapView} v
 * @param {Set} set
 */
function picker(v, set) {
  const key = chainKey(v.id);
  /** @param {string} name */
  const pick = (name) => {
    const id = idFor(rawOptions(key), name);
    if (id) set(id);
  };
  const open = () =>
    openOptionList({
      key,
      stage: v.id === "nx" ? "nx" : "1x",
      value: selectedLabel(rawOptions(key), v.value),
      pick,
    });
  return html`
    <button
      type="button"
      class="vfd vpick"
      aria-label=${v.label}
      aria-haspopup="dialog"
      data-list=${key}
      disabled=${!v.on}
      onClick=${open}
    >
      ${v.valueText}
    </button>
  `;
}

/**
 * A select row's native select over its options, the snapshot's value selected.
 *
 * @param {SnapView} v
 * @param {Set} set
 */
const select = (v, set) => html`
  <select
    class="vfd"
    aria-label=${v.label}
    disabled=${!v.on}
    onChange=${(/** @type {{ currentTarget: { value: string } }} */ e) => set(e.currentTarget.value)}
  >
    ${(v.options ?? []).map(
      (o) => html`<option value=${o.v} selected=${o.v === v.value} disabled=${o.disabled}>${o.label}</option>`,
    )}
  </select>
`;

/**
 * The row's control: a select row's native select, segment buttons over a seg row's options, else the list picker.
 *
 * @param {SnapView} v
 * @param {Set} set
 */
const control = (v, set) =>
  v.kind === "select"
    ? select(v, set)
    : v.options
      ? segButtons({
          options: v.options.map((o) => ({ value: o.v, label: o.label })),
          value: v.value,
          label: v.label,
          off: !v.on,
          pick: set,
        })
      : picker(v, set);

/**
 * The engine's value, marked where it differs on a held row and where its chain is idle.
 *
 * @param {SnapView} v
 */
const liveCell = (v) => html`
  <div class=${classNames("vfd blive", v.differs && v.on && "diff")} title=${v.idle ? `${v.liveText} · idle` : v.liveText}>
    <span class="v"><span class="bt">${v.liveText}</span>${v.idle ? html`<span class="bidle">· idle</span>` : null}</span>
  </div>
`;

/**
 * One row: include box | stage + setting | the snapshot's value | ← | the engine's live value.
 *
 * @param {SnapView} v
 */
function row(v) {
  const set = setter(v.id);
  const live = v.id === "mode" ? liveNow().run : String(v.live);
  return html`
    <div class=${classNames("brow", !v.stage && "cont", !v.on && "off")} data-id=${v.id}>
      <button
        type="button"
        class="binc"
        role="checkbox"
        aria-checked=${String(v.on)}
        aria-label=${`Attach ${v.label}`}
        disabled=${v.gated}
        onClick=${() => toggle(v.id)}
      ></button>
      <div class="bset">
        ${v.stage ? html`<span class="bst2">${v.stage}</span>` : null}
        <span class="bl"><b>${v.label}</b></span>
      </div>
      <div class=${v.on ? "bval" : "bval grayed"}>${control(v, set)}</div>
      <button
        type="button"
        class="round btake"
        aria-label=${`${v.label}: use the live value`}
        disabled=${!v.take}
        onClick=${() => set(live)}
      >
        ←
      </button>
      ${liveCell(v)}
    </div>
  `;
}

/** The snapshot rows. */
export function SnapshotRows() {
  return html`
    <${Fragment}>
      ${heads()}
      <div class="brows">${snapshotRows().map(row)}</div>
    <//>
  `;
}
