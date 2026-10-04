// A drawer tab's body items. A row names a v1 catalog key: its control column (label head, control, gray reason)
// beside the setting's paragraph, then, under it, every option with its line (`optMan`) or a select's picked option's
// line. Label and paragraph come from the settings metadata (store/prose.js), the value from the three-tree resolution,
// the gray reason from the schema's own rule; a control writes through edit(). Beside rows: a field and a choice
// (Field.js, Choice.js), a section header, a read-only note, a backend group shown by the schema's backend, an intro,
// and a block the caller passes in by name.

import { html } from "../../../lib/dom.js";
import { schema as catalog } from "../../../store/schema.js";
import { describe } from "../../../store/prose.js";
import { isDirty } from "../../../store/resolve.js";
import { grayReason } from "../../../store/ui/graying.js";
import { edit } from "../../../store/actions.js";
import { groupShown, rowLines, rowShown } from "../../../store/faceplate/drawer.js";
import { drawsSelect, grayLine, keyControl, labelHead } from "./controls.js";
import { field } from "./Field.js";
import { choice } from "./Choice.js";
import { Xref } from "../Xref.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/drawer.js").BodyItem} BodyItem */
/** @typedef {import("../../../store/faceplate/drawer.js").RowSpec} RowSpec */
/** @typedef {import("../../../store/faceplate/drawer.js").GroupItem} GroupItem */
/** @typedef {import("../../../store/faceplate/drawer.js").BlockItem} BlockItem */
/** @typedef {import("../../../store/faceplate/drawer.js").IntroPart} IntroPart */
/** @typedef {import("../../../store/faceplate/drawer.js").NoteLine} NoteLine */
/** @typedef {import("../../../store/faceplate/xref.js").XrefHere} XrefHere */
/** @typedef {Record<string, (props: { schema: DrawerSchema, here: XrefHere }) => unknown>} Blocks */

/**
 * Every option under the row with its line, the effective one current; tapping another stages it.
 *
 * @param {RowSpec} spec
 * @param {string} label
 */
const optList = (spec, label) => html`
  <div class="optlist" role="list" aria-label=${`${label} options`}>
    ${rowLines(spec.key, spec.options).map(
      (l) => html`
        <button
          type="button"
          class=${l.cur ? "optrow cur" : "optrow"}
          role="listitem"
          data-v=${l.value}
          aria-current=${String(l.cur)}
          onClick=${() => (l.cur ? undefined : edit(spec.key, l.value))}
        >
          <code>${l.label}</code><span>${l.man}</span>
        </button>
      `,
    )}
  </div>
`;

/**
 * A select's picked option's line, full width under the row; nothing unless its options carry lines.
 *
 * @param {RowSpec} spec
 * @param {SchemaField} entry
 */
function pickedLine(spec, entry) {
  if (!drawsSelect(entry.widget)) return null;
  const lines = rowLines(spec.key, spec.options);
  const cur = lines.some((l) => l.man) ? lines.find((l) => l.cur) : undefined;
  if (!cur) return null;
  return html`<div class="optfull"><p class="optman"><code>${cur.label}</code> ${cur.man}</p></div>`;
}

/**
 * One row; nothing for an unknown key or a row its `when` leaves out.
 *
 * @param {RowSpec} spec
 * @param {XrefHere} here  the drawer and tab the row is drawn on
 */
function row(spec, here) {
  const entry = catalog[spec.key];
  if (!entry || !rowShown(spec)) return null;
  const { key } = spec;
  const { label: described, tooltip } = describe(entry, key);
  const label = spec.label ?? described;
  const gray = grayReason(key);
  const control = keyControl({ key, entry, label, off: !!gray, options: spec.options, hint: spec.hint });
  return html`
    <div class="drow" data-k=${key} data-dirty=${isDirty(key) ? "" : undefined}>
      <div class="ctl">${labelHead(label, spec.sub, spec.band)} ${control} ${grayLine(gray, here)}</div>
      <div class="man"><p>${tooltip}</p></div>
      ${spec.optMan ? optList(spec, label) : pickedLine(spec, entry)}
    </div>
  `;
}

/**
 * A section header: its title, then a rule to the right edge.
 *
 * @param {string} text
 * @param {string} cls
 */
const secHead = (text, cls) => html`<div class=${cls}><span class="t">${text}</span><span class="ln"></span></div>`;

/**
 * A backend's rows under its header, hidden unless the schema names its backend or `combo`.
 *
 * @param {DrawerSchema} schema
 * @param {GroupItem} g
 * @param {XrefHere} here  the drawer and tab the group is drawn on
 */
const group = (schema, g, here) => html`
  <div class="begrp" data-be=${g.group} hidden=${!groupShown(schema, g.group)}>
    ${secHead(g.label, "dsec")} ${g.rows.map((r) => row(r, here))}
  </div>
`;

/**
 * One part of an intro: its text, or a place's name as the link there, plain when it names no place.
 *
 * @param {IntroPart} p
 */
const introPart = (p) => {
  if (typeof p === "string") return p;
  return p.to ? html`<${Xref} to=${p.to} label=${p.label} />` : p.label;
};

/**
 * An intro paragraph; a place's name in it is the link there.
 *
 * @param {string | IntroPart[]} intro
 */
function introPara(intro) {
  const parts = typeof intro === "string" ? [intro] : intro;
  return html`<p class="dintro">${parts.map(introPart)}</p>`;
}

/**
 * A read-only note: what its function reads now, then the link to the place it names.
 *
 * @param {NoteLine} n
 */
const noteLine = (n) => (typeof n === "string" ? n : html`${n.text} <${Xref} to=${n.to} />`);

/**
 * A block, the component the caller passed under its name mounted inside.
 *
 * @param {DrawerSchema} schema
 * @param {BlockItem} it
 * @param {Blocks} blocks
 * @param {XrefHere} here  the drawer and tab the block is drawn on
 */
function block(schema, it, blocks, here) {
  const Block = blocks[it.block];
  return html`<div class="dblock" data-block=${it.block}>
    ${Block ? html`<${Block} schema=${schema} here=${here} />` : null}
  </div>`;
}

/**
 * One body item of a tab, told apart by the key it carries.
 *
 * @param {DrawerSchema} schema
 * @param {BodyItem} it
 * @param {Blocks} blocks
 * @param {string} tab  the tab the item sits on
 */
export function item(schema, it, blocks, tab) {
  const here = { drawer: schema.id, tab };
  if ("row" in it) return row(it.row, here);
  if ("field" in it) return it.field.when && !it.field.when() ? null : field(it.field, here);
  if ("choice" in it) return choice(it.choice, here);
  if ("head" in it) return secHead(it.head, "msec");
  if ("note" in it) return html`<p class="mnote">${noteLine(it.note())}</p>`;
  if ("group" in it) return group(schema, it, here);
  if ("intro" in it) return introPara(it.intro);
  return block(schema, it, blocks, here);
}
