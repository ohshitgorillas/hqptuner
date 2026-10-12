// The grammar a stage drawer's schema is written in, its tabs and their body items, and which catalog keys those items
// stage. store/faceplate/drawer.js decides over these shapes and re-exports them; components/faceplate/drawer/ draws
// them.
//
// A row names one key, a stack its rows' keys, a backend group its rows' and stacks' keys, a choice its lines' detail keys, a block the keys it says it
// stages; a field, a header, a note and an intro stage none. A row its `when` or its catalog entry leaves out, and the
// rows of a group its backend hides, stay staged but are not shown.

import { schema as catalog } from "../../schema.js";
import { rowOptions, rowValue } from "./rows.js";

/**
 * An option a row lists: the value its control writes, its label, and its line where the settings metadata holds none.
 *
 * @typedef {object} RowOption
 * @property {string | number | undefined} value  the value written, compared as a string
 * @property {string} label
 * @property {boolean} [disabled]  listed but not pickable
 * @property {string} [man]  the option's line, written in the schema verbatim from its source
 */

/**
 * A row naming a catalog key (store/schema.js): its control column (label, control, gray reason) beside the
 * setting's paragraph, both from the settings metadata. It writes through the write path; a staged edit to a
 * restart-lane key dots its tab.
 *
 * @typedef {object} RowSpec
 * @property {string} key  the catalog key the row reads and writes
 * @property {string} [label]  a label in place of the metadata's
 * @property {string} [sub]  a sublabel after the label
 * @property {string} [band]  a band tag after the label, printed in capitals
 * @property {boolean} [optMan]  every option listed under the row with its line, the picked one current; a tap picks
 * @property {string} [hint]  a hint after the number box
 * @property {() => boolean} [when]  false leaves the row out
 * @property {RowOption[]} [options]  the options listed in place of the catalog's
 */

/**
 * An option a field lists.
 *
 * @typedef {object} FieldOption
 * @property {string} value  the value `set` is handed
 * @property {string} label
 */

/**
 * A control with no catalog key: a browser preference, the auto-pilot switch, a gate held by its own form. Drawn as
 * segment buttons; a tap writes at once through `set`, and a field never dots a tab.
 *
 * @typedef {object} FieldSpec
 * @property {string} id  unique in its drawer
 * @property {string} label
 * @property {string} [sub]  a sublabel after the label
 * @property {string[]} man  the field's paragraphs
 * @property {FieldOption[]} options
 * @property {() => string} value  the option lit now
 * @property {(v: string) => unknown} set  writes a tapped option
 * @property {() => string} [gray]  why the field is grayed; empty while it is live
 * @property {() => boolean} [when]  false leaves the field out
 */

/**
 * One radio line of a choice: its name, its paragraph and, when it names a catalog key, that key's control as its
 * detail, grayed and disabled unless the line is picked.
 *
 * @typedef {object} ChoiceLine
 * @property {string} v  the value picking the line hands to `pick`
 * @property {string} label
 * @property {string} [sub]  a sublabel after the name
 * @property {string} man  the line's paragraph
 * @property {string} [key]  the catalog key whose control is the line's detail; it stages, and dots the tab
 * @property {RowOption[]} [options]  the detail's options, listed in place of the catalog's
 */

/**
 * Vertical radio lines spanning the row. The choice's header carries the restart mark when a key `pick` writes or a
 * line's detail key restarts the engine; its lines carry none.
 *
 * @typedef {object} ChoiceSpec
 * @property {string} id  unique in its drawer
 * @property {string} label
 * @property {string[]} man  the choice's paragraphs
 * @property {() => string} value  the line picked now
 * @property {(v: string) => unknown} pick  picks a line; tapping the picked one does not call it
 * @property {string[]} [writes]  the catalog keys `pick` writes
 * @property {ChoiceLine[]} lines
 */

/**
 * Several rows under one label line: each row's control stacked one over the other under the label, each with its own
 * gray reason, and each row's paragraphs in order beside them. The label line carries the restart mark when any row's
 * key restarts the engine; the stack reads dirty when any key is staged and carries the worst alert of its keys. A row
 * in a stack draws no label line and no option lines of its own. Shown while any of its rows is.
 *
 * @typedef {object} StackSpec
 * @property {string} label  the one label
 * @property {string} [band]  a band tag after the label, printed in capitals
 * @property {RowSpec[]} stack  the rows, top to bottom
 */

/**
 * A backend's rows and stacks under a section header, shown while the schema's `group` names the backend or `combo`.
 *
 * @typedef {object} GroupItem
 * @property {string} group  the backend
 * @property {string} label  the section header
 * @property {(RowSpec | StackSpec)[]} rows
 */

/**
 * A block the caller mounts by name. `keys` are the catalog keys it stages, so its tab takes the dot and the apply
 * group.
 *
 * @typedef {object} BlockItem
 * @property {string} block
 * @property {string[]} [keys]
 */

/**
 * A part of an intro: plain text, or a place's name, printed as the link to the place `to` names
 * (store/faceplate/xref.js), plain without one.
 *
 * @typedef {string | { label: string, to?: string }} IntroPart
 */

/**
 * What a note reads: its line, or its line and the place the line names, printed as the link there after it.
 *
 * @typedef {string | { text: string, to: string }} NoteLine
 */

/**
 * One body item of a tab, told apart by the key it carries: a row, a field, a choice, a section header, a read-only
 * note, a backend group, an intro, or a block.
 *
 * @typedef {{ row: RowSpec }
 *   | { field: FieldSpec }
 *   | { choice: ChoiceSpec }
 *   | { head: string }
 *   | { note: () => NoteLine }
 *   | GroupItem
 *   | { intro: string | IntroPart[] }
 *   | BlockItem} BodyItem
 */

/**
 * One tab of a drawer.
 *
 * @typedef {object} DrawerTab
 * @property {string} id
 * @property {string} label
 * @property {BodyItem[]} body
 * @property {() => string} [status]  a word after the label (`idle`); a drawer showing a tab with one reads idle
 */

/**
 * A drawer's own form, which its apply group applies and discards in place of the staged set.
 *
 * @typedef {object} OwnForm
 * @property {() => boolean} staged  whether the form holds edits
 * @property {() => unknown} apply
 * @property {() => unknown} discard
 */

/**
 * A stage drawer's schema.
 *
 * @typedef {object} DrawerSchema
 * @property {string} id  its rail stage's id; the drawer is open while that stage is
 * @property {string} title  shown in place of the tab strip on a drawer of one tab
 * @property {string} aria  the drawer's and its tab strip's accessible name
 * @property {string} [family]  members of one family share their staged state
 * @property {DrawerTab[]} tabs
 * @property {() => string} [group]  the backend whose groups show; `combo` shows every group
 * @property {() => string} [opensOn]  the tab a closed drawer opens on; a tab picked while open holds until it closes
 * @property {OwnForm} [own]
 */

/**
 * The engine name of a row's effective option; empty where its value lists none.
 *
 * @param {string} key
 * @returns {string}
 */
const pickedName = (key) => rowOptions(key).find((o) => String(o.value) === rowValue(key))?.label ?? "";

/**
 * Whether any of a chain's picked filter names is FFT-family.
 *
 * @param {string[]} names  the engine names of the chain's picked filters
 * @returns {boolean}
 */
const fftFamily = (names) => names.some((n) => /\bFFT\b/.test(n));

/**
 * Whether a row is shown on a tab: its `when` allows it, and where its catalog entry names the tab's filter keys under
 * `fftChains`, one of those filters is FFT-family.
 *
 * @param {RowSpec} row
 * @param {string} [tab]  the id of the tab the row is drawn on; without one, no chain's filters apply
 * @returns {boolean}
 */
export function rowShown(row, tab) {
  if (row.when && !row.when()) return false;
  const filters = catalog[row.key]?.fftChains?.[tab ?? ""];
  return !filters || fftFamily(filters.map(pickedName));
}

/**
 * Whether a backend group is shown: the schema names its backend or `combo`, or names none.
 *
 * @param {DrawerSchema} drawer
 * @param {string} group
 * @returns {boolean}
 */
export function groupShown(drawer, group) {
  const backend = drawer.group?.();
  return backend === undefined || backend === group || backend === "combo";
}

/**
 * The rows one of a group's entries stands for: a stack's rows, or the row itself.
 *
 * @param {RowSpec | StackSpec} r
 * @returns {RowSpec[]}
 */
const groupRows = (r) => ("stack" in r ? r.stack : [r]);

/**
 * The catalog keys one body item stages.
 *
 * @param {BodyItem} it
 * @returns {string[]}
 */
function itemKeys(it) {
  if ("row" in it) return [it.row.key];
  if ("group" in it) return it.rows.flatMap(groupRows).map((r) => r.key);
  if ("choice" in it) return it.choice.lines.flatMap((l) => (l.key ? [l.key] : []));
  if ("block" in it) return it.keys ?? [];
  return [];
}

/**
 * Every catalog key a tab stages, shown or not.
 *
 * @param {DrawerTab} tab
 * @returns {string[]}
 */
export const tabKeys = (tab) => tab.body.flatMap(itemKeys);

/**
 * The catalog keys a tab stages and shows: its keys less a row not shown on the tab and the rows of a hidden group.
 *
 * @param {DrawerSchema} drawer
 * @param {DrawerTab} tab
 * @returns {string[]}
 */
export const shownKeys = (drawer, tab) =>
  tab.body.flatMap((it) => {
    if ("row" in it) return rowShown(it.row, tab.id) ? [it.row.key] : [];
    if ("group" in it)
      return groupShown(drawer, it.group)
        ? it.rows
            .flatMap(groupRows)
            .filter((r) => rowShown(r, tab.id))
            .map((r) => r.key)
        : [];
    return itemKeys(it);
  });
