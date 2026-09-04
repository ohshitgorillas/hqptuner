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
/** A name row's height, so a stack of them clears itself. */
const NAME_GAP = 11;
/** The side of a legend swatch, and the gap between it and the word it marks. */
const SWATCH = 6;
const SWATCH_GAP = 4;
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
 * A frequency in Hz as a kilohertz tick label, to two decimals with trailing
 * zeros trimmed. Three significant figures would round 176.4 to 176 and 22.05
 * to 22.1, which is every rate of the 44.1 family labelled as one it is not.
 * @param {number} f
 */
export const fmtKhz = (f) => `${Number((f / 1000).toFixed(2))}`;

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
 * The bottom edge: tick labels at their x, then the unit word in the right
 * gutter. A mark may name its own anchor, so a pane whose axis ends on a tick
 * can pull that label inside the frame instead of dropping it.
 * @param {number} w
 * @param {{ x: number, label: string, anchor?: string }[]} marks
 * @param {string} word
 */
export function xAxis(w, marks, word) {
  return html`
    ${marks.map(
      ({ x, label, anchor }) =>
        html`<text class="plot-lbl" x=${r1(x)} y=${LABEL_Y} text-anchor=${anchor || "middle"}>${label}</text>`,
    )}
    <text class="plot-lbl plot-axis" x=${w - PADR + 12} y=${LABEL_Y}>${word}</text>
  `;
}

/**
 * Names, each in its own trace's style: the accent name in `applied`, a
 * reference in `ghost`. A layer that is a fill rather than a trace has no line
 * for the eye to follow, so it may carry a swatch, a small square in its own
 * colour, on the anchor's side of the word.
 *
 * Rows run down the page by default, one `NAME_GAP` apart, which is the shape a
 * corner stack wants; a caller passing `dx` runs them across it instead, which
 * is the shape a band above the plot wants. Every fill in these panes closes to
 * the floor, so a stack placed inside the plot rectangle always lands on paint:
 * names are drawn last and carry their own halo (`primer-name`) so they stay
 * readable where they land, and a legend, which is a block rather than a label
 * on a curve, is given a band of its own instead.
 *
 * @param {{ kind: string, text: string, layer?: string, mark?: string, trace?: string, swatch?: string }[]} rows
 * @param {{ x: number, y: number, anchor: string, dx?: number }} place
 */
export function cornerNames(rows, place) {
  const { x, y, anchor, dx = 0 } = place;
  const back = anchor === "end";
  return rows.map((row, i) => {
    const rx = x + i * dx;
    const ry = y + (dx ? 0 : i * NAME_GAP);
    const offset = row.swatch ? SWATCH + SWATCH_GAP : 0;
    const tx = back ? rx - offset : rx + offset;
    return html`
      ${
        row.swatch
          ? html`<rect
            class=${`primer-swatch ${row.swatch}`}
            x=${r1(back ? rx - SWATCH : rx)}
            y=${r1(ry - SWATCH + 1)}
            width=${SWATCH}
            height=${SWATCH}
          />`
          : null
      }
      <text
        class=${`plot-tlbl primer-name ${row.kind}`}
        data-layer=${row.layer}
        data-mark=${row.mark}
        data-trace=${row.trace}
        x=${r1(tx)}
        y=${r1(ry)}
        text-anchor=${anchor}
      >
        ${row.text}
      </text>
    `;
  });
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
