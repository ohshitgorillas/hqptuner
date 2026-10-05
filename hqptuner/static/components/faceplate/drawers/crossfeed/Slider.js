// The Crossfeed block's slider and number box over one value (v1 SliderNumber, the mockup's .xsl grammar): a drag
// streams, the release or a typed number commits, held to the slider's range.

import { html, userEdit, wheelGuard, TypedInput } from "../../../../lib/dom.js";

/** @typedef {import("../../../../lib/dom.js").ControlEvent} ControlEvent */

/**
 * A labelled slider beside its number box.
 *
 * @param {{ label: string, sub?: string, min: number, max: number, step: number, unit: string, dp: number,
 *   value: number, disabled: boolean, onDrag: (v: number) => void, onCommit: (v: number) => void }} props
 */
export function Slider({ label, sub, min, max, step, unit, dp, value, disabled, onDrag, onCommit }) {
  const held = (/** @type {number} */ v) => Math.max(min, Math.min(max, v));
  const rangeOn = (/** @type {(v: number) => void} */ fn) =>
    userEdit(value, (/** @type {ControlEvent} */ e) => fn(Number(e.target.value)));
  return html`
    <div class="xsl">
      <span class="cl">${label}${sub ? html`<span class="h">${sub}</span>` : null}</span>
      <input
        type="range"
        min=${min}
        max=${max}
        step=${step}
        value=${value}
        aria-label=${label}
        disabled=${disabled}
        onWheel=${wheelGuard}
        onInput=${rangeOn(onDrag)}
        onChange=${rangeOn((v) => onCommit(held(v)))}
      />
      <div class="num">
        <${TypedInput}
          type="number"
          class="vfd"
          min=${min}
          max=${max}
          step=${step}
          value=${Number(value).toFixed(dp)}
          aria-label=${label}
          disabled=${disabled}
          onWheel=${wheelGuard}
          onChange=${(/** @type {{ currentTarget: HTMLInputElement }} */ e) =>
            onCommit(held(Number(e.currentTarget.value)))}
        />
        <span class="u">${unit}</span>
      </div>
    </div>
  `;
}
