// The Station builder's shared parts: the wizard's rich inline copy, tips, setting rows, choice lines, number boxes and a
// check's printed lines. None reads the builder's state.

import { h } from "../../../../lib/shell/dom.js";
import { paras as parasOf, drow as row } from "../../../../lib/builder/builder.js";
import { numBox } from "../../../../lib/controls/controls.js";
import { classNames } from "../../../../model/shell/format.js";

/** The book's one station key: a station builder's records are the stations themselves. */
export const ONE = "";

/** Rich inline copy: strings, {a, href}, {code}, *emphasis* (the wizard's markdown). */
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
export const paras = (m) => parasOf(m, rich);
export const tip = (label, text) => h("p.stbtip", {}, h("b", { text: label }), " ", rich(text));
export const drow = (label, ctl, man, cls) => row(label, ctl, man, { cls, inline: rich });

/** Choice lines (the drawers' grammar): radio + the answer's words + its own paragraph. */
export function choice(label, options, value, pick, { fold = false } = {}) {
  return h(
    "div.drow.drow-full.pbchoice.stbch",
    {},
    label && h("div.ctl", {}, h("div.fh", {}, h("b", { text: label }))),
    h(
      "div.chlist",
      { role: "radiogroup", "aria-label": label || "Answer" },
      options.map((op) => {
        const on = op.v === value;
        const go2 = () => pick(op.v);
        return h(
          "div.chline",
          { class: classNames(on && "cur", fold && value && !on && "fold"), data: { v: op.v } },
          h(
            "div.chl",
            {},
            h("button.radio", {
              type: "button",
              role: "radio",
              aria: { checked: on, label: op.label },
              on: { click: go2 },
            }),
            h("span.chn", { on: { click: go2 } }, h("b", { text: op.label })),
          ),
          h("div.man", {}, paras(op.man)),
        );
      }),
    ),
  );
}

/** A number box that writes a finite value on change. */
export const num = (label, unit, value, attrs, onSet, hint) => {
  const { el, input } = numBox({ ...attrs, value, aria: label, unit, hint });
  input.value = value;
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) onSet(n);
  });
  return el;
};

/** A check's printed lines (the wizard's `...` lines, then its verdict). */
export const lines = (run) =>
  run &&
  h(
    "div.stbrun",
    { role: "status" },
    run.lines.map((t, i) =>
      h("p", { class: i === run.lines.length - 1 && run.done ? (run.ok ? "ok" : "no") : "go", text: t }),
    ),
  );
