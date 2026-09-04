// The frequency pane: linear frequency from 0 to the larger of twice the
// source rate and the output rate, the source music as a wash below source
// Nyquist, the copies the resampling makes as the images layer, the filter
// magnitude as the accent trace, and the leak as the accent fill. Upsampling
// puts the copies above source Nyquist as dimmer fills and what survives the
// filter there is the leak. Decimation folds the source's own top band down
// under the music, so the copy is drawn in the passband as the dashed ghost
// every other pane uses, its edge alone, the picture before the filter; what
// survives of it is a hair at the output Nyquist for any deep design and is
// read off the filter trace over the copy, not painted as a fill of its own.
// The music itself is never painted in accent: on a power sum the output below
// source Nyquist is the music to a hundredth of a decibel, and a fill of it
// buried the wash under one slab. No oversampling draws no filter and no fill:
// the output is the source's own curve.
//
// Every curve is drawn through `peakColumns`, one column per pixel the page
// reports and the column's peak within it, so a comb finer than the window can
// hold reads as its own envelope instead of beating against the pixel grid;
// the store's grid is dense enough for the peak to be one (math section 5.4).
// The dB scale carries headroom above 0 so a passband overshoot draws as the
// overshoot it is rather than as a flat run along the top of the plot, and the
// marks are drawn over the fills so a reference line stays a line.
import { useRef } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { clamp } from "../../lib/coerce.js";
import { peakColumns } from "../../lib/dsp/render.js";
import { axisHz, freqPx, noFilter, outputRate, rate, spectrum } from "../../store/primergraph.js";
import {
  AXIS_Y,
  FULL_W as W,
  H,
  PADR,
  PADT,
  PLOT_H,
  cornerNames,
  fmtKhz,
  niceStep,
  r1,
  ticks,
  xAxis,
  yAxis,
} from "./frame.js";
import { useMeasuredPlot } from "./measure.js";

const PADL = 30;
const PLOT_W = W - PADL - PADR;
const DB_MIN = -120;
/** Headroom over unity: the passband ripple of a short filter lives up here. */
const DB_MAX = 6;
const DB_STEP = 30;
// Frequency ticks across the axis, at most; the step rounds up to a round figure.
const FREQ_TICKS = 8;
/** The ear's limit, marked at every rate so the wash above it reads as what it is. */
const HEARING_HZ = 22000;
/**
 * The legend, one row per layer the pane draws, in the order they are painted.
 * A fill has no line for the eye to follow, so it carries a swatch in its own
 * colour; the filter is a trace and is named in the accent it is drawn in. A
 * layer the state does not draw takes no row: a legend naming a filter where
 * none exists teaches the reader something untrue. The images row drops its
 * swatch where the copy is a line rather than a fill.
 */
const LAYERS = [
  { key: "wash", layer: "music", kind: "ghost", swatch: "music", text: "Music" },
  { key: "images", layer: "images", kind: "ghost", swatch: "images", text: "Images" },
  { key: "filter", layer: "filter", kind: "applied", text: "Filter" },
  { key: "leak", layer: "output", kind: "applied", swatch: "output", text: "Output" },
];
/**
 * The legend gets a band of its own between the top band and the plot, and the
 * plot gives up its height rather than the pane growing, so the bottom edge and
 * its labels stay where the shared frame puts them. There is no clear space
 * inside the plot to put it in: every fill closes to the floor, so a corner
 * stack of four rows lands on the wash whichever corner it picks.
 */
const BAND = 15;
const TOP = PADT + BAND;
const PLOT_HH = PLOT_H - BAND;
const LEGEND_X = PADL;
const LEGEND_Y = PADT + 10;
/** One legend entry's width: the longest of the four words plus its swatch. */
const LEGEND_STEP = 92;
/** A mark's name sits at the top of its own dashed line, under the legend band. */
const MARK_Y = TOP + 10;
/**
 * The hearing mark's name takes a rung of its own under the Nyquist names: at
 * 44.1 kHz it stands 50 Hz from source Nyquist and the two would land on each
 * other. It carries no axis number for the same reason, the 20 kHz tick beside it.
 */
const RUNG = 12;
/** A name this close to a frame edge is anchored to it rather than centred over it. */
const MARK_EDGE = 40;

/**
 * What the chain does: nothing (the store's identity rule, no oversampling or a
 * ratio of one), upsampling, or decimation.
 * @param {boolean} identity
 * @param {number | null} out
 * @param {number} fs
 * @returns {"identity" | "up" | "down"}
 */
const chainMode = (identity, out, fs) => (identity ? "identity" : out !== null && out < fs ? "down" : "up");

/**
 * Where on the grid each band begins and ends. `half` is the first point above
 * source Nyquist: where the axis stops at the source's own Nyquist, as it does
 * when the chain decimates, the grid holds no frequency above it and the image
 * band is empty. `carried` is the first point at or above the output's Nyquist:
 * above it the fold repeats the band below, a copy of what is already drawn
 * that no stream carries, and on the mark itself the only copy that lands is
 * the frequency's own, so the alias reading there is the floor and a curve
 * drawn to it would end in a drop down the mark; the copy stops short of it.
 * @param {number[]} freqsHz
 * @param {number} fs
 * @param {number} out
 */
function bands(freqsHz, fs, out) {
  const above = freqsHz.findIndex((f) => f > fs / 2);
  const atOut = freqsHz.findIndex((f) => f >= out / 2);
  return { half: above < 0 ? freqsHz.length : above, carried: atOut < 0 ? freqsHz.length : atOut };
}

/**
 * The pane's curves from the store's spectrum on its grid from 0 to the axis
 * top: the source and its copies, the filter, and the leak. Each is reduced to
 * the columns the page gives the pane, or to the pane's own drawing width
 * where the page has measured nothing.
 */
function frequency() {
  const { freqsHz, sourceDb, filterDb, resultDb, aliasDb } = spectrum.value;
  const fs = rate.value;
  const top = axisHz.value;
  const out = outputRate.value;
  const mode = chainMode(noFilter.value, out, fs);
  const { half, carried } = bands(freqsHz, fs, out ?? fs);
  const columns = freqPx.value || PLOT_W;
  const xOf = (/** @type {number} */ f) => PADL + (f / top) * PLOT_W;
  const yOf = (/** @type {number} */ db) => TOP + ((DB_MAX - clamp(db, DB_MIN, DB_MAX)) / (DB_MAX - DB_MIN)) * PLOT_HH;
  const pt = (/** @type {number} */ i, /** @type {number} */ db) => `${r1(xOf(freqsHz[i]))},${r1(yOf(db))}`;
  const drawn = (/** @type {Float64Array} */ at, /** @type {number} */ from, /** @type {number} */ to) =>
    peakColumns(at, from, to, columns);
  const curve = (/** @type {Float64Array} */ at, /** @type {number} */ from, /** @type {number} */ to) =>
    drawn(at, from, to).map((i) => pt(i, at[i]));
  // A fill closes to the floor at its two ends; its edge is the curve alone,
  // the same vertices without the two feet, so a stroke on it never outlines
  // the floor or the frame edge.
  const filled = (/** @type {Float64Array} */ at, /** @type {number} */ from, /** @type {number} */ to) => {
    const keep = drawn(at, from, to);
    if (keep.length === 0) return null;
    const pts = keep.map((i) => pt(i, at[i]));
    const foot = (/** @type {number} */ i) => `${r1(xOf(freqsHz[i]))},${r1(yOf(DB_MIN))}`;
    return { fill: `M${foot(keep[0])} L${pts.join(" L")} L${foot(keep[keep.length - 1])} Z`, edge: pts.join(" ") };
  };
  const fillOf = (/** @type {Float64Array} */ at, /** @type {number} */ from, /** @type {number} */ to) =>
    filled(at, from, to)?.fill ?? null;
  const step = niceStep(top / 1000 / FREQ_TICKS) * 1000;
  return {
    mode,
    wash: fillOf(sourceDb, 0, half),
    // Upsampling: the copies above source Nyquist, as fills. Decimation: the
    // copy folded down under the music, as an open curve from DC to the
    // output Nyquist.
    images: mode === "down" ? `M${curve(aliasDb, 0, carried).join(" L")}` : fillOf(sourceDb, half, freqsHz.length),
    leak: mode === "up" ? filled(resultDb, half, freqsHz.length) : null,
    filter: mode === "identity" ? null : curve(filterDb, 0, freqsHz.length).join(" "),
    xMarks: ticks(step, top, step).map((f) => ({ x: xOf(f), label: fmtKhz(f) })),
    yMarks: ticks(0, -DB_MIN, DB_STEP).map((db) => ({ y: yOf(-db), label: `${-db}` })),
    marks: marksOf(fs, mode === "identity" ? null : out, xOf),
  };
}

/**
 * The dashed marks: the source's Nyquist always, the output's where there is an
 * output stream, each with its rate on the axis; and the hearing limit, named
 * on its own rung with no axis number.
 * @param {number} fs
 * @param {number | null} out
 * @param {(f: number) => number} xOf
 */
function marksOf(fs, out, xOf) {
  /** @type {{ mark: string, x: number, axis: string | null, name: string, y: number }[]} */
  const marks = [{ mark: "source", x: xOf(fs / 2), axis: fmtKhz(fs / 2), name: "Source Nyquist", y: MARK_Y }];
  if (out !== null)
    marks.push({ mark: "output", x: xOf(out / 2), axis: fmtKhz(out / 2), name: "Output Nyquist", y: MARK_Y });
  marks.push({ mark: "audible", x: xOf(HEARING_HZ), axis: null, name: "Hearing limit", y: MARK_Y + RUNG });
  return marks;
}

/**
 * The rows the legend carries in this state: one per layer the pane drew, in
 * painting order; the images row without its swatch where the copy is a line.
 * @param {Record<string, unknown>} drawn
 * @param {boolean} copyIsLine
 */
const legend = (drawn, copyIsLine) =>
  LAYERS.filter(({ key }) => drawn[key] !== null).map((row) =>
    copyIsLine && row.key === "images" ? { ...row, swatch: undefined } : row,
  );

/**
 * A mark name's anchor. A mark on the axis top sits on the right frame edge and
 * one at DC on the left, so a centred name would hang outside the plot.
 * @param {number} x
 */
const markAnchor = (x) => (x > PADL + PLOT_W - MARK_EDGE ? "end" : x < PADL + MARK_EDGE ? "start" : "middle");

/** The frequency pane: source wash, images, filter trace, the marks and the leak fill. */
export function FrequencyPane() {
  const svg = useRef(/** @type {SVGSVGElement | null} */ (null));
  useMeasuredPlot(svg, freqPx, PLOT_W / W);
  const { mode, wash, images, leak, filter, xMarks, yMarks, marks } = frequency();
  const copyIsLine = mode === "down";
  const rows = legend({ wash, images, leak, filter }, copyIsLine);
  // The copies go under the wash: where decimation folds one into the passband
  // the music stays on top and the copy's dashed edge shows through beneath it.
  return html`
    <div class="plot" data-pane="frequency">
      <div class="t-label">Frequency</div>
      <svg ref=${svg} viewBox="0 0 ${W} ${H}" class="plot-svg">
        ${yMarks.map((m) => html`<line class="plot-grid" x1=${PADL} y1=${r1(m.y)} x2=${W - PADR} y2=${r1(m.y)} />`)}
        ${yAxis(PADL, yMarks, "dB")}
        ${images ? html`<path class="primer-images${copyIsLine ? " primer-copy" : ""}" d=${images} />` : null}
        ${wash ? html`<path class="primer-wash" d=${wash} />` : null}
        ${leak ? html`<path class="primer-leak" d=${leak.fill} /><polyline class="primer-leak-edge" points=${leak.edge} />` : null}
        ${marks.map(({ mark, x, axis }) => {
          const sx = r1(x);
          return html`
            <line class="primer-nyquist" data-mark=${mark} x1=${sx} y1=${TOP} x2=${sx} y2=${TOP + PLOT_HH} />
            ${axis === null ? null : html`<text class="plot-lbl plot-axis" x=${sx} y=${AXIS_Y} text-anchor="middle">${axis}k</text>`}
          `;
        })}
        ${filter ? html`<polyline class="plot-trace applied" points=${filter} />` : null}
        ${xAxis(W, xMarks, "kHz")}
        ${marks.map(({ mark, x, name, y }) => cornerNames([{ kind: "ghost", mark, text: name }], { x, y, anchor: markAnchor(x) }))}
        ${cornerNames(rows, { x: LEGEND_X, y: LEGEND_Y, anchor: "start", dx: LEGEND_STEP })}
      </svg>
    </div>
  `;
}
