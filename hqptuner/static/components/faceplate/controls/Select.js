// A select: one native drop-down over the given options.

import { classNames, html, wheelGuard } from "../../../lib/dom.js";

/** @typedef {import("./types.js").Opt} Opt */
/** @typedef {import("../../../lib/dom.js").ControlEvent} ControlEvent */

/**
 * The option whose value is `value` shown picked; a pick of any option calls `onPick`, and the box then shows `value`
 * again, so a pick the owner does not take snaps back.
 *
 * @param {{
 *   options: Opt[],
 *   value: string,
 *   aria: string,
 *   off?: boolean,
 *   cls?: string,
 *   k?: string,
 *   testid?: string,
 *   onPick: (v: string) => void,
 * }} props
 */
export function Select({ options, value, aria, off = false, cls, k, testid, onPick }) {
  /** @param {ControlEvent} e */
  const pick = (e) => {
    const el = e.target;
    onPick(el.value);
    el.value = value;
  };
  return html`
    <select
      class=${classNames("vfd", cls, off && "grayed")}
      aria-label=${aria}
      data-k=${k}
      data-testid=${testid}
      disabled=${off}
      onChange=${pick}
      onWheel=${wheelGuard}
    >
      ${options.map(
        (o) => html`
          <option value=${o.value} title=${o.tip} selected=${o.value === value} disabled=${Boolean(o.disabled)}>
            ${o.label}
          </option>
        `,
      )}
    </select>
  `;
}
