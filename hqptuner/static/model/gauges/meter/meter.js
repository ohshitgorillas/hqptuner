// The Source meter's model, free of the DOM and of any clock: the feed's bins decoded, a stride's frames folded into
// one, a channel's bins picked, bins gathered under drawing columns, a level placed on the plot, the spectrum's
// frequency spans, and the colors the level bars and held-peak mark draw in under the palette picked for the spectrum.

import { suiteColor } from "./spectrumfx.js";

/**
 * One channel of a meter frame.
 *
 * @typedef {object} MeterChannel
 * @property {number} peak  dBFS
 * @property {number} rms  dBFS
 * @property {Float32Array} bins  dBFS, low frequencies first
 */

/**
 * One decoded feed frame.
 *
 * @typedef {object} MeterFrame
 * @property {MeterChannel[]} channels
 * @property {number} ms  playback, ms, the frame covers
 * @property {number} [at]  playback, ms, where the frame starts
 * @property {boolean} [break]  whether the feed marks a break before the frame
 * @property {FrameGeometry | null} [geo]  the layout the frame was decoded under; null before any geometry event
 */

/**
 * The frames of a stride folded into one.
 *
 * @typedef {object} FoldScene
 * @property {MeterChannel[]} channels
 * @property {Float64Array[]} power  per channel, per bin, the power sum the fold carries
 */

/**
 * The layout of a frame's bins.
 *
 * @typedef {object} FrameGeometry
 * @property {number} rate  Hz
 * @property {number} nyquist  Hz
 * @property {number} channels
 * @property {number} bins
 */

/**
 * The paint a level reading draws in.
 *
 * @typedef {object} MeterPaint
 * @property {string} peak
 * @property {string} rms
 * @property {string} hold
 */

/**
 * The Source spectrum's frequency spans, widest first: the whole band, a half and a quarter of it.
 *
 * @type {readonly string[]}
 */
export const FREQ_SPANS = Object.freeze(["full", "half", "quarter"]);

//: Each span's share of the band up to the source Nyquist.
const SPAN_SHARES = Object.freeze({ full: 1, half: 0.5, quarter: 0.25 });

/**
 * The share of the band, 0 Hz up to the source Nyquist, a span shows. A span outside FREQ_SPANS shows the whole band.
 *
 * @param {string} span  one of FREQ_SPANS
 * @returns {number}  in (0, 1]
 */
export function spanShare(span) {
  return span === "half" || span === "quarter" ? SPAN_SHARES[span] : SPAN_SHARES.full;
}

//: dB below full scale one wire count stands for.
const DB_PER_COUNT = 0.5;
//: Bytes a wire bin takes.
const BYTES_PER_BIN = 2;
//: Bits in a byte.
const BYTE_BITS = 8;

/**
 * The bins of a feed channel: two bytes a bin, low byte first, each a count of 0.5 dB steps below full scale.
 *
 * @param {string} wire  base64
 * @returns {Float32Array}  dBFS, low frequencies first
 */
export function decodeBins(wire) {
  const raw = atob(wire);
  const bins = new Float32Array(Math.floor(raw.length / BYTES_PER_BIN));
  for (let i = 0; i < bins.length; i++) {
    const count = raw.charCodeAt(i * BYTES_PER_BIN) + (raw.charCodeAt(i * BYTES_PER_BIN + 1) << BYTE_BITS);
    bins[i] = -count * DB_PER_COUNT;
  }
  return bins;
}

//: dB per decade of power.
const DB_PER_DECADE = 10;

/**
 * Power, linear, of a level.
 *
 * @param {number} db  dBFS
 * @returns {number}
 */
const power = (db) => DB_PER_DECADE ** (db / DB_PER_DECADE);

/**
 * Level of a power, linear.
 *
 * @param {number} p
 * @returns {number}  dBFS
 */
const level = (p) => DB_PER_DECADE * Math.log10(p);

/**
 * Whether a scene holds as many channels as a frame, each of as many bins.
 *
 * @param {FoldScene} scene
 * @param {MeterFrame} frame
 * @returns {boolean}
 */
function fits(scene, frame) {
  const { channels } = frame;
  if (scene.channels.length !== channels.length) return false;
  return channels.every((ch, c) => scene.channels[c].bins.length === ch.bins.length);
}

/**
 * A scene shaped like a frame: its channel count, each channel's bin count.
 *
 * @param {MeterFrame} frame
 * @returns {FoldScene}
 */
function sceneFor(frame) {
  return {
    channels: frame.channels.map((ch) => ({ peak: 0, rms: 0, bins: new Float32Array(ch.bins.length) })),
    power: frame.channels.map((ch) => new Float64Array(ch.bins.length)),
  };
}

/**
 * Fold channel `c` of every frame into the scene: the loudest peak, the RMS and each bin power-averaged.
 *
 * @param {MeterFrame[]} frames
 * @param {FoldScene} scene
 * @param {number} c
 */
function foldChannel(frames, scene, c) {
  const out = scene.channels[c];
  const sums = scene.power[c];
  sums.fill(0);
  let peak = -Infinity;
  let rms = 0;
  for (const f of frames) {
    const ch = f.channels[c];
    if (ch.peak > peak) peak = ch.peak;
    rms += power(ch.rms);
    for (let b = 0; b < sums.length; b++) sums[b] += power(ch.bins[b]);
  }
  out.peak = peak;
  out.rms = level(rms / frames.length);
  for (let b = 0; b < sums.length; b++) out.bins[b] = level(sums[b] / frames.length);
}

/**
 * The frames of a stride folded into one: per channel the loudest peak, the RMS and each bin power-averaged, each
 * frame once. The scene handed in is refilled in place and returned; a fresh one is made only when none is handed in
 * or the frames' channel or bin count differs from it. Every frame holds the first frame's channel and bin counts.
 *
 * @param {MeterFrame[]} frames
 * @param {FoldScene} [into]
 * @returns {FoldScene}
 */
export function foldFrames(frames, into) {
  const first = frames[0];
  if (!first) return into ?? { channels: [], power: [] };
  const scene = into && fits(into, first) ? into : sceneFor(first);
  for (let c = 0; c < scene.channels.length; c++) foldChannel(frames, scene, c);
  return scene;
}

/**
 * A channel's bins from a frame: the channel index the spectrogram holds picks that channel; `sum`, or an index the
 * frame has no channel for, picks the power average of every channel.
 *
 * @param {MeterFrame} frame
 * @param {string} channel  `sum` or a channel index
 * @returns {Float32Array}  dBFS, low frequencies first
 */
export function pickBins(frame, channel) {
  const { channels } = frame;
  const one = /^\d+$/.test(channel) ? channels[Number(channel)] : undefined;
  if (one) return one.bins;
  const out = new Float32Array(channels[0]?.bins.length ?? 0);
  for (let b = 0; b < out.length; b++) {
    let sum = 0;
    for (const ch of channels) sum += power(ch.bins[b]);
    out[b] = level(sum / channels.length);
  }
  return out;
}

/**
 * The loudest bin under each drawing column, low frequencies first. Column `j` of `n` covers the bins from
 * `floor(j * bins / n)` up to the next column's start, and at least one bin; a column over no bins at all reads
 * -Infinity. Written into `buffer` where it holds `columns` values, a new buffer otherwise.
 *
 * @param {Float32Array} bins  dBFS
 * @param {number} columns
 * @param {Float32Array} [buffer]  the columns of the paint before, reused where it fits
 * @returns {Float32Array}  dBFS, one per column
 */
export function traceColumns(bins, columns, buffer) {
  const out = buffer?.length === columns ? buffer : new Float32Array(columns);
  out.fill(-Infinity);
  const last = bins.length - 1;
  for (let j = 0; j < columns && last >= 0; j++) {
    const from = Math.min(last, Math.floor((j * bins.length) / columns));
    const to = Math.max(from + 1, Math.floor(((j + 1) * bins.length) / columns));
    for (let b = from; b < to; b++) if (bins[b] > out[j]) out[j] = bins[b];
  }
  return out;
}

/**
 * Where a level sits on the plot: 1 at full scale, 0 `range` dB below it. A level outside that span lies beyond 0 or 1.
 *
 * @param {number} db  dBFS
 * @param {number} range  dB, positive
 * @returns {number}
 */
export function fraction(db, range) {
  return 1 + db / range;
}

/**
 * The colors a level reading draws in: the peak bar, the RMS bar and the held-peak mark each in the color the spectrum
 * draws at its own level under `palette`, under Accent in the accent's shades.
 *
 * @param {string} palette  the palette picked for the spectrum
 * @param {{ peak: number, rms: number, hold: number }} reading  plot fractions, 0 on the floor, 1 at full scale
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {MeterPaint}
 */
export function meterColors(palette, reading, accent) {
  return {
    peak: suiteColor(palette, reading.peak, accent),
    rms: suiteColor(palette, reading.rms, accent),
    hold: suiteColor(palette, reading.hold, accent),
  };
}
