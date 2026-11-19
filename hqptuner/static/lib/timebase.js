// The browser's one time base: where a number of samples, a stamp on a frame and a wall-time unit turn into the ms the
// rest of the app keeps time in. Every conversion between samples, seconds and ms lives here, and every caller,
// production and test alike, takes it from here.

const MS_PER_S = 1000;
const US_PER_MS = 1000;

/**
 * A whole number of samples at a rate, in ms: the samples times 1000, divided once by the rate, so one correctly
 * rounded operation turns an exactly known count into an exactly known ms value. A frame's start `at` and its end
 * `at + n` are each converted from whole samples by this, never the converted start plus the converted length, so a
 * frame's end equals the next contiguous frame's start exactly.
 *
 * @param {number} samples  whole samples
 * @param {number} rate  samples per second, Hz
 * @returns {number}  ms; NaN where the rate is
 */
export const samplesToMs = (samples, rate) => (samples * MS_PER_S) / rate;

/**
 * Whole microseconds, as the engine reports a delay, in ms: one division by the factor.
 *
 * @param {number} us
 * @returns {number}  ms
 */
export const usToMs = (us) => us / US_PER_MS;

/**
 * Seconds, as the user types a delay, in ms: one multiplication by the factor.
 *
 * @param {number} s
 * @returns {number}  ms
 */
export const secondsToMs = (s) => s * MS_PER_S;

/**
 * A frame as the time base reads it.
 *
 * @typedef {object} Stamped
 * @property {number} ms  playback, ms, the frame covers
 * @property {number} [at]  playback, ms, where the frame starts; absent on a frame with no stamp
 * @property {number} [end]  playback, ms, where the frame ends; absent on a frame that carries no converted end
 */

/**
 * Where a frame starts, playback ms; NaN for a frame with no stamp.
 *
 * @param {Stamped} f
 * @returns {number}
 */
export const startOf = (f) => f.at ?? NaN;

/**
 * Where a frame ends, playback ms: its converted end where it carries one, its start plus its length where it does
 * not; NaN for a frame with no stamp.
 *
 * @param {Stamped} f
 * @returns {number}
 */
export const endOf = (f) => f.end ?? startOf(f) + f.ms;
