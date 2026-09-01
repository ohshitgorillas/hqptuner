// The shared density scale for the apodizing readouts: the Engine health strip
// and the header indicator. It lives here because both need the same reference,
// or the two disagree about the same music.

// Density is a RATE, not a count: events per second, taken over the interval the
// bin actually observed. A bin covers 1 s in LIVE and 2 s elsewhere, so scoring
// the raw count would paint the same music half as hot on the page that polls
// faster, and a run that changed cadence mid-track would step to a different
// color with no change in what the engine did.
/**
 * The density one recorded bin observed.
 *
 * @param {{ ms: number, n: number }} bin
 * @returns {number} events per second
 */
export const rateOf = (bin) => (bin.ms > 0 ? (bin.n * 1000) / bin.ms : 0);

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
export const SAT = 30;
const LOG_SPAN = Math.log10(SAT + 1);

/**
 * Where a density falls on the scale, floor to saturation.
 *
 * @param {number} rate events per second
 * @returns {number} 0..1
 */
export const intensity = (rate) => Math.min(1, Math.log10(rate + 1) / LOG_SPAN);
