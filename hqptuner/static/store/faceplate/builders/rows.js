// The Snapshot builder's rows: each row's view against the edit showing and the engine now. Sits on the store half
// (./snapshot.js) for the rows, the edit showing and the engine now.

import { snapRow } from "../../../model/builders/snapshot.js";
import { schema } from "../../schema.js";
import { MODES } from "../../schema/options.js";
import { decorateOptions } from "../../plainnames.js";
import { plainNames } from "../../ui/prefs.js";
import { rawOptions } from "../lists/options.js";
import { profileChoices } from "../page/profile.js";
import { SNAP_ROWS, byChain, editNow, liveNow } from "./snapshot.js";

/** @typedef {import('../../../model/builders/snapshot.js').Chain} Chain */
/** @typedef {import('../../../model/builders/snapshot.js').RowView} RowView */
/** @typedef {import('./snapshot.js').Option} Option */
/** @typedef {import('./snapshot.js').SnapRow} SnapRow */

/**
 * One row of the page: the row against the engine, plus what it shows.
 *
 * @typedef {RowView & {
 *   id: string,
 *   stage?: string,
 *   label: string,
 *   kind: SnapRow['kind'],
 *   options?: Option[],
 *   valueText: string,
 *   liveText: string,
 * }} SnapView
 */

/** Output mode's Auto, which a live engine can run and a snapshot cannot hold. */
const AUTO = MODES.filter((m) => m.value === "auto").map((m) => ({ v: m.value, label: m.label }));

/**
 * Engine name `name` on catalog key `key` as a list shows it: its plain leaf in Simplified, else the name itself.
 *
 * @param {string} key
 * @param {string} name
 * @returns {string}
 */
export function plainName(key, name) {
  if (!plainNames.value) return name;
  const [o] = decorateOptions([{ label: name }], schema[key].plainNames ?? "");
  return "display" in o ? o.display : name;
}

/**
 * A list row's text for enum ID `v` on catalog key `key`: the option's plain leaf in Simplified, else its engine name;
 * the ID itself where no option holds it.
 *
 * @param {string} key
 * @param {string} v
 * @returns {string}
 */
function listText(key, v) {
  const name = rawOptions(key).find((o) => String(o.value) === v)?.label;
  return name ? plainName(key, name) : v;
}

/**
 * A row's options, read now: a select's the matrix profiles the select offers, a seg's its own.
 *
 * @param {SnapRow} row
 * @returns {Option[] | undefined}
 */
function optionsOf(row) {
  if (row.kind !== "select") return row.options;
  return profileChoices().options.map((o) => ({ v: o.value, label: o.label, disabled: o.disabled }));
}

/**
 * A row's text for value `v` on chain `ch`: a seg's or select's option label, a list's option name.
 *
 * @param {SnapRow} row
 * @param {Chain} ch
 * @param {string} v
 * @param {Option[] | undefined} options  the row's options, read now
 * @returns {string}
 */
function textOf(row, ch, v, options) {
  if (row.kind === "list") return listText(byChain(row.key, ch), v);
  return [...(options ?? []), ...AUTO].find((o) => o.v === v)?.label ?? v;
}

/**
 * Every row's view against the edit showing and the engine now.
 *
 * @returns {SnapView[]}
 */
export function snapshotRows() {
  const e = editNow();
  const L = liveNow();
  const ch = e.vals.mode;
  return SNAP_ROWS.map((row) => {
    const d = snapRow(row, e, L);
    const options = optionsOf(row);
    return {
      ...d,
      id: row.id,
      ...(row.stage ? { stage: row.stage } : {}),
      label: byChain(row.label, ch),
      kind: row.kind,
      ...(options ? { options } : {}),
      valueText: textOf(row, ch, d.value, options),
      liveText: textOf(row, ch, String(d.live), options),
    };
  });
}
