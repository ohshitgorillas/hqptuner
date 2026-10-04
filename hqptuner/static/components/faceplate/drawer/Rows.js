// A drawer tab's body items: a row naming a v1 catalog key, an intro paragraph, or a block the caller passes in by
// name. A row is its control column (label, control, gray reason) beside the setting's paragraph. Label and paragraph
// come from the settings metadata (store/prose.js), the value from the three-tree resolution, the gray reason from the
// schema's own rule; a control writes through edit(). A segment or a checkbox is drawn as segment buttons, a dropdown
// as a select, a number as a number box.

import { html } from "../../../lib/dom.js";
import { schema as catalog } from "../../../store/schema.js";
import { describe } from "../../../store/prose.js";
import { isDirty } from "../../../store/resolve.js";
import { grayReason } from "../../../store/ui/graying.js";
import { edit } from "../../../store/actions.js";
import { rowOptions, rowValue } from "../../../store/faceplate/drawer.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/drawer.js").BodyItem} BodyItem */
/** @typedef {Record<string, (props: { schema: DrawerSchema }) => unknown>} Blocks */
/** @typedef {{ key: string, entry: SchemaField, label: string, gray: string }} Ctl */
/** @typedef {{ currentTarget: { value: string } }} ChangeEv */

/**
 * Segment buttons, the effective option lit; tapping another option stages it.
 *
 * @param {Ctl} c
 */
function segment({ key, label, gray }) {
  const value = rowValue(key);
  return html`
    <div class=${gray ? "seg grayed" : "seg"} role="radiogroup" aria-label=${label}>
      ${rowOptions(key).map((o) => {
        const v = String(o.value);
        const on = v === value;
        return html`
          <button
            type="button"
            class=${on ? "on" : undefined}
            data-v=${v}
            disabled=${!!gray}
            onClick=${() => (on ? undefined : edit(key, v))}
          >
            ${o.label}
          </button>
        `;
      })}
    </div>
  `;
}

/**
 * A select over the row's options, the effective one selected.
 *
 * @param {Ctl} c
 */
function select({ key, label, gray }) {
  const value = rowValue(key);
  return html`
    <select
      class=${gray ? "vfd grayed" : "vfd"}
      aria-label=${label}
      disabled=${!!gray}
      onChange=${(/** @type {ChangeEv} */ e) => edit(key, e.currentTarget.value)}
    >
      ${rowOptions(key).map(
        (o) => html`
          <option value=${String(o.value)} selected=${String(o.value) === value} disabled=${!!o.disabled}>
            ${o.label}
          </option>
        `,
      )}
    </select>
  `;
}

/**
 * A number box holding the effective value, its unit after it.
 *
 * @param {Ctl} c
 */
function number({ key, entry, label, gray }) {
  return html`
    <div class="num">
      <input
        type="number"
        class=${gray ? "vfd grayed" : "vfd"}
        aria-label=${label}
        value=${rowValue(key)}
        min=${entry.min}
        max=${entry.max}
        step=${entry.step}
        disabled=${!!gray}
        onChange=${(/** @type {ChangeEv} */ e) => edit(key, e.currentTarget.value)}
      />
      ${entry.unit ? html`<span class="u">${entry.unit}</span>` : null}
    </div>
  `;
}

/** The control each widget kind is drawn as. @type {Record<string, (c: Ctl) => unknown>} */
const CONTROLS = { segment, checkbox: segment, dropdown: select, number };

/**
 * One row: the control column (label, control, gray reason) beside the setting's paragraph.
 *
 * @param {string} key
 */
function row(key) {
  const entry = catalog[key];
  if (!entry) return null;
  const { label, tooltip } = describe(entry, key);
  const gray = grayReason(key);
  const control = CONTROLS[entry.widget];
  return html`
    <div class="drow" data-k=${key} data-dirty=${isDirty(key) ? "" : undefined}>
      <div class="ctl">
        <div class="fh"><b>${label}</b></div>
        ${control ? control({ key, entry, label, gray }) : null} ${gray ? html`<span class="gr">${gray}</span>` : null}
      </div>
      <div class="man"><p>${tooltip}</p></div>
    </div>
  `;
}

/**
 * One body item of a tab, told apart by the key it carries.
 *
 * @param {DrawerSchema} schema
 * @param {BodyItem} it
 * @param {Blocks} blocks
 */
export function item(schema, it, blocks) {
  if ("row" in it) return row(it.row.key);
  if ("intro" in it) return html`<p class="dintro">${it.intro}</p>`;
  const Block = blocks[it.block];
  return html`<div class="dblock" data-block=${it.block}>${Block ? html`<${Block} schema=${schema} />` : null}</div>`;
}
