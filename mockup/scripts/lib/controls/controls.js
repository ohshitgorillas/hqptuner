// Control builders the stage drawers share: section headers, the round × close, the number box, the slider + box pair,
// the gray reason line, manual paragraphs and the choice radio lines. Each returns plain DOM; the caller wires values
// and staging.

import { h } from "../shell/dom.js";
import { withXref } from "./xref.js";

/** Section header: its title, then a rule to the right edge. cls = 'sh' (Settings), 'dsec' (drawer), 'msec' (mode drawer). */
export const secHead = (cls, text) => h(`div.${cls}`, {}, h("span.t", { text }), h("span.ln"));

/** Round × close button, the stage drawers' own. */
export const closeBtn = (onClick, label = "Close") =>
  h("button.round.dx", { type: "button", "aria-label": label, text: "×", on: { click: onClick } });

/**
 * Number box in its unit wrapper: the input, then the unit and the hint when given.
 * @param {{id?: string, value?: string|number, min?: number, max?: number, step?: number, aria?: string, unit?: string, hint?: string}} o
 * @returns {{el: HTMLElement, input: HTMLInputElement}}
 */
export function numBox({ id, value, min, max, step, aria, unit, hint }) {
  const input = h("input.vfd", { type: "number", id, value, min, max, step, "aria-label": aria });
  const el = h("div.num", {}, input, unit && h("span.u", { text: unit }), hint && h("span.h", { text: hint }));
  return { el, input };
}

/**
 * Slider paired with a number box, one value (crossfeed's .xsl grammar).
 * @param {{min?: number, max?: number, step?: number, aria?: string}} o
 * @returns {{el: HTMLElement, range: HTMLInputElement, box: HTMLInputElement}}
 */
export function sliderBox({ min, max, step, aria }) {
  const range = h("input", { type: "range", min, max, step, "aria-label": aria });
  const box = h("input.vfd", { type: "number", min, max, step, "aria-label": aria });
  return { el: h("div.xsl.slx", {}, range, h("div.num", {}, box)), range, box };
}

/**
 * Gray reason line, hidden while the block is live. say(why) shows why it is grayed, with the link to where that is
 * fixed (lib/xref.js); with link false the reason is its text alone.
 * @param {boolean} [link]
 * @returns {{el: HTMLElement, say: (why: string) => void}}
 */
export function grayReason(link = true) {
  const el = h("span.gr", { hidden: true });
  const say = (why) => {
    if (link) el.replaceChildren(...withXref(why));
    else el.textContent = why;
    el.hidden = !why;
  };
  return { el, say };
}

/** Manual paragraph: the sub-setting's label bolded ahead of its copy when k is given, else the copy alone. */
export const manPara = ({ k, text }) => h("p", {}, k && h("b", { text: k }), k && " — ", text);

/**
 * Vertical radio lines spanning the row; each line's detail control is live only while that line is picked.
 * @param {{id?: string, aria?: string, value: any, options: {v: any, label: string, sub?: string, control?: object, man?: string}[]}} c
 * @param {(control: object) => HTMLElement} detail  builds an option's detail control
 * @param {(v: string) => void} onPick              hears a pick that moves the selection
 * @returns {HTMLElement} the radiogroup; its _setValue(v) moves the selection without onPick
 */
export function choiceLines(c, detail, onPick) {
  let cur = String(c.value);
  const lines = c.options.map((o) => {
    const radio = h("button.radio", {
      type: "button",
      role: "radio",
      aria: { checked: false, label: o.label },
      on: { click: () => pick(o.v) },
    });
    const d = o.control && detail(o.control);
    return {
      o,
      radio,
      detail: d,
      el: h(
        "div.chline",
        { data: { v: o.v } },
        h(
          "div.chl",
          {},
          radio,
          h(
            "span.chn",
            { on: { click: () => pick(o.v) } },
            h("b", { text: o.label }),
            o.sub && h("span.s", { text: o.sub }),
          ),
          d,
        ),
        h("div.man", {}, o.man && h("p", { text: o.man })),
      ),
    };
  });
  const el = h(
    "div.chlist",
    { role: "radiogroup", "aria-label": c.aria, id: c.id },
    lines.map((l) => l.el),
  );
  function paint() {
    for (const l of lines) {
      const on = String(l.o.v) === cur;
      l.el.classList.toggle("cur", on);
      l.radio.setAttribute("aria-checked", String(on));
      if (l.detail) {
        l.detail.classList.toggle("grayed", !on);
        for (const x of l.detail.querySelectorAll("button,input")) x.disabled = !on;
      }
    }
  }
  function pick(v) {
    if (String(v) === cur) return;
    cur = String(v);
    paint();
    onPick(cur);
  }
  paint();
  el._setValue = (v) => {
    cur = String(v);
    paint();
  };
  return el;
}
