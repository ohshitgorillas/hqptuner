// The Station builder's shared parts: the wizard's rich inline copy, tips, setting rows, choice lines, number boxes and a
// check's printed lines. None reads the builder's state.

import { h } from "../../../../lib/shell/dom.js";
import { paras as parasOf, drow as row } from "../../../../lib/builder/builder.js";
import { numBox } from "../../../../lib/controls/controls.js";
import { classNames } from "../../../../../../hqptuner/static/model/shell/format.js";

/** @typedef {string | { a?: string, href?: string, code?: string }} RichBit  a string, a link {a, href} or {code} */
/** @typedef {RichBit | RichBit[]} Rich */
/** @typedef {string | { k: string, text: Rich }} Para  a manual paragraph: plain, or keyed */
/** @typedef {Para | (Para | undefined)[] | undefined} Paras */
/** @typedef {{ v: string, label: string, man?: Paras }} ChoiceOption  one choice line */
/** @typedef {{ lines: string[], done: boolean, ok: boolean }} Run  a mock check in flight or done */

/** The book's one station key: a station builder's records are the stations themselves. */
export const ONE = "";

/**
 * Rich inline copy: strings, {a, href}, {code}, *emphasis* (the wizard's markdown).
 *
 * @param {Rich} bits
 */
export const rich = (bits) =>
  (Array.isArray(bits) ? bits : [bits]).flatMap((b) =>
    typeof b === "string"
      ? b
          .split(/(\*[^*]+\*|`[^`]+`)/)
          .filter(Boolean)
          .map((t) =>
            t.startsWith("*")
              ? h("em", { text: t.slice(1, -1) })
              : t.startsWith("`")
                ? h("code", { text: t.slice(1, -1) })
                : t,
          )
      : b.a
        ? h("a", { href: b.href, target: "_blank", rel: "noreferrer", text: b.a })
        : h("code", { text: b.code }),
  );

/**
 * The manual's paragraphs, their copy rich.
 *
 * @param {Paras} m
 */
export const paras = (m) => parasOf(m, rich);

/**
 * A tip: its bold label, then its rich copy.
 *
 * @param {string} label
 * @param {Rich} text
 */
export const tip = (label, text) => h("p.stbtip", {}, h("b", { text: label }), " ", rich(text));

/**
 * A setting row: label and control on the left, the manual's paragraphs on the right.
 *
 * @param {string} label
 * @param {import('../../../../lib/shell/dom.js').Kid} ctl
 * @param {Paras} man
 * @param {string} [cls]
 */
export const drow = (label, ctl, man, cls) => row(label, ctl, man, { cls, inline: rich });

/**
 * A choice line's head: its radio and its bold answer, either one picking it.
 *
 * @param {string} label
 * @param {boolean} on
 * @param {() => void} go
 */
export const choiceHead = (label, on, go) =>
  h(
    "div.chl",
    {},
    h("button.radio", { type: "button", role: "radio", aria: { checked: on, label }, on: { click: go } }),
    h("span.chn", { on: { click: go } }, h("b", { text: label })),
  );

/**
 * Choice lines (the drawers' grammar): radio + the answer's words + its own paragraph.
 *
 * @param {string} label
 * @param {ChoiceOption[]} options
 * @param {string} value
 * @param {{ pick: (v: string) => void, fold?: boolean }} o  pick an answer; fold the lines not picked
 */
export function choice(label, options, value, { pick, fold = false }) {
  return h(
    "div.drow.drow-full.pbchoice.stbch",
    {},
    label && h("div.ctl", {}, h("div.fh", {}, h("b", { text: label }))),
    h(
      "div.chlist",
      { role: "radiogroup", "aria-label": label || "Answer" },
      options.map((op) => {
        const on = op.v === value;
        return h(
          "div.chline",
          { class: classNames(on && "cur", fold && value && !on && "fold"), data: { v: op.v } },
          choiceHead(op.label, on, () => pick(op.v)),
          h("div.man", {}, paras(op.man)),
        );
      }),
    ),
  );
}

/**
 * A number box that writes a finite value on change.
 *
 * @param {string} label
 * @param {number} value
 * @param {{ min: number, max: number, step: number, unit: string, hint?: string }} box  its bounds, unit and hint
 * @param {(n: number) => void} onSet
 */
export const num = (label, value, { unit, hint, ...attrs }, onSet) => {
  const { el, input } = numBox({ ...attrs, value, aria: label, unit, hint });
  input.value = String(value);
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) onSet(n);
  });
  return el;
};

/**
 * A check's printed lines (the wizard's `...` lines, then its verdict).
 *
 * @param {Run | undefined} run
 */
export const lines = (run) =>
  run &&
  h(
    "div.stbrun",
    { role: "status" },
    run.lines.map((t, i) =>
      h("p", { class: i === run.lines.length - 1 && run.done ? (run.ok ? "ok" : "no") : "go", text: t }),
    ),
  );
