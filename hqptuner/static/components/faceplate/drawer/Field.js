// A field: a control with no catalog key (a browser preference, the auto-pilot switch, a gate held by its own form),
// drawn as a row of segment buttons beside its paragraphs. A tap writes at once through the schema's `set`; a field
// stages nothing, so it never dots a tab.

import { html } from "../../../lib/dom.js";
import { grayLine, labelHead, segButtons } from "./controls.js";

/** @typedef {import("../../../store/faceplate/drawer.js").FieldSpec} FieldSpec */
/** @typedef {import("../../../store/faceplate/xref.js").XrefHere} XrefHere */

/**
 * One field.
 *
 * @param {FieldSpec} f
 * @param {XrefHere} here  the drawer and tab the field is drawn on
 */
export function field(f, here) {
  const gray = f.gray?.() ?? "";
  const control = segButtons({
    options: f.options,
    value: String(f.value()),
    label: f.label,
    off: !!gray,
    pick: f.set,
  });
  return html`
    <div class="drow" data-field=${f.id}>
      <div class="ctl">${labelHead(f.label, f.sub)} ${control} ${grayLine(gray, here)}</div>
      <div class="man">${f.man.map((p) => html`<p>${p}</p>`)}</div>
    </div>
  `;
}
