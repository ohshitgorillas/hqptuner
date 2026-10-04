// Crossfeed drawer, Structural side: Preset, Speaker angle, Head circumference, Center character, and the top-down
// listening-geometry cartoon with its readouts under the lines.

import { h, s } from "../../../lib/shell/dom.js";
import { pathParams } from "../../../lib/dsp/xdsp.js";
import { headGlyph, speakerGlyph } from "../../../lib/controls/glyphs.js";
import { minus, plusMinus } from "../../../../../hqptuner/static/model/shell/format.js";
import { geometryReadouts, listeningGeometry, structuralPreset } from "../../../model/gauges/crossfeed.js";
import { paintAll, slider } from "../crossfeed.js";

/** @typedef {import("../crossfeed.js").View} View */

export const S_TOL = { angle: 0.05, lambda: 0.005 }; // a slider's Structural values still read as their preset

/**
 * Structural's controls, in mount order.
 *
 * @param {View} v
 * @returns {Pick<View, 'sPreset' | 'angle' | 'circ' | 'lambda' | 'conflict'>}
 */
export function structuralControls(v) {
  const { cfg } = v,
    M = cfg.man;
  const sPreset = /** @type {HTMLSelectElement} */ (h("select.vfd.xspre", { "aria-label": "Preset" }));
  sPreset.addEventListener("change", () => {
    const p = cfg.sPresets.find((x) => x.v === sPreset.value);
    if (p) {
      v.set("angle", p.angle);
      v.set("lambda", p.lambda);
    }
    paintAll(v);
  });
  const angle = slider(v, { k: "angle", label: "Speaker angle", min: 5, max: 60, step: 0.5, unit: "°", dp: 1 });
  const circ = slider(v, {
    k: "circ",
    label: "Head circumference",
    min: 41,
    max: 66,
    step: 0.25,
    unit: "cm",
    dp: 2,
    sub: (/** @type {number} */ c) => `${(c / (2 * Math.PI)).toFixed(2)} cm radius`,
  });
  const lambda = slider(v, {
    k: "lambda",
    label: "Center character",
    min: 0,
    max: 150,
    step: 1,
    unit: "%",
    dp: 0,
    mul: 100,
  });
  const conflict = h("span.gr", { hidden: true, text: M.linear });
  return { sPreset, angle, circ, lambda, conflict };
}

/**
 * The Structural preset select: the preset the sliders match, or Custom.
 *
 * @param {View} v
 */
export function paintPreset(v) {
  const { st, cfg, sPreset } = v;
  const m = structuralPreset(cfg.sPresets, st.angle, st.lambda, S_TOL);
  const options = cfg.sPresets.map((p) => h("option", { value: p.v, text: p.label }));
  if (!m) options.push(h("option", { value: "custom", text: "Custom" }));
  sPreset.replaceChildren(...options);
  sPreset.value = m ? m.v : "custom";
}

/**
 * The Structural cartoon with its readouts.
 *
 * @returns {Pick<View, 'diagram' | 'RO' | 'diagHost'>}
 */
export function geometryHost() {
  // Structural: no plot glass. v1's card layout: the cartoon drawn on the plate under the controls column, and v1's
  // three readouts (owner copy) beside it, where the copy column sits above.
  const diagram = s("svg.xfdiag", {
    role: "img",
    "aria-label": "Top-down view: the simulated speakers, toed in toward the listener",
    viewBox: "52 6 296 172",
    preserveAspectRatio: "xMidYMid meet",
  });
  const ro = (/** @type {string} */ label) => {
    const val = h("dd"),
      sub = h("span");
    return { v: val, sub, el: h("div", {}, h("dt", { text: label }), h("dd", {}, val, sub)) };
  };
  const RO = { itd: ro("Ear-to-ear delay"), far: ro("Far ear, treble"), center: ro("Center shift") };
  const diagHost = h(
    "div.xfgeo",
    {},
    h("div.xfpic", {}, diagram),
    h(
      "dl.xfro",
      {},
      Object.values(RO).map((r) => r.el),
    ),
  );
  return { diagram, RO, diagHost };
}

/** @param {[number, number]} p */
const xy = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

/**
 * Top-down cartoon (v1 Geometry.js conventions), coordinates from model/crossfeed.js listeningGeometry.
 *
 * @param {View} v
 */
export function drawGeometry(v) {
  const { st } = v;
  const g = listeningGeometry(st.angle, st.circ);
  const { cx, cy, r, earL, earR, speakers: spk, arc } = g;
  // v1 Readouts: ITD (ray) · its low-frequency value (+ shadow-filter group delays), far-ear treble, center shift at λ.
  const ro = geometryReadouts(pathParams(st.angle, g.a / 100), st.lambda);
  v.RO.itd.v.textContent = `${ro.itd} µs`;
  v.RO.itd.sub.textContent = ` · ${ro.itdLow} µs at low frequencies`;
  v.RO.far.v.textContent = `${minus(ro.far, 1)} dB`;
  v.RO.center.v.textContent = `${plusMinus(ro.center, 2)} dB`;
  // Far path: speaker → tangent over the front of the head → around to the far ear.
  const far = (/** @type {typeof g.far[0]} */ p) =>
    `M${xy(p.from)} L${xy(p.via)} A${r},${r} 0 0 ${p.sweep} ${xy(p.to)}`;
  v.diagram.replaceChildren(
    ...[
      s("line.axis", g.axis),
      g.ref.map((l) => s("line.ref", l)),
      s("path.arc", {
        d: `M${arc.from[0]},${arc.from[1]} A${arc.r},${arc.r} 0 0 1 ${arc.to.map((x) => x.toFixed(1)).join(",")}`,
      }),
      s("text.ang", { x: g.label[0], y: g.label[1], "text-anchor": "middle", text: `${minus(st.angle, 1)}°` }),
      // Far paths first (dashed, under), then near paths (solid).
      s("path.far", { d: far(g.far[0]) }),
      s("path.far", { d: far(g.far[1]) }),
      s("line.near", { x1: spk[0].p[0], y1: spk[0].p[1], x2: earL[0], y2: earL[1] }),
      s("line.near", { x1: spk[1].p[0], y1: spk[1].p[1], x2: earR[0], y2: earR[1] }),
      headGlyph(cx, cy, r, 6),
      s("rect.ear", { x: earL[0] - 3, y: cy - 5, width: 4, height: 10, rx: 1.5 }),
      s("rect.ear", { x: earR[0] - 1, y: cy - 5, width: 4, height: 10, rx: 1.5 }),
      spk.map(({ d, p }, i) =>
        s(
          "g.spk",
          {},
          speakerGlyph(p[0], p[1], d),
          s("text.sl", {
            x: p[0] + (i ? 18 : -18),
            y: p[1] + 4,
            "text-anchor": i ? "start" : "end",
            text: i ? "R" : "L",
          }),
        ),
      ),
    ]
      .flat(2)
      .filter(Boolean),
  );
}
