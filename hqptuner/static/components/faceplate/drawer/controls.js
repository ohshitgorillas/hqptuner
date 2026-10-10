// The controls a drawer draws: segment buttons over an option list, and the control a catalog key's widget is drawn as.
// A segment or a checkbox is segment buttons, a dropdown or a steps widget a select (a nameplate opening the key's
// option list where the key has a plain-names overlay), a number, slidernum or knob widget a number box, a text widget a
// text box; each writes through edit(). Also the label head and the gray reason line
// every row-shaped item shares, with the link to the place the reason names.

import { html, TypedInput } from "../../../lib/dom.js";
import { edit } from "../../../store/actions.js";
import { drawerPick, drawerPlate, rowLines, rowOptions, rowValue } from "../../../store/faceplate/drawer.js";
import { openOptionList } from "../../../store/faceplate/view.js";
import { NameFace } from "../NameFace.js";
import { withXref } from "../Xref.js";

/** @typedef {import("../../../store/faceplate/drawer.js").RowOption} RowOption */
/** @typedef {{ currentTarget: { value: string } }} ChangeEv */
/** @typedef {import("../../../store/faceplate/xref.js").XrefHere} XrefHere */

/**
 * What a catalog key's control is drawn from.
 *
 * @typedef {object} KeyCtl
 * @property {string} key
 * @property {SchemaField} entry
 * @property {string} label  the control's accessible name
 * @property {boolean} off  grayed and disabled
 * @property {RowOption[]} [options]  listed in place of the catalog's
 * @property {string} [hint]  printed after a number box
 */

/**
 * Segment buttons, the option `value` names lit; tapping another hands its value to `pick`.
 *
 * @param {{ options: { value: unknown, label: string }[], value: string, label: string, off: boolean,
 *   pick: (v: string) => unknown }} s
 */
export function segButtons({ options, value, label, off, pick }) {
  return html`
    <div class=${off ? "seg grayed" : "seg"} role="radiogroup" aria-label=${label}>
      ${options.map((o) => {
        const v = String(o.value);
        const on = v === value;
        return html`
          <button
            type="button"
            class=${on ? "on" : undefined}
            data-v=${v}
            disabled=${off}
            onClick=${() => (on ? undefined : pick(v))}
          >
            ${o.label}
          </button>
        `;
      })}
    </div>
  `;
}

/**
 * A row's label head: the label, then its sublabel and band tag when given, then a control parked on the line.
 *
 * @param {string} label
 * @param {string} [sub]
 * @param {string} [band]
 * @param {unknown} [tail]  a control drawn at the line's end
 */
export const labelHead = (label, sub, band, tail) => html`
  <div class="fh">
    <b>${label}</b>${sub ? html`<span class="s">${sub}</span>` : null}
    ${band ? html`<span class="band">${band.toUpperCase()}</span>` : null}${tail ?? null}
  </div>
`;

/**
 * The gray reason line, with the link to the place it names, or nothing while the control is live.
 *
 * @param {string} why
 * @param {XrefHere} here  the drawer and tab the line is drawn on
 */
export const grayLine = (why, here) => (why ? html`<span class="gr">${withXref(why, here)}</span>` : null);

/** @param {KeyCtl} c */
const segment = (c) =>
  segButtons({
    options: rowOptions(c.key, c.options),
    value: rowValue(c.key),
    label: c.label,
    off: c.off,
    pick: (v) => edit(c.key, v),
  });

/**
 * The element id of a key's nameplate, where its list parks.
 *
 * @param {string} key
 */
const plateId = (key) => `dplate-${key}`;

/**
 * A nameplate naming the staged option by its plain family, variant and leaf; a tap opens the key's option list, and a
 * pick from it is staged.
 *
 * @param {KeyCtl} c
 */
function nameplate({ key, label, off }) {
  const face = drawerPlate(key);
  const open = () =>
    openOptionList({
      key,
      stage: key.endsWith("_nx") ? "nx" : "1x",
      value: rowLines(key).find((l) => l.cur)?.label ?? "",
      pick: (name) => drawerPick(key, name),
      anchor: plateId(key),
    });
  return html`
    <button
      type="button"
      class=${off ? "vfd cplate grayed" : "vfd cplate"}
      id=${plateId(key)}
      data-list=${key}
      aria-label=${`${label}: ${face.leaf}`}
      aria-haspopup="dialog"
      disabled=${off}
      onClick=${open}
    >
      <${NameFace} ...${face} />
    </button>
  `;
}

/**
 * A select over the key's options, the effective one selected; a key with a plain-names overlay draws its nameplate
 * instead.
 *
 * @param {KeyCtl} c
 */
function select(c) {
  if (c.entry.plainNames) return nameplate(c);
  const { key, label, off, options } = c;
  const value = rowValue(key);
  return html`
    <select
      class=${off ? "vfd grayed" : "vfd"}
      aria-label=${label}
      disabled=${off}
      onChange=${(/** @type {ChangeEv} */ e) => edit(key, e.currentTarget.value)}
    >
      ${rowOptions(key, options).map(
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
 * A number box holding the effective value, its unit and the row's hint after it.
 *
 * @param {KeyCtl} c
 */
function number({ key, entry, label, off, hint }) {
  return html`
    <div class="num">
      <${TypedInput}
        type="number"
        class=${off ? "vfd grayed" : "vfd"}
        aria-label=${label}
        value=${rowValue(key)}
        min=${entry.min}
        max=${entry.max}
        step=${entry.step}
        disabled=${off}
        onChange=${(/** @type {ChangeEv} */ e) => edit(key, e.currentTarget.value)}
      />
      ${entry.unit ? html`<span class="u">${entry.unit}</span>` : null}
      ${hint ? html`<span class="h">${hint}</span>` : null}
    </div>
  `;
}

/**
 * A one-line text box holding the effective value.
 *
 * @param {KeyCtl} c
 */
const textBox = ({ key, label, off }) => html`
  <${TypedInput}
    type="text"
    class=${off ? "vfd txt grayed" : "vfd txt"}
    spellcheck="false"
    aria-label=${label}
    value=${rowValue(key)}
    disabled=${off}
    onChange=${(/** @type {ChangeEv} */ e) => edit(key, e.currentTarget.value)}
  />
`;

/** The control each widget kind is drawn as. @type {Record<string, (c: KeyCtl) => unknown>} */
const CONTROLS = {
  segment,
  checkbox: segment,
  dropdown: select,
  steps: select,
  number,
  slidernum: number,
  knob: number,
  text: textBox,
};

/**
 * Whether a widget kind is drawn as a select.
 *
 * @param {string} widget
 */
export const drawsSelect = (widget) => CONTROLS[widget] === select;

/**
 * The control a catalog key's widget is drawn as; nothing for a widget the drawer does not draw.
 *
 * @param {KeyCtl} c
 */
export function keyControl(c) {
  const draw = CONTROLS[c.entry.widget];
  return draw ? draw(c) : null;
}
