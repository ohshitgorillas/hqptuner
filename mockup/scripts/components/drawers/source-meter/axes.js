// Source meter axis labels: tick labels placed along an edge by percentage, shared by the spectrum, the spectrogram,
// its time axis and the level scale.

import { h } from "../../../lib/shell/dom.js";
import { classNames } from "../../../model/shell/format.js";

/**
 * A fraction of the axis as a CSS percentage.
 *
 * @param {number} f
 * @returns {string}
 */
export const pct = (f) => (f * 100).toFixed(2) + "%";

/**
 * Fill `el` with one label per item at its fraction along `prop` ('left' or 'top'), the first and last marked.
 *
 * @param {HTMLElement} el
 * @param {'left' | 'top'} prop
 * @param {{ at: number, text: string }[]} items
 */
export function edgeLabels(el, prop, items) {
  el.replaceChildren(
    ...items.map(({ at, text }, i) =>
      h("span", {
        style: `${prop}:${pct(at)}`,
        class: classNames(i === 0 && "first", i === items.length - 1 && "last"),
        text,
      }),
    ),
  );
}

/**
 * Frequency tick labels in kHz (unit on the 0 tick), plus the source Nyquist as the last label.
 *
 * @param {{ ticks: { khz: number, at: number }[], nyq: { khz: number, at: number } }} ft  model/meter.js freqTicks
 * @param {'x' | 'y'} axis
 */
export function freqLabels(ft, axis) {
  // x: 0 at the left edge, Nyquist at the right. y: Nyquist at the top edge, 0 at the bottom.
  const [prop, lo, hi] = axis === "x" ? ["left", "first", "last"] : ["top", "last", "first"];
  return [
    ...ft.ticks.map((t) =>
      h("span", { style: `${prop}:${pct(t.at)}`, class: t.khz === 0 && lo, text: t.khz ? String(t.khz) : "0 kHz" }),
    ),
    h("span.nyq", {
      class: hi,
      style: `${prop}:${pct(ft.nyq.at)}`,
      title: "Source Nyquist",
      text: `${ft.nyq.khz}${axis === "x" ? " kHz" : ""}`,
    }),
  ];
}
