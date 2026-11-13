// A number box: one typed input with its unit and hint.

import { TypedInput, classNames, html, wheelGuard } from "../../../lib/dom.js";

/** @typedef {import("../../../lib/dom.js").ControlEvent} ControlEvent */

/**
 * A number input that commits on change: blank or non-numeric text commits nothing and shows `value` again, a number
 * commits clamped to `[min, max]`, and the box then shows the number `onCommit` returns, or the clamped one.
 *
 * @param {{
 *   value: string,
 *   aria: string,
 *   unit?: string,
 *   hint?: string,
 *   min?: number,
 *   max?: number,
 *   step?: number,
 *   off?: boolean,
 *   cls?: string,
 *   k?: string,
 *   testid?: string,
 *   onCommit: (v: number) => number | void,
 * }} props
 */
export function NumBox({ value, aria, unit, hint, min, max, step, off = false, cls, k, testid, onCommit }) {
  /** @param {ControlEvent} e */
  const commit = (e) => {
    const el = e.target;
    const n = el.valueAsNumber;
    if (!Number.isFinite(n)) {
      el.value = value;
      return;
    }
    const clamped = Math.min(Math.max(n, min ?? -Infinity), max ?? Infinity);
    const landed = onCommit(clamped);
    el.value = String(typeof landed === "number" ? landed : clamped);
  };
  return html`
    <div class=${classNames("num", cls, off && "grayed")} data-k=${k} data-testid=${testid}>
      <${TypedInput}
        class="vfd"
        type="number"
        value=${value}
        aria-label=${aria}
        min=${min}
        max=${max}
        step=${step}
        disabled=${off}
        onChange=${commit}
        onWheel=${wheelGuard}
      />
      ${unit && html`<span class="u">${unit}</span>`} ${hint && html`<span class="h">${hint}</span>`}
    </div>
  `;
}
