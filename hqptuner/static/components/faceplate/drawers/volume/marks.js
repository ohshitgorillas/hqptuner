// The Range block's named marks: the key glyphs the bar draws (Min and Max brackets, the Startup pin, the loudness
// parentheses, the playback needle), each repeated small beside the box or readout that names it, the typed boxes
// that move a handle, and the read-only readouts.

import { html } from "../../../../lib/dom.js";
import { moveVolumeHandle } from "../../../../store/faceplate/drawers/volume.js";

/** @typedef {import("../../../../store/faceplate/drawers/volume.js").VolumeKey} VolumeKey */
/** @typedef {"min" | "max" | "pin" | "lparen" | "rparen" | "needle"} KeyGlyph */
/** @typedef {{ currentTarget: { value: string } }} ChangeEv */

/** Each glyph's shape in a 14 × 18 box. @type {Record<KeyGlyph, () => unknown>} */
const SHAPES = {
  min: () => html`<path class="brk" d="M9,2 H4 V16 H9" />`,
  max: () => html`<path class="brk" d="M5,2 H10 V16 H5" />`,
  pin: () => html`<path class="pin" d="M4,4 Q4,2 6,2 H8 Q10,2 10,4 V11 L7,15 L4,11 Z" />`,
  lparen: () => html`<path class="paren" d="M9,1 Q3,9 9,17" />`,
  rparen: () => html`<path class="paren" d="M5,1 Q11,9 5,17" />`,
  needle: () => html`<line class="nl" x1="7" x2="7" y1="1" y2="13" /><circle class="nd" cx="7" cy="15.5" r="2" />`,
};

/**
 * A key glyph, the small twin of a mark on the bar.
 *
 * @param {{ kind: KeyGlyph }} props
 */
const Glyph = ({ kind }) => html`
  <svg class="vrkey" viewBox="0 0 14 18" width="14" height="18" aria-hidden="true">${SHAPES[kind]()}</svg>
`;

/**
 * A typed handle: glyph, label, a whole-dB number box fenced by `min` and `max`, unit. A typed value moves the handle
 * through the clamp, and the box shows where it landed.
 *
 * @param {{ k: VolumeKey, setting: string, glyph: KeyGlyph, label: string, value: number, min: number, max: number,
 *   dirty: boolean, disabled: boolean }} props  setting: the handle's catalog key
 */
export function RangeBox({ k, setting, glyph, label, value, min, max, dirty, disabled }) {
  const onChange = (/** @type {ChangeEv} */ e) => {
    e.currentTarget.value = String(moveVolumeHandle(k, Number(e.currentTarget.value)));
  };
  return html`
    <label class="vrbox">
      <${Glyph} kind=${glyph} />
      <span class="cl">${label}</span>
      <input
        type="number"
        class="vfd"
        data-k=${setting}
        data-dirty=${dirty ? "" : undefined}
        aria-label=${label}
        value=${value}
        step="1"
        min=${min}
        max=${max}
        disabled=${disabled}
        onChange=${onChange}
      />
      <span class="u">dBFS</span>
    </label>
  `;
}

/**
 * A read-only mark: glyph, label, its value, unit.
 *
 * @param {{ glyph: KeyGlyph, label: string, text: string, unit: string, live?: boolean, hidden?: boolean }} props
 *   live: the playback level, a bright readout; hidden: its mark is not on the bar
 */
export const Readout = ({ glyph, label, text, unit, live = false, hidden = false }) => html`
  <div class="vrbox" hidden=${hidden}>
    <${Glyph} kind=${glyph} />
    <span class="cl">${label}</span>
    <output class=${live ? "vfd ro live" : "vfd ro"} aria-label=${live ? "Playback volume" : undefined}>${text}</output>
    <span class="u">${unit}</span>
  </div>
`;
