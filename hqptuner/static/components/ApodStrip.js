// The apodizing-events strip: a chart recorder for how thickly apodizing events
// fall over recent playback, newest at the right edge. It answers a question the
// apodizing counter cannot — a track can log thousands of events in its opening
// bars and ten across everything after, and one running total renders those two
// tracks identically. Engine Health draws it under its counters; the METER page
// draws it above the spectrogram, on the same time axis.
//
// The x axis is milliseconds of playback, drawn as a fixed grid of equal cells
// (gridColumns in lib/apodscale.js) rather than one bar per bin, since the
// daemon's readings cover uneven stretches of playback. Right-aligning against
// the window's own width means a half-filled window fills from the right rather
// than stretching three cells across the card.
import { html } from "../lib/dom.js";
import { CELL_MS, intensity, SAT, gridColumns } from "../lib/apodscale.js";
import { apodStripVisible, apodBins } from "../store/apodhistory.js";
import { apodWindow, setApodWindow } from "../store/ui/prefs.js";
import { Dropdown } from "./controls/index.js";

// The ramp's control points, floor first. Color lives in tokens.css and this
// names it; the blend between two of them is what makes the scale continuous, so
// a column's color is its own reading and not the nearest of six buckets.
//
// --spec-0 is the floor an interval with no events lands on, and it is a painted
// reading rather than an absence: a silent interval between two busy ones is
// part of the field, and an unpainted one would read as a hole in a continuous
// band.
const STOPS = ["--spec-0", "--spec-1", "--spec-2", "--spec-3", "--spec-4", "--spec-5"];

// Interpolated in oklab rather than sRGB: mixing two saturated hues down the
// RGB cube runs them through a muddy middle, and the midpoint of a density
// scale is exactly where the reader is trying to tell two columns apart.
/**
 * @param {number} rate events per second
 * @returns {string} a CSS color anywhere along the ramp
 */
function fillFor(rate) {
  const pos = intensity(rate) * (STOPS.length - 1);
  const seg = Math.min(STOPS.length - 2, Math.floor(pos));
  const t = (pos - seg) * 100;
  return `color-mix(in oklab, var(${STOPS[seg + 1]}) ${t.toFixed(1)}%, var(${STOPS[seg]}))`;
}

// Tick spacing per window, chosen so every window carries five or six divisions
// rather than a count that changes with the span. An axis with no marks on it
// states a total and nothing else: these are what let a burst be placed at "two
// minutes back" instead of "somewhere in the left half".
const TICK_MS = { 30: 10000, 60: 15000, 120: 30000, 300: 60000 };

/**
 * @param {number} span
 * @returns {number} tick interval in milliseconds
 */
function tickFor(span) {
  const fixed = TICK_MS[/** @type {keyof TICK_MS} */ (Math.round(span / 1000))];
  if (fixed) return fixed;
  // A whole-history span is whatever the strip has recorded, so its divisions
  // come off the same ladder rather than a formula nobody can predict.
  if (span <= 60000) return 15000;
  if (span <= 180000) return 30000;
  return 60000;
}

/**
 * How far back the left edge reaches, said in the units the reader picked. The
 * whole-history window is not a duration the reader chose, so it names where the
 * field begins instead of how long ago that was.
 *
 * It does not name a TRACK boundary: on a Roon source the daemon carries one
 * endless stream, whose serial, position and apodizing counter run straight
 * through a change of song, so the history the strip holds began wherever the
 * last boundary the daemon actually reported fell (measured on the wire).
 * @param {number} span
 * @param {string} window
 * @returns {string}
 */
const spanLabel = (span, window) => {
  if (window === "all") return "start";
  return span < 60000 ? `${Math.round(span / 1000)} s ago` : `${Math.round(span / 60000)} min ago`;
};

/**
 * Tick positions as percentages from the left edge, newest-first walk so the
 * marks stay pinned to now and the oldest partial division falls off the left.
 * @param {number} span
 * @returns {number[]}
 */
function tickPercents(span) {
  const step = tickFor(span);
  /** @type {number[]} */
  const out = [];
  for (let t = step; t < span; t += step) out.push((1 - t / span) * 100);
  return out;
}

const WINDOW_OPTIONS = [
  { value: "30", label: "30 s" },
  { value: "60", label: "1 min" },
  { value: "120", label: "2 min" },
  { value: "300", label: "5 min" },
  { value: "all", label: "All" },
];

// The key reads the same ramp the columns do, so the swatches are not an
// approximation of the scale, they are the scale.
/**
 * @typedef {{ x: number, w: number, fill: string }} Column
 */

// Lay the grid cells out along the window, oldest first. EVERY cell is painted,
// including one that counted nothing: this is a field, not a bar chart, and a
// quiet interval is a reading at the bottom of the scale rather than a hole in
// the record.
/**
 * @param {import("../lib/apodscale.js").GridColumn[]} cells
 * @param {number} span total window width, in milliseconds
 * @returns {Column[]}
 */
function layout(cells, span) {
  // A column runs to wherever the next column starts, plus enough to cover the
  // boundary outright. Exact tiling is not enough: two rects that
  // merely share an edge each cover part of the same device pixel, and the
  // compositor lands on 0.24 background + 0.16 left + 0.6 right, so the trough
  // shows through as a dark line down every sample boundary. Painting the left
  // column past the seam means the right one covers it completely and no
  // background survives. Every boundary gets it, since every slot is painted and
  // the field is meant to read as one surface.
  const bleed = span / 300;
  return cells.map((c, i) => ({
    x: c.x,
    w: CELL_MS + (i < cells.length - 1 ? bleed : 0),
    fill: fillFor(c.rate),
  }));
}

// On Engine Health the strip draws nothing until the current track has logged
// an event, and keeps drawing for the rest of playback once it has: what that
// card holds is one section that either has something to report or does not.
// `always` lifts the rule for a page that lays another chart on the strip's
// time axis, where an empty trough is still the axis.
/**
 * Apodizing-event density over the chosen window, scrolling right to left.
 * @param {{ always?: boolean }} props
 */
export const ApodStrip = ({ always = false }) => {
  if (!always && !apodStripVisible.value) return null;
  const window = apodWindow.value;
  const { span, columns } = gridColumns(apodBins.value, window === "all" ? null : Number(window) * 1000);
  return html`
    <div class="eh-strip">
      <div class="eh-strip-head">
        <div class="subhead">Apodizing Events</div>
        <label class="eh-strip-window">
          Time axis
          <${Dropdown} value=${window} options=${WINDOW_OPTIONS} onChange=${setApodWindow} />
        </label>
      </div>
      <div class="eh-strip-trough">
        <svg viewBox=${`0 0 ${span} 100`} preserveAspectRatio="none" role="img" aria-label="Apodizing Events">
          ${layout(columns, span).map(
            (b) => html`<rect class="eh-bar" x=${b.x} y="0" width=${b.w} height="100" style="fill: ${b.fill}" />`,
          )}
        </svg>
      </div>
      <div class="eh-strip-ticks">
        ${tickPercents(span).map((p) => html`<i class="eh-tick" style="left: ${p.toFixed(3)}%"></i>`)}
      </div>
      <div class="eh-strip-scale">
        <span class="eh-scale-end">${spanLabel(span, window)}</span>
        <span class="eh-key">
          events
          <span class="eh-key-label">1</span>
          <i class="eh-key-ramp"></i>
          <span class="eh-key-label">${SAT}+</span>
        </span>
        <span class="eh-scale-end">now</span>
      </div>
    </div>
  `;
};
