// The frame the primer's SVG panes share: one height, one top band for the
// y-axis unit word, one right gutter for the x-axis unit word, one tick
// rounding and one number alphabet, so the 9-unit text renders at the same
// size in every pane and no label meets another at a corner
// (docs/plans/filter-primer-graph.md). Each pane picks its width and its left
// gutter: a half-width pane is 400 wide, the full-width one 800, twice the
// units for twice the pixels.
import { html } from "../../lib/dom.js";

/** Half-width pane viewBox width; the full-width pane is twice it. */
export const HALF_W = 400;
export const FULL_W = 800;
export const H = 240;
/** Right gutter: the x-axis unit word sits in it, clear of the last tick label. */
export const PADR = 36;
/** Top band: the y-axis unit word's own row, one text height clear of the first tick label. */
export const PADT = 24;
export const AXIS_Y = 9;
const PADB = 20;
export const PLOT_H = H - PADT - PADB;
/** Baseline of the tick labels and the unit word along the bottom edge. */
const LABEL_Y = H - 6;
/** Half a text height: a y tick label's baseline sits this far under its line. */
const LABEL_DROP = 2.5;

/**
 * One decimal, the SVG coordinate alphabet.
 * @param {number} v
 */
export const r1 = (v) => v.toFixed(1);

/**
 * Three significant figures, trailing zeros trimmed.
 * @param {number} v
 */
export const fmt3 = (v) => `${Number(v.toPrecision(3))}`;

/**
 * A frequency in Hz as a kilohertz tick label.
 * @param {number} f
 */
export const fmtKhz = (f) => fmt3(f / 1000);

/**
 * A round tick step at or above the raw one: 1, 2, 5 or 10 times a power of ten.
 * @param {number} raw
 * @returns {number}
 */
export function niceStep(raw) {
  const mag = 10 ** Math.floor(Math.log10(raw));
  const m = raw / mag;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * mag;
}

/**
 * Tick values from `from` to `to` inclusive at `step`, counted rather than
 * accumulated so a decimal step lands on its round figures.
 * @param {number} from
 * @param {number} to
 * @param {number} step
 * @returns {number[]}
 */
export function ticks(from, to, step) {
  /** @type {number[]} */
  const out = [];
  for (let k = 0; from + k * step <= to * (1 + 1e-9); k += 1) out.push(from + k * step);
  return out;
}

/**
 * The bottom edge: tick labels at their x, then the unit word in the right gutter.
 * @param {number} w
 * @param {{ x: number, label: string }[]} marks
 * @param {string} word
 */
export function xAxis(w, marks, word) {
  return html`
    ${marks.map(({ x, label }) => html`<text class="plot-lbl" x=${r1(x)} y=${LABEL_Y} text-anchor="middle">${label}</text>`)}
    <text class="plot-lbl plot-axis" x=${w - PADR + 12} y=${LABEL_Y}>${word}</text>
  `;
}

/**
 * The left edge: tick labels at their y, then the unit word in the top band.
 * @param {number} padl
 * @param {{ y: number, label: string }[]} marks
 * @param {string} word
 */
export function yAxis(padl, marks, word) {
  return html`
    ${marks.map(({ y, label }) => html`<text class="plot-lbl" x=${padl - 4} y=${r1(y + LABEL_DROP)} text-anchor="end">${label}</text>`)}
    <text class="plot-lbl plot-axis" x=${padl - 4} y=${AXIS_Y} text-anchor="end">${word}</text>
  `;
}
