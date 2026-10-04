// Crossfeed drawer, Bauer side: Preset, Frequency + Level, Crossfeed compensation, and the response plot under the lines.

import { h } from "../../../lib/shell/dom.js";
import { seg } from "../../controls/seg.js";
import { BAUER_PRESETS, bauerMS, toDb } from "../../../lib/dsp/xdsp.js";
import { numBox } from "../../../lib/controls/controls.js";
import { minus } from "../../../../../hqptuner/static/model/shell/format.js";
import { bauerPlot } from "../../../../../hqptuner/static/model/gauges/crossfeed.js";
import { paintAll, slider } from "../crossfeed.js";

/**
 * @typedef {import("../crossfeed.js").View} View
 * @typedef {import("../crossfeed.js").NumField} NumField
 * @typedef {import("../../controls/resp-plot.js").Trace} Trace
 */

/**
 * Bauer's controls, in mount order.
 *
 * @param {View} v
 * @returns {Pick<View, 'presetSeg' | 'freq' | 'level' | 'custom' | 'comp' | 'tilt'>}
 */
export function bauerControls(v) {
  const { st, cfg } = v;
  const presetSeg = seg({
    aria: "Preset",
    options: cfg.presets,
    value: st.preset,
    onChange: (/** @type {string} */ x) => {
      v.set("preset", x);
      paintAll(v);
    },
  });
  const freq = numField(v, { k: "freq", label: "Frequency", unit: "Hz", step: 1, min: 300, max: 2000 });
  const level = numField(v, { k: "level", label: "Level", unit: "dB", step: 0.1, min: 1, max: 15 });
  const custom = h("div.cgrp", {}, freq.el, level.el);
  const comp = slider(v, { k: "comp", label: "Crossfeed compensation", min: 0, max: 150, step: 1, unit: "%", dp: 0 });
  const tilt = h("span.cap");
  return { presetSeg, freq, level, custom, comp, tilt };
}

/**
 * A labelled number box that stages its value on change.
 *
 * @param {View} v
 * @param {{ k: 'freq' | 'level', label: string, unit: string, step: number, min: number, max: number }} spec
 * @returns {NumField}
 */
function numField(v, { k, label, unit, step, min, max }) {
  const { el, input } = numBox({ step, min, max, aria: label, unit });
  input.addEventListener("change", () => {
    v.set(k, Number(input.value));
    paintAll(v);
  });
  return { input, el: h("label.ci", {}, h("span.cl", { text: label }), el) };
}

/**
 * Bauer's response plot and the compensation readout beside its slider.
 *
 * @param {View} v
 */
export function drawBauer(v) {
  const { fc, feed, k, ghost, pct } = bauerPlot(v.st, BAUER_PRESETS);
  const mid = (/** @type {number} */ f) => toDb(bauerMS(fc, feed, f).mid);
  v.tilt.textContent = `crossfeed dulls the center by ${minus(-mid(20000), 1)} dB`; // v1 Comp.js readout
  /** @type {Trace[]} */
  const ghostTrace = ghost ? [{ cls: "ghost", label: "center, uncorrected", fn: mid }] : [];
  v.rp.draw([
    ...ghostTrace,
    {
      label: ghost ? `center, corrected ${pct}%` : "center, uncorrected",
      fn: (/** @type {number} */ f) => (1 - k) * mid(f),
    },
    { cls: "side", label: "stereo sides", fn: (/** @type {number} */ f) => toDb(bauerMS(fc, feed, f).side) },
  ]);
}
