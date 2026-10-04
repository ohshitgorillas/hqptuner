// The Source drawer's meter, store half: what the block shows over the v1 stream. Whether the meter or a no-stream
// line shows and which line, the linear frequency axis up to the source Nyquist, the channel switch's choices and the
// channel drawn, the colour span, and the time window the apodizing strip and the spectrogram share with its axis.
// Also the strip's events per pixel column. The DOM half is components/faceplate/drawers/Source.js.
//
// The window is one span for both charts: the chosen seconds, or for All the playback the apodizing history holds,
// which clears on a track change (store/apodhistory.js). Both charts end on the newest playback they hold.

import { truthy } from "../../../lib/coerce.js";
import { windowSpan } from "../../../lib/apodscale.js";
import { freqTicks, timeTicks } from "../../../model/gauges/meter-plot.js";
import { metering } from "../../actions.js";
import { apodVisibleBins } from "../../apodhistory.js";
import { meterGeometry, meterSilent } from "../../meter/feed.js";
import { runningValue } from "../../resolve.js";
import { engineStatus } from "../../signals.js";
import { apodWindow, meterChannel, meterRange } from "../../ui/prefs.js";
import { sourceIsDsd } from "../path.js";

const PLAYING = 2;
const CD_NYQUIST = 22050; // the axis top while the feed has sent no geometry
const STEREO = 2;
const MS_PER_S = 1000; // the time axis counts in milliseconds
const MAX_EVENTS = 3; // the strip's hottest colour, model/gauges/meter-plot.js apodRamp

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
 * @property {number} nyquist  Hz, the frequency axis's top
 * @property {ReturnType<typeof freqTicks>} freq  tick fractions down from the top edge
 * @property {number} span  ms, the window both charts span
 * @property {ReturnType<typeof timeTicks>} time  tick fractions across the window
 * @property {number} range  dB, the colour span
 * @property {string} channel  the channel drawn, `sum` or an index
 * @property {string[]} channels  the channel switch's choices, the sum first
 * @property {string} window  the window picked, seconds or `all`
 */

/**
 * Which state the block is in, by v1's rules (components/meter/View.js).
 *
 * @returns {MeterState}
 */
function stateOf() {
  const status = engineStatus.value || {};
  if (!metering.value) return "off";
  if (Number((status.status || {}).state) !== PLAYING) return "idle";
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

/**
 * What the Source drawer's meter shows now.
 *
 * @returns {SourceMeterView}
 */
export function sourceMeter() {
  const geo = meterGeometry.value;
  const nyquist = geo ? geo.nyquist : CD_NYQUIST;
  const channels = channelChoices(geo ? geo.channels : STEREO);
  const window = apodWindow.value;
  const all = window === "all";
  const span = windowSpan(apodVisibleBins.value, window);
  return {
    state: stateOf(),
    nyquist,
    freq: freqTicks(nyquist, (f) => 1 - f / nyquist),
    span,
    time: timeTicks(span, span, MS_PER_S, all),
    range: Number(meterRange.value),
    channel: channels.includes(meterChannel.value) ? meterChannel.value : "sum",
    channels,
    window,
  };
}

/**
 * Add each bin's events to the pixel columns its playback falls under, spread evenly across that playback.
 *
 * @param {Float64Array} acc  events per column
 * @param {{ ms: number, n: number, at: number }} b
 * @param {number} left  ms, the window's left edge in track position
 * @param {number} w  ms per column
 */
function spread(acc, b, left, w) {
  const start = b.at - b.ms;
  const x0 = Math.max(0, Math.floor((start - left) / w));
  const x1 = Math.min(acc.length, Math.ceil((b.at - left) / w));
  for (let x = x0; x < x1; x++) {
    const lo = Math.max(start, left + x * w);
    const hi = Math.min(b.at, left + (x + 1) * w);
    if (hi > lo) acc[x] += (b.n * (hi - lo)) / b.ms;
  }
}

/**
 * The apodizing strip's level at each of `cols` pixel columns across a window of `span` ms ending on the newest bin:
 * 0 where no event fell, else the events under the column rounded, at least 1 and at most the strip's hottest.
 *
 * @param {{ ms: number, n: number, at: number }[]} bins  oldest first, `at` the track position in ms each ends on
 * @param {number} span  ms
 * @param {number} cols
 * @returns {Uint8Array}
 */
export function stripEvents(bins, span, cols) {
  const acc = new Float64Array(cols);
  const last = bins.at(-1);
  if (last && span > 0) {
    const left = last.at - span;
    for (const b of bins) if (b.ms > 0 && b.n > 0) spread(acc, b, left, span / cols);
  }
  return Uint8Array.from(acc, (ev) => (ev > 0 ? Math.min(MAX_EVENTS, Math.max(1, Math.round(ev))) : 0));
}
