// A segmented control: one radio button per option.

import { html } from "../../../lib/dom.js";

/** @typedef {import("./types.js").Opt} Opt */

/**
 * One lit option among the given ones; a click on any option picks it.
 *
 * @param {{
 *   options: Opt[],
 *   value: string,
 *   aria: string,
 *   off?: boolean,
 *   cls?: string,
 *   k?: string,
 *   testid?: string,
 *   dots?: Record<string, boolean>,
 *   face?: (o: Opt) => unknown,
 *   onPick: (v: string) => void,
 * }} props
 */
export function Seg({ options, value, aria, off = false, cls, k, testid, dots = {}, face, onPick }) {
  const root = ["seg", cls, off ? "grayed" : undefined].filter(Boolean).join(" ");
  return html`
    <span class=${root} role="radiogroup" aria-label=${aria} data-k=${k} data-testid=${testid}>
      ${options.map((o) => {
        const on = o.value === value;
        const mark = [on ? "on" : undefined, dots[o.value] ? "dirty" : undefined].filter(Boolean).join(" ");
        return html`
          <button
            type="button"
            role="radio"
            aria-checked=${on ? "true" : "false"}
            class=${mark || undefined}
            data-v=${o.value}
            title=${o.tip}
            disabled=${off || Boolean(o.disabled)}
            onClick=${() => onPick(o.value)}
          >
            ${face ? face(o) : o.label}
          </button>
        `;
      })}
    </span>
  `;
}
