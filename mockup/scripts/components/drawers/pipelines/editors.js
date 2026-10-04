// DSP pipelines drawer: the stage dock's editors (dock.js lays them out). Each returns the dock's parts for one stage:
// what it is, its values, and the copy that explains them.

import { h } from "../../../lib/shell/dom.js";
import { seg } from "../../controls/seg.js";
import { PMAN, IIR_TYPES, ARG_NAME, ARG_UNIT, DELAY_ARGS, DELAY_V } from "../../../data/stages/pipelines.js";
import { delayFields, gainSwitch, iirFields, retypeStage } from "../../../model/shell/pipelines-edit.js";

/** @typedef {import('../../../model/shell/pipelines.js').Pipe} Pipe */
/** @typedef {import('../../../model/shell/pipelines.js').Stage} Stage */
/** @typedef {import('../../../model/shell/pipelines-edit.js').DelayArg} DelayArg */
/** @typedef {ReturnType<typeof iirFields>} IirFields */
/** @typedef {IirFields['args'][number]} IirArg */
/** @typedef {() => void} After  stage the set and repaint, once an edit lands */
/** @typedef {import('../../../lib/shell/dom.js').Kid} Kid */

/**
 * One stage's dock: what it is (row 1), the right end of that row, its values (row 2), and the copy under them. Each part
 * holds what h() takes as children.
 *
 * @typedef {object} Dock
 * @property {Kid} [what]
 * @property {Kid} [right]
 * @property {Kid[]} [values]
 * @property {Kid[]} copy
 */

/** @type {Record<string, string>} */
const WNAME = { q: "Q", bw: "Bandwidth", s: "Slope" };
/** @type {Record<string, string>} */
const DELAY_NAME = { s: "Samples", t: "Seconds", d: "Meters" };
const ARG_NAMES = /** @type {Record<string, string | undefined>} */ (ARG_NAME);
const ARG_UNITS = /** @type {Record<string, string | undefined>} */ (ARG_UNIT);

/**
 * A manual line: its wire code, then what it means.
 *
 * @param {string} code
 * @param {string} text
 * @returns {HTMLElement}
 */
export const tline = (code, text) => h("p.ptl", {}, h("code", { text: code }), " ", text);

/**
 * The manual's paragraphs, the empty ones dropped.
 *
 * @param {...string} xs
 * @returns {HTMLElement[]}
 */
export const paras = (...xs) => xs.filter(Boolean).map((x) => h("p.pmp", { text: x }));

/**
 * A field's label.
 *
 * @param {string} t
 * @returns {HTMLElement}
 */
export const lab = (t) => h("span.cl.pdl", { text: t });

/**
 * @param {string} x
 * @returns {string}
 */
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);

/**
 * A number box that commits on change.
 *
 * @param {number | string | null | undefined} val
 * @param {string} aria
 * @param {(v: number) => void} onCommit
 * @param {number} [width]  px
 * @returns {HTMLInputElement}
 */
const numBox = (val, aria, onCommit, width) => {
  const el = /** @type {HTMLInputElement} */ (
    h("input.vfd", {
      type: "number",
      value: val ?? "",
      step: "any",
      "aria-label": aria,
      style: width && `width:${width}px`,
    })
  );
  el.addEventListener("change", () => onCommit(Number(el.value)));
  return el;
};

/**
 * The gain chip's dock: the gain and its unit (a switch carries the value over).
 *
 * @param {Pipe} p
 * @param {After} after
 * @returns {Dock}
 */
export function gainDock(p, after) {
  const unit = seg({
    aria: "Gain unit",
    cls: "enum mini2",
    value: p.unit,
    options: [
      { v: "dB", label: "dB" },
      { v: "Lin", label: "Lin" },
    ],
    onChange: (v) => {
      p.unit = v;
      p.gain = gainSwitch(p.gain, v);
      after();
    },
  });
  return {
    values: [
      h(
        "div.pfield",
        {},
        lab("Gain"),
        numBox(
          p.gain,
          "Gain",
          (v) => {
            p.gain = v;
            after();
          },
          92,
        ),
        unit,
      ),
    ],
    copy: paras(PMAN.gain),
  };
}

/**
 * A RIAA stage's dock: its subsonic filter.
 *
 * @param {Stage} st
 * @param {After} after
 * @param {null} right
 * @returns {Dock}
 */
export function riaaDock(st, after, right) {
  return {
    right,
    values: [
      h(
        "div.pfield",
        {},
        lab("Subsonic filter"),
        seg({
          aria: "subsonic",
          cls: "mini2",
          value: String(st.subsonic ?? 1),
          options: [
            { v: "0", label: "Off" },
            { v: "1", label: "On" },
          ],
          onChange: (v) => {
            st.subsonic = +v;
            after();
          },
        }),
      ),
    ],
    copy: paras(PMAN.riaa),
  };
}

/**
 * A file stage's dock (convolution, a PEQ file): its file and Upload.
 *
 * @param {Stage} st
 * @param {null} right
 * @returns {Dock}
 */
export function fileDock(st, right) {
  const isTxt = /\.txt$/i.test(st.file || "");
  return {
    right,
    values: [
      h(
        "div.pfield",
        {},
        lab("File"),
        h("span.vfd.pfile", { text: st.file || "—" }),
        h("button.btn.xs", { type: "button", text: "Upload…" }),
      ),
    ],
    copy: paras(isTxt ? PMAN.peqFile : PMAN.conv),
  };
}

/**
 * An iir stage's editor: its type picker, its argument fields, the width hint and its manual line.
 *
 * @param {Stage} st
 * @param {After} after
 * @returns {{ type: HTMLSelectElement, values: HTMLElement[], copy: Kid[] }}
 */
export function iirEditor(st, after) {
  const f = iirFields(st, IIR_TYPES, IIR_TYPES[7]);
  const def = f.def;
  const typeSel = /** @type {HTMLSelectElement} */ (
    h(
      "select.vfd.ptype",
      { "aria-label": "Filter type" },
      IIR_TYPES.map((x) => h("option", { value: x.t, selected: x.t === st.type, text: `${x.d}: ${x.t}` })),
    )
  );
  typeSel.addEventListener("change", () => {
    const keep = retypeStage(st, typeSel.value, IIR_TYPES);
    for (const k of Object.keys(st)) delete st[k]; // in place: block rows share their ear's EQ objects
    Object.assign(st, keep);
    after();
  });
  const argText =
    def.t === "biquad"
      ? "b0=b0 b1=b1 b2=b2 a0=a0 a1=a1 a2=a2"
      : [
          `${def.args[0]}=${ARG_NAMES[def.args[0]]}`,
          def.alt.length ? def.alt.map((a) => `${a}=${ARG_NAMES[a]}`).join(" OR ") : null,
          ...def.args.slice(1).map((a) => `${a}=${ARG_NAMES[a]}`),
        ]
          .filter(Boolean)
          .join(" ");
  const hint =
    f.hint === "bw"
      ? "Width can be given as a Q or as a Bandwidth: a higher Q is narrower, a higher Bandwidth is wider."
      : f.hint === "s"
        ? "Steepness can be given as a Q or as a Slope: Slope 1 is the steepest it gets without overshoot."
        : null;
  return {
    type: typeSel,
    values: f.args.map((x) => iirField(st, f, x, after)),
    copy: [hint && h("p.phint", { text: hint }), tline(def.t, `${argText}. ${PMAN.iirUnits}`)],
  };
}

/**
 * The width argument: the manual's either/or (q=Q OR bw=bandwidth, q=Q OR s=slope) as "Width [n] as [Q | Bandwidth]".
 *
 * @param {Stage} st
 * @param {IirFields} f
 * @param {IirArg} arg
 * @param {After} after
 * @returns {HTMLElement}
 */
function iirField(st, f, { arg: a, value, switchable }, after) {
  const { def, alt: altCur } = f;
  const box = numBox(
    value,
    ARG_NAMES[a] || a,
    (v) => {
      st[a] = v;
      after();
    },
    def.t === "biquad" ? 60 : 72,
  );
  if (switchable) {
    return h(
      "div.pfield",
      {},
      lab(f.hint === "bw" ? "Width" : "Steepness"),
      box,
      lab("as"),
      seg({
        aria: "Set as",
        cls: "enum mini2",
        value: altCur,
        options: def.alt.map((x) => ({ v: x, label: WNAME[x] })),
        onChange: (v) => {
          const val = st[altCur];
          delete st[altCur];
          st[v] = val ?? (v === "s" ? 1 : 0.707);
          after();
        },
      }),
    );
  }
  return h(
    "label.pfield",
    {},
    lab(def.t === "biquad" ? a : a === altCur ? WNAME[a] : cap(ARG_NAMES[a] || a)),
    box,
    ARG_UNITS[a] && h("span.u", { text: ARG_UNITS[a] }),
  );
}

/**
 * A delay stage's editor: the unit it is given in, its value (and the speed of sound for a distance), their manual lines.
 *
 * @param {Stage} st
 * @param {After} after
 * @returns {{ unit: HTMLElement, values: HTMLElement[], copy: HTMLElement[] }}
 */
export function delayEditor(st, after) {
  const { cur, value, speed } = delayFields(st, DELAY_ARGS, DELAY_ARGS[1]);
  const unit = seg({
    aria: "Delay given in",
    cls: "enum mini2",
    value: cur.a,
    options: DELAY_ARGS.map((x) => ({ v: x.a, label: DELAY_NAME[x.a] })),
    onChange: (v) => {
      const val = st[cur.a];
      delete st[cur.a];
      if (cur.a !== "d") delete st.v;
      st[v] = val ?? 0;
      after();
    },
  });
  return {
    unit,
    values: /** @type {HTMLElement[]} */ (
      [
        h(
          "label.pfield",
          {},
          lab("Delay"),
          numBox(
            value,
            cur.d,
            (v) => {
              st[cur.a] = v;
              after();
            },
            92,
          ),
          h("span.u", { text: cur.unit }),
        ),
        cur.a === "d" &&
          h(
            "label.pfield",
            {},
            lab("Speed of sound"),
            numBox(
              speed,
              DELAY_V.d,
              (v) => {
                st.v = v;
                after();
              },
              92,
            ),
            h("span.u", { text: "m/s" }),
          ),
      ].filter(Boolean)
    ),
    copy: /** @type {DelayArg[]} */ ([cur, cur.a === "d" && DELAY_V].filter(Boolean)).map((x) => tline(x.a, x.d)),
  };
}
