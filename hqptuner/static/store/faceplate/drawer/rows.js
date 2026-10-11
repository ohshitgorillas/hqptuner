// What a drawer row's control renders: the options it lists, the value it shows, each option's line, and for a key with
// a plain-names overlay the nameplate of its staged option and the pick its list hands back. An option's line is the
// one the settings metadata holds for it (store/prose.js), else the one the schema wrote for it.

import { truthy } from "../../../lib/coerce.js";
import { schema as catalog } from "../../schema.js";
import { describe, idFor, optionDescription, optionProse } from "../../prose.js";
import { effective, formFieldName } from "../../resolve.js";
import { edit } from "../../actions.js";
import { enumOptions, optionsFor } from "../../ui/options.js";
import { plainOf } from "../page/conversion.js";

/** @typedef {import("./grammar.js").RowOption} RowOption */
/** @typedef {import("../../prose.js").Fold} Fold */

/**
 * One option as a row's option list prints it: its value as the control writes it, its label, its line, and whether
 * it is the effective one.
 *
 * @typedef {object} OptionLine
 * @property {string} value
 * @property {string} label
 * @property {string} man   its line whole
 * @property {Fold} fold    its line as the prose folds it, for a surface that can hold part of it behind "see more"
 * @property {boolean} cur
 */

/** A checkbox row's two choices, drawn as a segment. */
const OFF_ON = [
  { value: "0", label: "Off" },
  { value: "1", label: "On" },
];

/**
 * The options a row's segment or select lists: the row's own when it gives them, else a checkbox's two, the engine's
 * enumeration, the daemon form's own list, or the catalog's.
 *
 * @param {string} key
 * @param {RowOption[]} [own]
 * @returns {RowOption[]}
 */
export function rowOptions(key, own) {
  if (own) return own;
  const e = catalog[key];
  if (!e) return [];
  if (e.widget === "checkbox") return OFF_ON;
  if (e.optionsFrom === "enum") return enumOptions(e.enumKey || "");
  if (e.optionsFrom) return optionsFor(e.optionsFrom, formFieldName(e));
  return e.options ?? [];
}

/**
 * The value a row's control renders, as its options are written: a truth as "1" or "0", anything else as a string.
 *
 * @param {string} key
 * @returns {string}
 */
export function rowValue(key) {
  const e = catalog[key];
  const v = effective(key);
  if (e && (e.widget === "checkbox" || e.bool)) return truthy(v) ? "1" : "0";
  return v === undefined ? "" : String(v);
}

/**
 * The nameplate of a row's staged option: its plain family, variant and leaf, as the page's nameplates break it down.
 *
 * @param {string} key
 * @returns {{ fam: string, variant: string | null, leaf: string }}
 */
export function drawerPlate(key) {
  const value = rowValue(key);
  const name = rowOptions(key).find((o) => String(o.value) === value)?.label ?? "";
  return plainOf(catalog[key]?.plainNames ?? "", name);
}

/**
 * A pick from a row's list: the picked engine name's enum ID staged through edit(). A name the row does not list
 * stages nothing.
 *
 * @param {string} key
 * @param {string} name  the engine name picked
 * @returns {Promise<void>}
 */
export async function drawerPick(key, name) {
  const id = idFor(rowOptions(key), name);
  if (id) await edit(key, id);
}

/**
 * Each option a row lists with its line, the effective one current.
 *
 * @param {string} key
 * @param {RowOption[]} [own]
 * @returns {OptionLine[]}
 */
export function rowLines(key, own) {
  const e = catalog[key];
  if (!e) return [];
  const meta = describe(e, key);
  const value = rowValue(key);
  return rowOptions(key, own).map((o) => {
    const prose = optionDescription(e, o, meta);
    const man = prose || o.man || "";
    return {
      value: String(o.value),
      label: o.label,
      man,
      fold: prose ? optionProse(e, o, meta) : { text: man, rest: [], more: [] },
      cur: String(o.value) === value,
    };
  });
}
