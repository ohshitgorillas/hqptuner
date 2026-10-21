// A slider: one range input beside a number box over one value.

import { classNames, html, userEdit, wheelGuard } from "../../../lib/dom.js";
import { NumBox } from "./NumBox.js";

/** @typedef {import("../../../lib/dom.js").ControlEvent} ControlEvent */

/**
 * A track and a number box showing `value`. The track answers only a held pointer or a focused key: `onMove` hears every
 * input event as it comes, `onCommit` the release, a key or the box's commit, clamped to `[min, max]`; the box shows
 * the number `onCommit` returns, or the clamped one.
 *
 * @param {{
 *   value: string,
 *   aria: string,
 *   min: number,
 *   max: number,
 *   step: number,
 *   dp?: number,
 *   unit?: string,
 *   off?: boolean,
 *   cls?: string,
 *   k?: string,
 *   testid?: string,
 *   onMove: (v: number) => void,
 *   onCommit: (v: number) => number | void,
 * }} props
 */
export function Slider({ value, aria, min, max, step, dp, unit, off = false, cls, k, testid, onMove, onCommit }) {
  const track = (/** @type {(v: number) => void} */ fn) =>
    userEdit(value, (/** @type {ControlEvent} */ e) => fn(Number(e.target.value)));
  const held = (/** @type {number} */ v) => Math.min(Math.max(v, min), max);
  return html`
    <div class=${classNames("xsl", cls, off && "grayed")} data-k=${k} data-testid=${testid}>
      <input
        type="range"
        min=${min}
        max=${max}
        step=${step}
        value=${value}
        aria-label=${aria}
        disabled=${off}
        onWheel=${wheelGuard}
        onInput=${track(onMove)}
        onChange=${track((v) => onCommit(held(v)))}
      />
      <${NumBox}
        value=${dp === undefined ? value : Number(value).toFixed(dp)}
        aria=${aria}
        unit=${unit}
        min=${min}
        max=${max}
        step=${step}
        off=${off}
        onCommit=${onCommit}
      />
    </div>
  `;
}
