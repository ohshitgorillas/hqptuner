// The Source drawer's meter, store half: what the block shows over the meter feed (store/meter/feed.js). Whether the
// meter or a no-stream line shows and which line, the linear frequency axis up to the source Nyquist or the share of it
// the frequency span picked keeps in view, the channel switch's choices and the channel drawn, the color span, and the
// time window the apodizing strip and the spectrogram share with its axis. Also the strip's events per pixel column.
// The DOM half is components/faceplate/drawers/Source.js and the modules under components/faceplate/drawers/source/.
//
// The window is one span for both charts, the chosen seconds. Both end on the one playhead, in playback ms
// (store/meter/spectrogram.js stripEnd), which runs past the newest apodizing bin into playback no Status has observed
// yet, drawn blank.

import { computed, signal } from "@preact/signals";
import { clamp, truthy } from "../../../lib/coerce.js";
import { windowSpan } from "../../../lib/apodscale.js";
import { FREQ_SPANS, spanShare } from "../../../model/gauges/meter/meter.js";
import { freqTicks, timeTicks } from "../../../model/gauges/meter/meter-plot.js";
import { metering } from "../../actions.js";
import { meterGeometry, meterSilent } from "../../meter/feed.js";
import { runningValue } from "../../resolve.js";
import { engineStatus } from "../../signals.js";
import { playback } from "../../core/readings.js";
import { apodWindow, meterChannel, meterRange } from "../../ui/prefs.js";
import { sourceIsDsd } from "../path.js";

const CD_NYQUIST = 22050; // the axis top while the feed has sent no geometry
const STEREO = 2;
const MS_PER_S = 1000; // the time axis counts in milliseconds
const MAX_EVENTS = 3; // the strip's hottest color, model/gauges/meter/meter-plot.js apodRamp

/** The no-stream lines, by state, the drawer's and the page's. @type {Record<string, string>} */
export const METER_NOTES = {
  idle: "Start playback to see the meter.",
  off: "No metering available.",
  silent: "No metering available.",
  matrix: "Engage the matrix engine to see DSD metering.",
};

/** The spectrogram's frequency span, one of FREQ_SPANS; every page load opens at the whole band. */
export const spectrogramSpan = signal("full");

/**
 * Set the spectrogram's frequency span. A value outside FREQ_SPANS is ignored.
 *
 * @param {string} v
 * @returns {void}
 */
export function setSpectrogramSpan(v) {
  if (FREQ_SPANS.includes(v)) spectrogramSpan.value = v;
}

/**
 * Which the block shows: `live` the meter; else the line for metering off, nothing playing, a feed gone quiet while
 * it plays, or a quiet DSD source with the matrix off.
 *
 * @typedef {"live" | "off" | "idle" | "silent" | "matrix"} MeterState
 */

/**
 * The Source meter's view.
 *
 * @typedef {object} SourceMeterView
 * @property {MeterState} state
 * @property {number} nyquist  Hz, the source Nyquist
 * @property {number} top  Hz, the frequency axis's top, the share of the Nyquist the span picked keeps in view
 * @property {boolean} edgeIsNyquist  whether the top is the source Nyquist, as it is at the whole band
 * @property {string} freqSpan  the frequency span picked, one of FREQ_SPANS
 * @property {ReturnType<typeof freqTicks>} freq  tick fractions down from the top edge
 * @property {number} span  ms, the window both charts span
 * @property {ReturnType<typeof timeTicks>} time  tick fractions across the window
 * @property {number} range  dB, the color span
 * @property {string} channel  the channel drawn, `sum` or an index
 * @property {string[]} channels  the channel switch's choices, the sum first
 * @property {string} window  the window picked, seconds
 */

/**
 * Which state the block is in.
 *
 * @returns {MeterState}
 */
function stateOf() {
  const status = engineStatus.value || {};
  if (!metering.value) return "off";
  if (!playback.value.playing) return "idle";
  if (!meterSilent()) return "live";
  return sourceIsDsd(status.metadata || {}) && !truthy(runningValue("matrix_enabled")) ? "matrix" : "silent";
}

/**
 * The channel switch's choices: the sum, then each channel the source carries.
 *
 * @param {number} count
 * @returns {string[]}
 */
const channelChoices = (count) => ["sum", ...Array.from({ length: count }, (_, i) => String(i))];

/** The meter's view without its state: built anew only when a signal it reads changes. */
const meterAxes = computed(() => {
  const geo = meterGeometry.value;
  const nyquist = geo ? geo.nyquist : CD_NYQUIST;
  const channels = channelChoices(geo ? geo.channels : STEREO);
  const window = apodWindow.value;
  const span = windowSpan(window);
  const share = spanShare(spectrogramSpan.value);
  const top = nyquist * share;
  return {
    nyquist,
    top,
    edgeIsNyquist: share === 1,
    freqSpan: spectrogramSpan.value,
    freq: freqTicks(top, (f) => 1 - f / top),
    span,
    time: timeTicks(span, MS_PER_S),
    range: Number(meterRange.value),
    channel: channels.includes(meterChannel.value) ? meterChannel.value : "sum",
    channels,
    window,
  };
});

/**
 * The view sourceMeter() handed out last and the axes it was built on. Its state is read on every call, since a feed
 * going quiet is a clock read and no signal (store/meter/feed.js meterSilent).
 *
 * @type {{ axes: object | null, view: SourceMeterView | null }}
 */
const held = { axes: null, view: null };

/**
 * What the Source drawer's meter shows now: the view handed out last while neither its state nor a signal behind it
 * has changed.
 *
 * @returns {SourceMeterView}
 */
export function sourceMeter() {
  const axes = meterAxes.value;
  const state = stateOf();
  if (held.view && held.axes === axes && held.view.state === state) return held.view;
  const view = { state, ...axes };
  held.axes = axes;
  held.view = view;
  return view;
}

/** stripEvents' events per column, reused across calls and made anew only when the strip's length changes. */
let stripAcc = new Float64Array(0);

/**
 * Add each bin's events to the pixel columns its playback falls under, spread evenly across that playback.
 *
 * @param {Float64Array} acc  events per column
 * @param {{ ms: number, n: number, at: number | null }} b  `ms` the playback ms it observed, `at` the playback ms it
 *   ends on, null where it has no stamp; a bin with no stamp, or ending by the left edge, adds nothing
 * @param {number} left  playback, ms: the window's left edge
 * @param {number} w  playback ms per column
 */
function spread(acc, b, left, w) {
  const at = b.at;
  if (at === null || at <= left) return;
  const start = at - b.ms;
  const x0 = Math.max(0, Math.floor((start - left) / w));
  const x1 = Math.min(acc.length, Math.ceil((at - left) / w));
  for (let x = x0; x < x1; x++) {
    const lo = Math.max(start, left + x * w);
    const hi = Math.min(at, left + (x + 1) * w);
    if (hi > lo) acc[x] += (b.n * (hi - lo)) / b.ms;
  }
}

/**
 * The apodizing strip's level at each pixel column of `strip` across a window of `span` playback ms ending on playback
 * `end`, written into `strip`: 0 where no event fell or no bin has observed the playback yet, else the events under the
 * column rounded, at least 1 and at most the strip's hottest. A bin with no stamp draws nothing.
 *
 * @param {{ ms: number, n: number, at: number | null }[]} bins  oldest first, `ms` the playback ms each observed, `at`
 *   the playback ms each ends on, null where it has no stamp
 * @param {number} span  playback, ms
 * @param {number} end  playback, ms: where the right edge stands
 * @param {Uint8Array} strip  one level per pixel column, the caller's, its length the column count
 * @returns {Uint8Array}  `strip`
 */
export function stripEvents(bins, span, end, strip) {
  const cols = strip.length;
  if (stripAcc.length !== cols) stripAcc = new Float64Array(cols);
  const acc = stripAcc;
  acc.fill(0);
  if (span > 0) {
    const left = end - span;
    for (const b of bins) if (b.ms > 0 && b.n > 0) spread(acc, b, left, span / cols);
  }
  for (let x = 0; x < cols; x++) strip[x] = acc[x] > 0 ? clamp(Math.round(acc[x]), 1, MAX_EVENTS) : 0;
  return strip;
}
