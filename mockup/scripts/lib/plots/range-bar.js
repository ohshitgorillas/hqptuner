// The range bar both dB-range editors draw (components/volume-range.js, components/loudness.js): one linear dBFS axis,
// a track with the span filled, ticks and labels under it, the live playback needle, handles dragged with pointer
// capture, the dragged value in a bubble, and the typed boxes under it, each named beside its own glyph. Geometry and
// handle rules from model/range-axis.js; each bar supplies its axis, its inset and its row heights.

import { h, s } from "../shell/dom.js";
import { scale } from "../shell/plate.js";
import { signed } from "../../model/shell/format.js";
import { barValueAt, barX, labelAnchor } from "../../model/gauges/range-axis.js";

/**
 * One bar's layout.
 *
 * @typedef {object} BarLayout
 * @property {import('../../model/gauges/range-axis.js').Axis} axis
 * @property {number} padX   track inset, room for the end labels
 * @property {{ bar: number, barH: number, tick: number, label: number }} Y  row tops in px
 */

/** A key glyph's name. @typedef {'min' | 'max' | 'pin' | 'lparen' | 'rparen' | 'needle'} KeyGlyph */

/**
 * Small key glyphs shared by the boxes and the bar, so each mark is named where it's typed.
 *
 * @param {KeyGlyph} kind
 */
function keyGlyph(kind) {
  const shape = {
    min: s("path.brk", { d: "M9,2 H4 V16 H9" }),
    max: s("path.brk", { d: "M5,2 H10 V16 H5" }),
    pin: s("path.pin", { d: "M4,4 Q4,2 6,2 H8 Q10,2 10,4 V11 L7,15 L4,11 Z" }),
    lparen: s("path.paren", { d: "M9,1 Q3,9 9,17" }),
    rparen: s("path.paren", { d: "M5,1 Q11,9 5,17" }),
    needle: [s("line.nl", { x1: 7, x2: 7, y1: 1, y2: 13 }), s("circle.nd", { cx: 7, cy: 15.5, r: 2 })],
  }[kind];
  return s("svg.vrkey", { viewBox: "0 0 14 18", width: 14, height: 18, "aria-hidden": "true" }, shape);
}

/**
 * A typed bound: glyph, label, whole-dB number input, unit.
 *
 * @param {string} label
 * @param {KeyGlyph} glyph
 * @param {{ id?: string, min?: number, max?: number }} attrs
 * @param {(v: number) => void} onChange
 */
export function rangeBox(label, glyph, { id, min, max }, onChange) {
  const input = h("input.vfd", { type: "number", id, step: 1, min, max, "aria-label": label });
  input.addEventListener("change", () => onChange(Number(input.value)));
  return {
    input,
    el: h("label.vrbox", {}, keyGlyph(glyph), h("span.cl", { text: label }), input, h("span.u", { text: "dBFS" })),
  };
}

/**
 * A read-only mark: glyph, label, output, unit.
 *
 * @param {{ glyph: KeyGlyph, label: string, out: Node, unit: string, cls?: string }} mark  cls: extra classes on the box
 */
export function readout({ glyph, label, out, unit, cls }) {
  return h(
    "div.vrbox",
    { class: cls },
    keyGlyph(glyph),
    h("span.cl", { text: label }),
    out,
    h("span.u", { text: unit }),
  );
}

/**
 * The marks every bar draws, at one width.
 *
 * @param {number} W
 * @param {BarLayout} layout
 */
export function barMarks(W, { axis, padX, Y }) {
  const x = barX(W, axis, padX);
  const by = Y.bar,
    bh = Y.barH;
  return {
    x,
    track: () => s("rect.trk", { x: padX - 3, y: by, width: W - 2 * padX + 6, height: bh, rx: 3 }),
    /** @param {string} cls  @param {number} a  @param {number} b */
    span: (cls, a, b) => s("rect", { class: cls, x: x(a), y: by, width: Math.max(0, x(b) - x(a)), height: bh }),
    /** @param {import('../../model/gauges/range-axis.js').TickMark[]} marks  @param {string} minorCls */
    ticks: (marks, minorCls) =>
      marks.map(({ d, weight, len }) =>
        s("line", {
          class: `tk ${weight === "minor" ? minorCls : weight}`,
          x1: x(d),
          x2: x(d),
          y1: Y.tick,
          y2: Y.tick + len,
        }),
      ),
    /** @param {Map<number, string>} labels */
    labels: (labels) =>
      [...labels].map(([d, t]) => s("text.tl", { x: x(d), y: Y.label, "text-anchor": labelAnchor(d, axis), text: t })),
    /** @param {number} v */
    needle: (v) =>
      s(
        "g.needle",
        {},
        s("line", { x1: x(v), x2: x(v), y1: by - 3, y2: by + bh + 3 }),
        s("circle", { cx: x(v), cy: by + bh + 7, r: 2.5 }),
      ),
    /** @param {number} d  @param {number} dir  @param {string} cls */
    paren: (d, dir, cls) => {
      const xx = x(d),
        bow = 5 * dir;
      return s("path", { class: cls, d: `M${xx},${by - 7} Q${xx - bow},${by + bh / 2} ${xx},${by + bh + 7}` });
    },
    /** @param {number} v */
    bubble: (v) => s("text.bub", { x: x(v), y: Y.label, "text-anchor": "middle", text: `${signed(v)} dBFS` }),
  };
}

/**
 * Drag on the bar with pointer capture: a press picks a handle and moves it to the pointer, moves follow it, release
 * or cancel ends the drag and redraws. Also redraws when the bar's well resizes.
 *
 * @param {SVGSVGElement} svg
 * @param {BarLayout & { blocked: () => boolean, pick: (v: number, yTop: number) => string,
 *   move: (k: string, v: number) => void, draw: () => void, grab?: () => void, drop?: () => void }} o
 * @returns {{ key: string | null }}  the handle being dragged, read by the bar's draw
 */
export function bindBar(svg, { axis, padX, blocked, pick, move, draw, grab, drop }) {
  /** @type {{ key: string | null }} */
  const st = { key: null };
  /** @param {PointerEvent} e */
  const at = (e) => barValueAt(svg.clientWidth, axis, padX, (e.clientX - svg.getBoundingClientRect().left) / scale());
  svg.addEventListener("pointerdown", (e) => {
    if (blocked()) return;
    const v = at(e);
    const key = pick(v, (e.clientY - svg.getBoundingClientRect().top) / scale());
    st.key = key;
    svg.setPointerCapture(e.pointerId);
    grab?.();
    move(key, v);
  });
  svg.addEventListener("pointermove", (e) => {
    if (st.key) move(st.key, at(e));
  });
  const end = () => {
    st.key = null;
    drop?.();
    draw();
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  new globalThis.ResizeObserver(draw).observe(/** @type {HTMLElement} */ (svg.parentElement)); // the bar's well
  return st;
}
