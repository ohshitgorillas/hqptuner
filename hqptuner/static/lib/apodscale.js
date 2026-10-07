// The shared density scale for the apodizing readouts: the Engine health strip
// and the header indicator. It lives here because both need the same reference,
// or the two disagree about the same music.

// Density is a RATE, not a count: events per second, taken over the interval the
// bin actually observed. Bins differ in width, so scoring the raw count would
// paint a narrow bin cooler than a wide one holding the same music.
/**
 * The density one recorded bin observed.
 *
 * @param {{ ms: number, n: number }} bin
 * @returns {number} events per second
 */
export const rateOf = (bin) => (bin.ms > 0 ? (bin.n * 1000) / bin.ms : 0);

/**
 * The time axis's width in milliseconds, shared by the apodizing strip and the
 * spectrogram: the chosen duration.
 *
 * @param {string} window  s
 * @returns {number}
 */
export const windowSpan = (window) => Number(window) * 1000;

/**
 * @typedef {{ x: number, rate: number }} GridColumn
 *   One grid cell: its left edge in milliseconds from the strip's left edge,
 *   and its events per second.
 */

// A bin's width is the playback it observed: how far the daemon's position moved
// between two Status frames. A position that did not advance, or that cannot be
// read, observed nothing.
/**
 * The milliseconds of playback between two positions.
 *
 * @param {number | null} prev the daemon's position in seconds
 * @param {number | null} next
 * @returns {number} 0 where no playback was observed
 */
export function playedMs(prev, next) {
  if (prev === null || next === null) return 0;
  return Math.max(0, (next - prev) * 1000);
}

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

/**
 * Where a density falls on the scale, floor to saturation.
 *
 * @param {number} rate events per second
 * @returns {number} 0..1
 */
export const intensity = (rate) => Math.min(1, Math.log10(rate + 1) / LOG_SPAN);
