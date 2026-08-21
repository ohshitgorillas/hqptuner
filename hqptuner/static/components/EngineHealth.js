// Engine-health meter cluster — the System tab's full-width live card. A
// VU-style needle gauge for process speed (the scale is piecewise-linear
// across hand-picked ticks so the 1.00–1.05× danger region gets the angular
// resolution; past 4× the needle just pegs, like a real VU), bar meters for
// the input/output buffer fill, and flat counters for clips / apodizing
// events (per-track deltas from store/health.js, totals muted beside).
// All values are playback-time readings — idle dims the cluster and parks
// the needle. Data is the same Status poll the alert strip uses — 2 s on the
// System tab unless quick updates is ticked, 1 s on LIVE always; the
// needle's CSS transform transition gives it damped-ballistics sweep
// between polls.
import { html } from "../lib/dom.js";
import { engineStatus } from "../store/signals.js";
import { trackCounters, outputBufferApplies } from "../store/health.js";
import { apodStripVisible, apodVisibleBins } from "../store/apodhistory.js";
import { quickSystemUpdates, setQuickSystemUpdates, apodWindow, setApodWindow } from "../store/prefs.js";
import { Checkbox, Dropdown } from "./controls/index.js";

/**
 * @typedef {string | number | null | undefined} StatusValue
 *   One field off the Status frame as the poll delivers it — numbers on the
 *   wire arrive as strings, and an absent field as undefined.
 * @typedef {number | null} Reading
 *   A playback-time reading, or null for "nothing to show" (idle, absent or
 *   not applicable).
 */

const TICKS = [0.5, 0.8, 1.0, 1.05, 1.2, 1.5, 2, 4];
const A0 = -60;
const A1 = 60;
const SEG = (A1 - A0) / (TICKS.length - 1);

// value -> needle angle: equal angular spacing per tick interval, linear
// within one, clamped (pegged) at both ends.
/**
 * @param {Reading} v
 * @returns {number}
 */
function angleFor(v) {
  if (v === null || v <= TICKS[0]) return A0;
  if (v >= TICKS[TICKS.length - 1]) return A1;
  for (let i = 0; i < TICKS.length - 1; i++) {
    if (v <= TICKS[i + 1]) return A0 + SEG * (i + (v - TICKS[i]) / (TICKS[i + 1] - TICKS[i]));
  }
  return A1;
}

const CX = 110;
const CY = 112;
const rad = (/** @type {number} */ deg) => (deg * Math.PI) / 180;
const px = (/** @type {number} */ a, /** @type {number} */ r) => CX + r * Math.sin(rad(a));
const py = (/** @type {number} */ a, /** @type {number} */ r) => CY - r * Math.cos(rad(a));
const arc = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ r) =>
  `M ${px(a, r)} ${py(a, r)} A ${r} ${r} 0 0 1 ${px(b, r)} ${py(b, r)}`;

// zone arcs: red up to 1.00×, amber to 1.05×, neutral above
const ZONES = [
  { from: A0, to: angleFor(1.0), cls: "vu-zone-crit" },
  { from: angleFor(1.0), to: angleFor(1.05), cls: "vu-zone-warn" },
  { from: angleFor(1.05), to: A1, cls: "vu-zone-ok" },
];

/** @param {{ speed: Reading }} props */
const VuGauge = ({ speed }) => html`
  <div class="vu">
    <svg viewBox="0 0 220 132" role="img" aria-label="Process speed gauge">
      ${ZONES.map((z) => html`<path class=${z.cls} d=${arc(z.from, z.to, 92)} />`)}
      ${TICKS.map((t, i) => {
        const a = A0 + SEG * i;
        return html`
          <line class="vu-tick" x1=${px(a, 82)} y1=${py(a, 82)} x2=${px(a, 90)} y2=${py(a, 90)} />
          <text class="vu-label" x=${px(a, 74)} y=${py(a, 74)} text-anchor="middle" dominant-baseline="middle">
            ${t}
          </text>
        `;
      })}
      <line
        class="vu-needle"
        x1=${CX}
        y1=${CY}
        x2=${CX}
        y2=${CY - 84}
        style="transform: rotate(${angleFor(speed)}deg); transform-origin: ${CX}px ${CY}px"
      />
      <circle class="vu-hub" cx=${CX} cy=${CY} r="5" />
    </svg>
    <div class="vu-readout">${speed === null ? "—" : `${speed.toFixed(2)}×`}</div>
    <div class="vu-caption">process speed</div>
  </div>
`;

/** @param {{ label: string, frac: Reading }} props */
const Meter = ({ label, frac }) => html`
  <div class="meter-row">
    <span class="meter-label">${label}</span>
    <span class="meter-lg ${frac !== null && frac < 0.15 ? "low" : ""}">
      <span class="meter-fill" style="width: ${frac === null ? 0 : Math.round(frac * 100)}%"></span>
      <span class="meter-tick" style="left: 25%"></span>
      <span class="meter-tick" style="left: 50%"></span>
      <span class="meter-tick" style="left: 75%"></span>
    </span>
    <span class="meter-val">${frac === null ? "—" : `${Math.round(frac * 100)}%`}</span>
  </div>
`;

/** @param {{ label: string, delta: Reading, total: Reading, alert: boolean }} props */
const Counter = ({ label, delta, total, alert }) => html`
  <div class="eh-counter ${alert ? "alert" : ""}">
    <span class="eh-counter-label">${label}</span>
    <span class="eh-counter-val">${delta === null ? "—" : delta}</span>
    <span class="eh-counter-total">${total === null ? "this track" : `this track · ${total} total`}</span>
  </div>
`;

// The apodizing-events strip: a chart recorder for how thickly apodizing events
// fall over recent playback, newest at the right edge. It answers a question the
// counter beside it cannot — a track can log thousands of events in its opening
// bars and ten across everything after, and one running total renders those two
// tracks identically.
//
// The x axis is milliseconds, not bin index. Bins are recorded at whatever poll
// cadence was in force (store/apodhistory.js), so a run that spans a change of
// cadence would draw its slower bins too narrow if each got an equal slot. A
// viewBox measured in milliseconds sizes every bar by the interval it actually
// observed, and right-aligning against the window's own width means a
// half-filled window fills from the right rather than stretching three bins
// across the card.
//
// Density is a RATE, not a count: events per second, taken over the interval the
// bin actually observed. A bin covers 1 s in LIVE and 2 s elsewhere, so scoring
// the raw count would paint the same music half as hot on the page that polls
// faster, and a run that changed cadence mid-track would step to a different
// color with no change in what the engine did.
/**
 * @param {{ ms: number, n: number }} bin
 * @returns {number} events per second
 */
const rateOf = (bin) => (bin.ms > 0 ? (bin.n * 1000) / bin.ms : 0);

// Intensity is logarithmic and saturates at SAT, carried by color over a
// full-height column rather than by the column's height: this is a spectrogram,
// and density reads as color temperature. Fixed reference, so a column never
// changes retroactively when a denser passage arrives.
//
// SAT is set from what the engine actually produces rather than a round number:
// measured live, ordinary playback on an apodizing filter runs about 2.5 to 12.5
// events per second. Saturating at 30 puts ordinary listening across the lower
// middle of the ramp, which is what stops routine playback reading as one
// undifferentiated hot band, and leaves a genuine burst somewhere to climb.
const SAT = 30;
const LOG_SPAN = Math.log10(SAT + 1);

/** @param {number} rate @returns {number} 0..1 */
const intensity = (rate) => Math.min(1, Math.log10(rate + 1) / LOG_SPAN);

// The ramp's control points, floor first. Color lives in tokens.css and this
// names it; the blend between two of them is what makes the scale continuous, so
// a column's color is its own reading and not the nearest of six buckets.
//
// --spec-0 is the floor an interval with no events lands on, and it is a painted
// reading rather than an absence: a silent interval between two busy ones is
// part of the field, and leaving it unpainted punched a hole in a continuous
// band every time the counter and the poll clock aliased.
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
  // A whole-track span is whatever the track has run to, so its divisions come
  // off the same ladder rather than a formula nobody can predict.
  if (span <= 60000) return 15000;
  if (span <= 180000) return 30000;
  return 60000;
}

/**
 * How far back the left edge reaches, said in the units the reader picked. The
 * whole-track window is not a duration the reader chose, so it names where the
 * field begins instead of how long ago that was.
 * @param {number} span
 * @param {string} window
 * @returns {string}
 */
const spanLabel = (span, window) => {
  if (window === "all") return "track start";
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
  { value: "all", label: "Track" },
];

// The key reads the same ramp the columns do, so the swatches are not an
// approximation of the scale, they are the scale.
/**
 * @typedef {{ x: number, w: number, fill: string }} Column
 */

/**
 * How much time a run of bins covers, in milliseconds.
 * @param {{ ms: number, n: number }[]} bins
 * @returns {number}
 */
const spanOf = (bins) => bins.reduce((sum, b) => sum + b.ms, 0);

// Lay the visible bins out along the window, oldest first. EVERY bin is painted,
// including one that counted nothing: this is a field, not a bar chart, and a
// quiet interval is a reading at the bottom of the scale rather than a hole in
// the record. Dropping the silent ones punched black columns through continuous
// playback, because the daemon's counter and the page's poll clock alias and a
// poll lands on an unmoved counter now and then.
/**
 * @param {{ ms: number, n: number }[]} bins
 * @param {number} span total window width, in milliseconds
 * @returns {Column[]}
 */
function layout(bins, span) {
  /** @type {{ x: number, ms: number, n: number }[]} */
  const slots = [];
  let x = span - spanOf(bins);
  for (const b of bins) {
    slots.push({ x, ms: b.ms, n: b.n });
    x += b.ms;
  }
  // A column runs to wherever the next column starts, plus enough to cover the
  // boundary outright. Exact tiling is not enough and never was: two rects that
  // merely share an edge each cover part of the same device pixel, and the
  // compositor lands on 0.24 background + 0.16 left + 0.6 right, so the trough
  // shows through as a dark line down every sample boundary. Painting the left
  // column past the seam means the right one covers it completely and no
  // background survives. Every boundary gets it, since every slot is painted and
  // the field is meant to read as one surface.
  const bleed = span / 300;
  return slots.map((s, i) => {
    const next = slots[i + 1];
    const right = next ? next.x + bleed : s.x + s.ms;
    return { x: s.x, w: right - s.x, fill: fillFor(rateOf(s)) };
  });
}

// Draws nothing until the current track has logged an event, and keeps drawing
// for the rest of playback once it has. The rule lives here rather than at the
// call site because it is the strip's own affair: what the card holds is one
// section that either has something to report or does not.
/** Apodizing-event density over the chosen window, scrolling right to left. */
const ApodStrip = () => {
  if (!apodStripVisible.value) return null;
  const bins = apodVisibleBins.value;
  const window = apodWindow.value;
  const span = window === "all" ? spanOf(bins) : Number(window) * 1000;
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
          ${layout(bins, span).map(
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

// `showQuick` is the opt-in checkbox, on by default. LIVE renders this card with
// it off: that page already polls at 1 s unconditionally (store/ui.js), so an
// unticked box promising faster updates would be describing something the page
// is already doing. The System tab's copy is untouched.
/**
 * Engine-health cluster: VU gauge, input/output buffer meters and clip / apodizing counters, dimmed when not playing.
 * @param {{ showQuick?: boolean }} props
 */
export function EngineHealth({ showQuick = true }) {
  const st = (engineStatus.value || {}).status || {};
  const playing = Number(st.state) === 2;
  /** @param {StatusValue} v @returns {Reading} */
  const n = (v) => {
    const x = Number(v);
    return playing && v != null && v !== "" && Number.isFinite(x) ? x : null;
  };
  // fills are 0.0–1.0, but the daemon reports -1 when a buffer doesn't apply
  // (observed live: input_fill=-1 during NAA playback) — that's "n/a", not 0%.
  /** @param {StatusValue} v @returns {Reading} */
  const fill = (v) => {
    const f = n(v);
    return f === null || f < 0 ? null : Math.min(f, 1);
  };
  const c = trackCounters.value;
  const clips = playing ? c.clips : null;
  const apod = playing ? c.apod : null;
  return html`
    <div class="eh-cluster ${playing ? "" : "eh-idle"}">
      <${VuGauge} speed=${n(st.process_speed)} />
      <div class="eh-meters">
        <${Meter} label="Input buffer" frac=${fill(st.input_fill)} />
        <${Meter} label="Output buffer" frac=${outputBufferApplies.value ? fill(st.output_fill) : null} />
      </div>
      <div class="eh-counters">
        <${Counter} label="Clips" delta=${clips} total=${n(st.clips)} alert=${!!clips} />
        <${Counter} label="Apodizing counter" delta=${apod} total=${n(st.apod)} alert=${false} />
      </div>
    </div>
    <${ApodStrip} />
    ${
      showQuick
        ? html`
          <label class="poll-quick inline-check">
            <${Checkbox} value=${quickSystemUpdates.value ? "1" : "0"} onChange=${(/** @type {string} */ v) => setQuickSystemUpdates(v === "1")} />
            Quick updates
            <span class="poll-quick-note">refresh every second while this page is open</span>
          </label>
        `
        : null
    }
  `;
}
