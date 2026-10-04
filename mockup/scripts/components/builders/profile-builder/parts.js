import { h, s } from "../../../lib/shell/dom.js";
import { paras, drow as row } from "../../../lib/builder/builder.js";
import { numBox } from "../../../lib/controls/controls.js";
import { set } from "./values.js";

/** @typedef {import('./records.js').PB} PB */
/** @typedef {import('./records.js').Choice} Choice */
/** @typedef {import('./records.js').NumField} NumField */
/** @typedef {import('../../../data/stages/output.js').Row['man']} Man  the manual's paragraphs: one, or keyed */
/** @typedef {{ v: string, label: string, man: string }} ChoiceOption */
/**
 * One value box: its label, unit, bounds and manual line; mul scales the stored value for display.
 *
 * @typedef {{ label: string, unit: string, min: number, max: number, step: number, man: string, mul?: number }} NumSpec
 */

// ── Page parts ──────────────────────────────────────────────────────────
/**
 * A drawer row: label and control on the left, the manual's paragraphs on the right, `extra` under them.
 *
 * @param {string} label
 * @param {HTMLElement} ctl
 * @param {Man} man
 * @param {HTMLElement} [extra]
 * @returns {HTMLElement}
 */
export const drow = (label, ctl, man, extra) => row(label, ctl, man, { extra });
/**
 * Choice lines (the Volume drawer's grammar): radio + name + its own paragraph.
 *
 * @param {string} label
 * @param {ChoiceOption[]} options
 * @param {() => string} get  the option picked
 * @param {(v: string) => void} pickOne
 * @returns {Choice}
 */
export function choice(label, options, get, pickOne) {
  const lines = options.map((op) => {
    const radio = h("button.radio", {
      type: "button",
      role: "radio",
      aria: { label: op.label },
      on: { click: () => pickOne(op.v) },
    });
    const el = h(
      "div.chline",
      { data: { v: op.v } },
      h("div.chl", {}, radio, h("span.chn", { on: { click: () => pickOne(op.v) } }, h("b", { text: op.label }))),
      h("div.man", {}, paras(op.man)),
    );
    return { op, el, radio };
  });
  const el = h(
    "div.drow.drow-full.pbchoice",
    {},
    h("div.ctl", {}, h("div.fh", {}, h("b", { text: label }))),
    h(
      "div.chlist",
      { role: "radiogroup", "aria-label": label },
      lines.map((l) => l.el),
    ),
  );
  // fold(): once a pick leads somewhere (crossfeed engaged), the unpicked lines fold to their names (the Crossfeed
  // drawer's fold of the unpicked implementation), so the step's next rows keep their room.
  return {
    el,
    paint: (fold) => {
      for (const l of lines) {
        const on = l.op.v === get();
        l.el.classList.toggle("cur", on);
        l.el.classList.toggle("fold", !!fold && !on);
        l.radio.setAttribute("aria-checked", String(on));
      }
    },
  };
}
/**
 * One value box bound to value `k`: typing stages it (divided by mul), paint shows it (times mul).
 *
 * @param {PB} pb
 * @param {string} k
 * @param {NumSpec} spec
 * @returns {NumField}
 */
export function num(pb, k, { label, unit, man, mul = 1, ...attrs }) {
  const { el: box, input } = numBox({ ...attrs, aria: label, unit });
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) set(pb, { [k]: +(n / mul).toFixed(4) });
  });
  return {
    label,
    man,
    el: h("label.ci", {}, h("span.cl", { text: label }), box),
    paint: () => {
      input.value = String(+(Number(pb.v[k]) * mul).toFixed(2));
    },
  };
}
/**
 * Several values in one row (the drawers' `group` grammar): boxes side by side, each with its label above; the
 * manual's paragraphs keyed by those labels on the right.
 *
 * @param {string} label
 * @param {NumField[]} nums
 * @returns {HTMLElement}
 */
export const group = (label, nums) =>
  drow(
    label,
    h(
      "div.cgrp",
      {},
      nums.map((n) => n.el),
    ),
    nums.map((n) => ({ k: n.label, text: n.man })),
  );

/**
 * The description's pencil (it marks the text as the user's to edit).
 *
 * @returns {SVGElement}
 */
export const pencil = () =>
  s(
    "svg",
    {
      viewBox: "0 0 16 16",
      width: 12,
      height: 12,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.4,
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    },
    s("path", { d: "M10.5 2.5l3 3-8 8H2.5v-3z" }),
    s("path", { d: "M9 4l3 3" }),
  );
