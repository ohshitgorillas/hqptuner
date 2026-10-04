// Segmented switch builder. Exactly one option is .on; clicking another moves it and calls onChange.

import { h } from "../../lib/shell/dom.js";

/** @typedef {import('../../../../hqptuner/static/model/shell/settings.js').Option & { title?: string }} SegOption */

/**
 * A segmented switch: one button per option, the one matching `value` on; a click on another moves the selection and
 * reports it.
 *
 * @param {object} o
 * @param {SegOption[]} o.options   unit: printed after the label, case kept
 * @param {string | number} [o.value]  initially selected v (compared as strings)
 * @param {string} [o.aria]       radiogroup label
 * @param {string} [o.tag]        element: 'div' (default) or 'span'
 * @param {string} [o.cls]        extra classes (e.g. 'mini')
 * @param {Record<string, string>} [o.attrs]  extra attributes for the group element
 * @param {(v: string, btn: HTMLButtonElement) => void} [o.onChange]
 * @returns {HTMLElement}
 */
export function seg({ options, value, aria, tag = "div", cls, attrs = {}, onChange }) {
  /** @type {HTMLElement} */
  const group = h(
    `${tag}.seg`,
    { class: cls, role: "radiogroup", "aria-label": aria, ...attrs },
    options.map((o) =>
      h(
        "button",
        {
          type: "button",
          title: o.title,
          class: String(o.v) === String(value) ? "on" : null,
          data: { v: o.v },
        },
        o.label,
        o.unit && h("span.su", { text: " " + o.unit }),
      ),
    ),
  );
  group.addEventListener("click", (e) => {
    const b = /** @type {Element} */ (e.target).closest("button");
    if (!b || b.classList.contains("on")) return;
    // Every button carries data-v (its option's v).
    const v = /** @type {string} */ (b.dataset.v);
    select(group, v);
    onChange?.(v, b);
  });
  return group;
}

/**
 * Move .on to the button whose data-v matches.
 *
 * @param {ParentNode} group
 * @param {string | number} v
 */
export function select(group, v) {
  for (const b of group.querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === String(v));
}
