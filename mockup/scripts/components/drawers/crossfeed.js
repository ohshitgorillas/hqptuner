// Crossfeed drawer body.
//   Gate       ENGAGE | BYPASS (v1's crossfeed gate; stage gates are ENGAGE | BYPASS). It acts on
//              whichever implementation is picked below.
//   Lines      Bauer | Structural, one picked (Volume's choice grammar); the unpicked one folds to one summary line (the
//              Resampling · Shaping bar grammar) so the drawer never scrolls. Picking a line is a view choice in v1's
//              sense: it switches the implementation, it never engages crossfeed by itself.
//     Bauer      HQPlayer's post-process (libbs2b): Preset, Frequency + Level (live only on Custom, manual §7), and v1's
//                Crossfeed compensation (0–150 %: the center path's treble tilt brought back toward neutral).
//     Structural HQPTuner's sixteen-pipeline block (v1 docs/crossfeed-math.md): Preset, Speaker angle, Head circumference,
//                Center character. Its copy is v1's (owner copy).
//   Under the lines, filling the height left:
//     Bauer      response plot, traces named beside their lines (v1 trace names).
//     Structural v1's top-down cartoon (xfeed/Geometry.js conventions): speakers toed in at ±angle, head sized by the
//                circumference, solid = each ear's near path, dashed = the far path crossfeed synthesizes, ±30° reference
//                ticks, drawn on the plate (no plot glass) under the controls, with v1's readouts beside it.
// Everything stages (restore lane) through the drawer block context. Grays whole while the matrix engine is bypassed;
// the lines gray with v1's `Enable crossfeed to adjust.` while bypassed here.

import { h, grayBut } from "../../lib/shell/dom.js";
import { seg, select } from "../controls/seg.js";
import { mountRespPlot } from "../controls/resp-plot.js";
import { BAUER_PRESETS } from "../../lib/dsp/xdsp.js";
import { grayReason, manPara, numBox } from "../../lib/controls/controls.js";
import { minus } from "../../../../hqptuner/static/model/shell/format.js";
import { bauerSummary, crossfeedGray, structuralSummary } from "../../model/gauges/crossfeed.js";
import { ENGAGE_BYPASS } from "../../data/stages/matrix.js";
import { bauerControls, drawBauer } from "./crossfeed/bauer.js";
import { S_TOL, drawGeometry, geometryHost, paintPreset, structuralControls } from "./crossfeed/structural.js";

const OFF_REASON = "Enable crossfeed to adjust."; // v1 gray.js crossfeedOff
const ID = {
  gate: "xfgate",
  impl: "xfimpl",
  preset: "xfpreset",
  freq: "xffreq",
  level: "xflevel",
  comp: "xfcomp",
  angle: "xsangle",
  circ: "xscirc",
  lambda: "xslambda",
};

/**
 * @typedef {import('../../model/gauges/crossfeed.js').BauerFields} BauerFields
 * @typedef {import('../../model/gauges/crossfeed.js').StructuralFields} StructuralFields
 * @typedef {import('./drawer/state.js').BlockCtx} BlockCtx
 * @typedef {import('./drawer/state.js').Store} Store
 */

/**
 * CROSSFEED (data/matrix.js): the stored mode, each implementation's values, the presets and the manual copy.
 *
 * @typedef {object} CrossfeedConfig
 * @property {string} mode  off | bauer | structural
 * @property {BauerFields} bauer
 * @property {StructuralFields} structural
 * @property {{ v: string, label: string }[]} presets
 * @property {{ v: string, label: string, angle: number, lambda: number }[]} sPresets
 * @property {Record<string, string>} man
 */

/** @typedef {{ gate: string, impl: string } & BauerFields & StructuralFields} CrossfeedState  gate '0' | '1' */
/** @typedef {keyof typeof ID} CrossfeedKey */
/** @typedef {'freq' | 'level' | 'comp' | 'angle' | 'circ' | 'lambda'} NumericKey */
/** @typedef {{ el: HTMLElement, paint: () => void }} Slider */
/** @typedef {{ el: HTMLElement, input: HTMLInputElement }} NumField */
/** @typedef {{ v: HTMLElement, sub: HTMLElement, el: HTMLElement }} Readout */
/**
 * One implementation line's elements, `v` its implementation.
 *
 * @typedef {object} Line
 * @property {string} v
 * @property {HTMLElement} el
 * @property {HTMLElement} radio
 * @property {HTMLElement} sum
 * @property {HTMLElement} body
 * @property {HTMLElement} copy
 */

/**
 * One mounted drawer: its state, staging setter, matrix-family environment and the elements the paint passes reach.
 *
 * @typedef {object} View
 * @property {HTMLElement} host
 * @property {CrossfeedConfig} cfg
 * @property {CrossfeedState} st
 * @property {(k: CrossfeedKey, val: string | number) => void} set  write a field and stage it
 * @property {{ iir2fir: string, mxWhy: string }} env
 * @property {HTMLElement} gateSeg
 * @property {HTMLElement} presetSeg
 * @property {NumField} freq
 * @property {NumField} level
 * @property {HTMLElement} custom
 * @property {Slider} comp
 * @property {HTMLElement} tilt
 * @property {HTMLSelectElement} sPreset
 * @property {Slider} angle
 * @property {Slider} circ
 * @property {Slider} lambda
 * @property {HTMLElement} conflict
 * @property {Line[]} lines
 * @property {{ el: HTMLElement, say: (why: string) => void }} reason
 * @property {HTMLElement} plotHost
 * @property {SVGElement} diagram
 * @property {{ itd: Readout, far: Readout, center: Readout }} RO
 * @property {HTMLElement} diagHost
 * @property {ReturnType<typeof mountRespPlot>} rp
 */

/**
 * Mount the crossfeed drawer body into `host`, staging through `ctx`.
 *
 * @param {HTMLElement} host
 * @param {CrossfeedConfig} cfg  CROSSFEED (data/matrix.js)
 * @param {BlockCtx} ctx
 * @param {(vals: Store) => string} bypassed  gray reason from the family's values
 */
export function mountCrossfeed(host, cfg, ctx, bypassed) {
  /** @type {CrossfeedState} */
  const st = {
    gate: cfg.mode === "off" ? "0" : "1",
    impl: cfg.mode === "off" ? "bauer" : cfg.mode,
    ...cfg.bauer,
    ...cfg.structural,
  };
  /** @type {Record<CrossfeedKey, string | number>} */
  const fields = st; // the same object, written field by field
  const ids = /** @type {[CrossfeedKey, string][]} */ (Object.entries(ID));
  for (const [k, id] of ids) ctx.init(id, st[k]);
  const mode = () => (st.gate === "1" ? st.impl : "off");
  ctx.init("xfmode", mode()); // what runs: off | bauer | structural (main.js reads it on Apply)
  // The controls, lines and picture hosts are assigned below, before anything paints.
  const v = /** @type {View} */ ({
    host,
    cfg,
    st,
    env: { iir2fir: "0", mxWhy: "" },
    set: (/** @type {CrossfeedKey} */ k, /** @type {string | number} */ val) => {
      fields[k] = val;
      ctx.set(ID[k], val);
      if (k === "gate" || k === "impl") ctx.set("xfmode", mode());
    },
  });
  Object.assign(v, controls(v));
  v.lines = buildLines(v);
  Object.assign(v, pictureHosts());
  host.append(
    h("div.xgate", {}, h("b", { text: "Crossfeed" }), v.gateSeg, v.reason.el),
    h(
      "div.chlist.xlist",
      { role: "radiogroup", "aria-label": "Crossfeed implementation" },
      v.lines.map((l) => l.el),
    ),
    v.plotHost,
    v.diagHost,
  );
  v.rp = mountRespPlot(v.plotHost, { lo: -15, hi: 3, step: 3, aria: "Bauer crossfeed response" });

  // Discard (mock): the staged values go back; the picture follows.
  ctx.onDiscard((b) => {
    for (const [k, id] of ids) fields[k] = ["gate", "impl", "preset"].includes(k) ? b[id] : Number(b[id]);
    paintAll(v);
  });

  ctx.watch((vals) => {
    v.env.iir2fir = vals.mxiir2fir ?? "0";
    v.env.mxWhy = bypassed(vals);
    gray(v);
  });

  paintAll(v);
  return { mode, state: st };
}

// ── Controls ──────────────────────────────────────────────────────────

/**
 * The gate, Bauer's and Structural's controls, in mount order.
 *
 * @param {View} v
 * @returns {Pick<View, 'gateSeg'> & ReturnType<typeof bauerControls> & ReturnType<typeof structuralControls>}
 */
function controls(v) {
  const { st } = v;
  const gateSeg = seg({
    aria: "Crossfeed",
    value: st.gate,
    options: ENGAGE_BYPASS, // default leftmost
    onChange: (/** @type {string} */ x) => {
      v.set("gate", x);
      paintAll(v);
    },
  });
  return { gateSeg, ...bauerControls(v), ...structuralControls(v) };
}

/**
 * Slider + number box, one value (v1 SliderNumber): drag streams the picture, release stages. mul = shown per stored unit.
 *
 * @param {View} v
 * @param {{ k: NumericKey, label: string, min: number, max: number, step: number, unit: string, dp: number,
 *   sub?: (v: number) => string, mul?: number }} spec
 * @returns {Slider}
 */
export function slider(v, { k, label, min, max, step, unit, dp, sub, mul = 1 }) {
  const range = /** @type {HTMLInputElement} */ (h("input", { type: "range", min, max, step, "aria-label": label }));
  const { el: num, input: box } = numBox({ min, max, step, aria: label, unit });
  const subEl = sub && h("span.h", {}); // e.g. the radius the model works from, beside the label
  const show = (/** @type {number} */ x) => {
    range.value = String(x);
    box.value = Number(x).toFixed(dp);
    if (subEl) subEl.textContent = sub(x);
  };
  const paint = () => show(v.st[k] * mul);
  range.addEventListener("input", () => {
    v.st[k] = Number(range.value) / mul;
    show(Number(range.value));
    picture(v);
    paintPreset(v);
  });
  const commit = (/** @type {number} */ x) => {
    v.set(k, Math.max(min, Math.min(max, x)) / mul);
    paintAll(v);
  };
  range.addEventListener("change", () => commit(Number(range.value)));
  box.addEventListener("change", () => commit(Number(box.value)));
  const el = h("div.xsl", {}, h("span.cl", {}, label, subEl), range, num);
  return { el, paint };
}

// ── Lines ─────────────────────────────────────────────────────────────

/**
 * The Bauer and Structural lines, each with its controls and copy.
 *
 * @param {View} v
 */
function buildLines(v) {
  const M = v.cfg.man;
  return [
    line(v, {
      val: "bauer",
      label: "Bauer",
      ctl: [
        h("div.ci", {}, h("span.cl", { text: "Preset" }), v.presetSeg),
        v.custom,
        h("div.ci", {}, v.comp.el, v.tilt, h("span.cap", { text: M.compScale })),
      ],
      copy: paras([
        [undefined, M.bauer],
        ["Preset", M.preset],
        ["Frequency", M.freq],
        ["Level", M.level],
        ["Crossfeed compensation", M.comp],
      ]),
    }),
    line(v, {
      val: "structural",
      label: "Structural",
      ctl: [
        h("div.ci", {}, h("span.cl", { text: "Preset" }), v.sPreset),
        v.angle.el,
        v.circ.el,
        v.lambda.el,
        v.conflict,
      ],
      copy: paras([
        ["Speaker angle", M.angle],
        ["Head circumference", M.circ],
        ["Center character", M.lambda],
      ]),
    }),
  ];
}

/** @param {[string | undefined, string][]} list */
const paras = (list) =>
  h(
    "div.man",
    {},
    list.map(([k, text]) => manPara({ k, text })),
  );

/**
 * One implementation line: radio, name, folded summary, controls and copy.
 *
 * @param {View} v
 * @param {{ val: string, label: string, ctl: HTMLElement[], copy: HTMLElement }} spec
 * @returns {Line}
 */
function line(v, { val, label, ctl, copy }) {
  const radio = h("button.radio", {
    type: "button",
    role: "radio",
    "aria-label": label,
    on: { click: () => pick(v, val) },
  });
  const sum = h("span.xsum");
  const body = h("div.xctl", {}, ctl);
  const el = h(
    "div.chline.xline",
    { data: { v: val } },
    h(
      "div.xleft",
      {},
      h("div.chl", {}, radio, h("span.chn", { on: { click: () => pick(v, val) } }, h("b", { text: label })), sum),
      body,
    ),
    copy,
  );
  return { v: val, el, radio, sum, body, copy };
}

/**
 * @param {View} v
 * @param {string} val
 */
function pick(v, val) {
  if (val !== v.st.impl) {
    v.set("impl", val);
    paintAll(v);
  }
}

/**
 * The gray reason, the Bauer plot host and the Structural cartoon with its readouts.
 *
 * @returns {Pick<View, 'reason' | 'plotHost' | 'diagram' | 'RO' | 'diagHost'>}
 */
function pictureHosts() {
  const reason = grayReason();
  const plotHost = h("div.eq.xfplot");
  return { reason, plotHost, ...geometryHost() };
}

// ── Paint ─────────────────────────────────────────────────────────────

/**
 * Every control, the folded summaries, the gray state and the picture, from the drawer state.
 *
 * @param {View} v
 */
export function paintAll(v) {
  const { st, cfg, lines } = v;
  select(v.gateSeg, st.gate);
  for (const l of lines) {
    const on = l.v === st.impl;
    l.el.classList.toggle("cur", on);
    l.el.classList.toggle("fold", !on);
    l.radio.setAttribute("aria-checked", String(on));
    l.body.hidden = !on;
    l.copy.hidden = !on;
    l.sum.hidden = on;
  }
  // Folded summaries: what the line would install (engine names / numbers, no new words).
  const b = bauerSummary(st, cfg.presets, BAUER_PRESETS);
  lines[0].sum.textContent = `${b.label} · ${b.fc} Hz · ${minus(b.feed, 1)} dB · ${b.comp}%`;
  const sm = structuralSummary(st, cfg.sPresets, S_TOL);
  lines[1].sum.textContent = `${sm.label || "Custom"} · ${minus(sm.angle, 1)}° · ${minus(sm.circ, 2)} cm · ${sm.lambda}%`;
  select(v.presetSeg, st.preset);
  v.freq.input.value = String(st.freq);
  v.level.input.value = String(st.level);
  v.comp.paint();
  v.angle.paint();
  v.circ.paint();
  v.lambda.paint();
  paintPreset(v);
  gray(v);
  picture(v);
}

/**
 * Gray: matrix bypassed → everything (family reason); crossfeed bypassed → the lines (v1 reason); Custom-only fields.
 *
 * @param {View} v
 */
function gray(v) {
  const { host, env } = v;
  const g = crossfeedGray(v.st, env.mxWhy, env.iir2fir);
  grayBut(host, v.reason.el, g.matrix); // the reason stays legible: it links to the Matrix engine
  // Bypassed here: the implementations' controls gray; the Bauer | Structural pick stays live (a view choice, v1).
  for (const l of v.lines) l.body.classList.toggle("grayed", g.linesGrayed);
  for (const x of host.querySelectorAll("button,input,select")) {
    const field = /** @type {HTMLButtonElement | HTMLInputElement | HTMLSelectElement} */ (x);
    field.disabled = !(x.closest(".cgrp") ? g.custom : x.closest(".xctl") ? g.controls : g.gate);
  }
  v.custom.classList.toggle("grayed", g.customGrayed);
  v.reason.say(env.mxWhy || (g.off ? OFF_REASON : ""));
  v.conflict.hidden = !g.conflict;
}

/** @param {View} v */
function picture(v) {
  const bauer = v.st.impl === "bauer";
  v.plotHost.hidden = !bauer;
  v.diagHost.hidden = bauer;
  if (bauer) drawBauer(v);
  else drawGeometry(v);
}
