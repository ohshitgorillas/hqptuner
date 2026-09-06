// The frequency pane: linear frequency from 0 to twice the source rate in every
// state, the source music as a wash below source Nyquist, its images mirrored
// above, the filter magnitude as the accent trace, the stream entering the DAC
// as a dashed edge, and the stream the reader hears as a fill under it. The gap
// between those last two is the DAC's analog reconstruction, and it is the only
// place the pane shows what a high output rate buys: the digital filter kills
// the images to the same depth at every ratio, so the ratios differ after the
// filter or not at all. Both are drawn in every state including no oversampling,
// which is a NOS DAC and the state where the hold's droop and the unfiltered
// images meet the analog filter with nothing in front of them.
//
// Every curve is drawn through `peakColumns`, one column per pixel the page
// reports and the column's peak within it, so a comb finer than the window can
// hold reads as its own envelope instead of beating against the pixel grid;
// the store's grid is dense enough for the peak to be one (math section 5.4).
// The dB scale carries headroom above 0 so a passband overshoot draws as the
// overshoot it is rather than as a flat run along the top of the plot, and the
// Nyquist marks are drawn over the fills so a reference line stays a line.
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
/**
 * The legend, one row per layer the pane draws, in the order they are painted.
 * A fill has no line for the eye to follow, so it carries a swatch in its own
 * colour; the filter is a trace and is named in the accent it is drawn in. A
 * layer the state does not draw takes no row: a legend naming a filter where
 * none exists teaches the reader something untrue.
 */
const LAYERS = [
  { key: "wash", layer: "music", kind: "ghost", swatch: "music", text: "Music" },
  { key: "images", layer: "images", kind: "ghost", swatch: "images", text: "Images" },
  { key: "filter", layer: "filter", kind: "applied", text: "Filter" },
  { key: "analog", layer: "analog", kind: "ghost", text: "Analog reconstruction" },
  { key: "heard", layer: "output", kind: "applied", swatch: "output", text: "What you hear" },
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
/**
 * One legend entry's width: the longest name plus the next entry's swatch.
 * Analog reconstruction is the long one and measures 111 units in the rendered
 * pane, so the step has to clear that and the swatch after it. Five entries at
 * 125 end at x 655, inside the plot's right edge at 764.
 */
const LEGEND_STEP = 125;
/** A mark's name sits at the top of its own dashed line, under the legend band. */
const MARK_Y = TOP + 10;
/** A name this close to a frame edge is anchored to it rather than centred over it. */
const MARK_EDGE = 40;
/** The top of hearing, marked in every state. */
const HEARING_HZ = 22000;
/**
 * Two centred mark names this close together overlap, so the second drops to
 * the row below rather than printing over the first. The pairs that need it are
 * Hearing limit against the source Nyquist at 44.1 kHz, 0.4 units apart, and
 * against the output Nyquist wherever the ladder floors at 48 kHz, 3.9 and 7.7
 * units apart.
 */
const NAME_GAP = 90;
const NAME_ROW = 11;

/**
 * The pane's curves from the store's spectrum on its grid from 0 to the axis
 * top: the source and its images, the filter, and the output stream. Each is
 * reduced to the columns the page gives the pane, or to the pane's own drawing
 * width where the page has measured nothing.
 */
function frequency() {
  const { freqsHz, sourceDb, filterDb, resultDb, heardDb } = spectrum.value;
  const fs = rate.value;
  const top = axisHz.value;
  const out = outputRate.value;
  const columns = freqPx.value || PLOT_W;
  const xOf = (/** @type {number} */ f) => PADL + (f / top) * PLOT_W;
  const yOf = (/** @type {number} */ db) => TOP + ((DB_MAX - clamp(db, DB_MIN, DB_MAX)) / (DB_MAX - DB_MIN)) * PLOT_HH;
  const pt = (/** @type {number} */ i, /** @type {number} */ db) => `${r1(xOf(freqsHz[i]))},${r1(yOf(db))}`;
  const drawn = (/** @type {Float64Array} */ at, /** @type {number} */ from, /** @type {number} */ to) =>
    peakColumns(at, from, to, columns);
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
  // Where the axis stops at the source's own Nyquist, as it does when the chain
  // decimates, the grid holds no frequency above it and the image band is empty.
  const above = freqsHz.findIndex((/** @type {number} */ f) => f > fs / 2);
  const half = above < 0 ? freqsHz.length : above;
  const step = niceStep(top / 1000 / FREQ_TICKS) * 1000;
  // The store's one identity rule, no oversampling or a ratio of one: no filter
  // and no output Nyquist mark. The heard stream is drawn here as everywhere.
  const identity = noFilter.value;
  return {
    wash: fillOf(sourceDb, 0, half),
    images: fillOf(sourceDb, half, freqsHz.length),
    // The stream entering the DAC, drawn as an edge with no fill of its own:
    // what the reader is meant to read is the space between it and the heard
    // stream under it, which is what the analog reconstruction took away.
    analog: drawn(resultDb, 0, freqsHz.length)
      .map((i) => pt(i, resultDb[i]))
      .join(" "),
    // The heard stream runs the whole axis, the identity included. Above the
    // output's Nyquist sit the images the DAC's hold puts there, and pulling
    // those down is the stage's whole visible job; a fill stopping at the mark
    // would cut the lesson off at its edge.
    heard: filled(heardDb, 0, freqsHz.length),
    filter: identity
      ? null
      : drawn(filterDb, 0, freqsHz.length)
          .map((i) => pt(i, filterDb[i]))
          .join(" "),
    xMarks: ticks(step, top, step).map((f) => ({ x: xOf(f), label: fmtKhz(f) })),
    yMarks: ticks(0, -DB_MIN, DB_STEP).map((db) => ({ y: yOf(-db), label: `${-db}` })),
    // The hearing limit is marked in every state and carries no axis figure: at
    // 44.1 kHz it sits 50 Hz from the source Nyquist, and two numbers that close
    // together on the axis read as one smudged number. The output's own mark is
    // drawn only while its Nyquist is inside the frame; from a 4x ratio up the
    // axis top has passed it, and a mark placed off the plot is a line painted
    // on the frame edge or outside the viewBox altogether.
    marks: [
      { mark: "hearing", x: xOf(HEARING_HZ), hz: null, name: "Hearing limit" },
      { mark: "source", x: xOf(fs / 2), hz: fs / 2, name: "Source Nyquist" },
      ...(identity || out === null || out / 2 >= top
        ? []
        : [{ mark: "output", x: xOf(out / 2), hz: out / 2, name: "Output Nyquist" }]),
    ],
  };
}

/**
 * The rows the legend carries in this state: one per layer the pane drew, in
 * painting order.
 * @param {Record<string, unknown>} drawn
 */
const legend = (drawn) => LAYERS.filter(({ key }) => drawn[key] !== null);

/**
 * A mark name's anchor. A mark on the axis top sits on the right frame edge and
 * one at DC on the left, so a centred name would hang outside the plot.
 * @param {number} x
 */
const markAnchor = (x) => (x > PADL + PLOT_W - MARK_EDGE ? "end" : x < PADL + MARK_EDGE ? "start" : "middle");

/**
 * A y for each mark's name, in the order the marks are given: a name that would
 * land within a name's width of one already placed on a row drops to the row
 * beneath it, so two marks a few units apart read as two lines rather than one
 * smudge. The rows grow downward into the plot, where the top of the band is
 * clear in every state.
 * @param {{ x: number }[]} at
 * @returns {number[]}
 */
function nameRows(at) {
  // Every x already on a row, not just the last: a row holding 72 and then 213
  // still has no space at 76, and comparing against the latest alone would put
  // the third name back on top of the first.
  /** @type {number[][]} */
  const taken = [];
  return at.map(({ x }) => {
    let row = 0;
    while ((taken[row] ?? []).some((seen) => Math.abs(x - seen) < NAME_GAP)) row += 1;
    (taken[row] ??= []).push(x);
    return MARK_Y + row * NAME_ROW;
  });
}

/** The frequency pane: source wash, images, filter trace, Nyquist marks and the output fill. */
export function FrequencyPane() {
  const svg = useRef(/** @type {SVGSVGElement | null} */ (null));
  useMeasuredPlot(svg, freqPx, PLOT_W / W);
  const { wash, images, analog, heard, filter, xMarks, yMarks, marks } = frequency();
  const rows = legend({ wash, images, analog, heard, filter });
  const nameY = nameRows(marks);
  return html`
    <div class="plot" data-pane="frequency">
      <div class="t-label">Frequency</div>
      <svg ref=${svg} viewBox="0 0 ${W} ${H}" class="plot-svg">
        ${yMarks.map((m) => html`<line class="plot-grid" x1=${PADL} y1=${r1(m.y)} x2=${W - PADR} y2=${r1(m.y)} />`)}
        ${yAxis(PADL, yMarks, "dB")}
        ${wash ? html`<path class="primer-wash" d=${wash} />` : null}
        ${images ? html`<path class="primer-images" d=${images} />` : null}
        ${heard ? html`<path class="primer-leak" d=${heard.fill} /><polyline class="primer-leak-edge" points=${heard.edge} />` : null}
        ${analog ? html`<polyline class="primer-predac" points=${analog} />` : null}
        ${marks.map(({ mark, x, hz }) => {
          const sx = r1(x);
          return html`
            <line class="primer-nyquist" data-mark=${mark} x1=${sx} y1=${TOP} x2=${sx} y2=${TOP + PLOT_HH} />
            ${
              hz === null
                ? null
                : html`<text class="plot-lbl plot-axis" x=${sx} y=${AXIS_Y} text-anchor="middle">${fmtKhz(hz)}k</text>`
            }
          `;
        })}
        ${filter ? html`<polyline class="plot-trace applied" points=${filter} />` : null}
        ${xAxis(W, xMarks, "kHz")}
        ${marks.map(({ mark, x, name }, i) =>
          cornerNames([{ kind: "ghost", mark, text: name }], { x, y: nameY[i], anchor: markAnchor(x) }),
        )}
        ${cornerNames(rows, { x: LEGEND_X, y: LEGEND_Y, anchor: "start", dx: LEGEND_STEP })}
      </svg>
    </div>
  `;
}
