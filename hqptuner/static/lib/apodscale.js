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
 * How much time a run of bins covers, in milliseconds.
 *
 * @param {{ ms: number }[]} bins
 * @returns {number}
 */
const spanOf = (bins) => bins.reduce((sum, b) => sum + b.ms, 0);

/**
 * The time axis's width in milliseconds, shared by the apodizing strip and the
 * spectrogram: the chosen duration, or for the whole-history window, whatever
 * the visible bins cover.
 *
 * @param {{ ms: number }[]} bins
 * @param {string} window
 * @returns {number}
 */
export const windowSpan = (bins, window) => (window === "all" ? spanOf(bins) : Number(window) * 1000);

// The strip draws on a fixed grid of playback time rather than one column per
// bin. The daemon's Status steps are uneven (one reading can cover a second,
// the next three), so a column per bin draws blocks of every width. Each grid
// cell instead reads the events of the bins overlapping it, each bin's events
// spread evenly across the playback it covered, which is the finest the daemon
// reports them. Cells sit at whole multiples of CELL_MS of track position, so
// a cell's reading never changes once playback has passed it, and only whole
// cells are drawn.
export const CELL_MS = 2000;

/**
 * @typedef {{ x: number, rate: number }} GridColumn
 *   One grid cell: its left edge in milliseconds from the strip's left edge,
 *   and its events per second.
 */

/**
 * The strip's whole grid cells across a window, oldest first.
 *
 * @param {{ ms: number, n: number, at: number }[]} bins
 *   contiguous, oldest first, `at` the track position in ms where each ends
 * @param {number | null} windowMs the window's width, or null for the whole history
 * @returns {{ span: number, columns: GridColumn[] }} `span` the strip's width in ms
 */
export function gridColumns(bins, windowMs) {
  if (!bins.length) return { span: windowMs ?? 0, columns: [] };
  const end = Math.floor(bins[bins.length - 1].at / CELL_MS) * CELL_MS;
  const first = Math.ceil((bins[0].at - bins[0].ms) / CELL_MS) * CELL_MS;
  const start = windowMs === null ? first : Math.max(first, end - windowMs);
  const span = windowMs === null ? Math.max(0, end - first) : windowMs;
  /** @type {GridColumn[]} */
  const columns = [];
  let i = 0;
  for (let c0 = start; c0 < end; c0 += CELL_MS) {
    while (i < bins.length && bins[i].at <= c0) i++;
    columns.push({ x: c0 - (end - span), rate: (eventsIn(bins, i, c0) * 1000) / CELL_MS });
  }
  return { span, columns };
}

/**
 * The events of the bins from index `from` on that fall in the cell starting
 * at `c0`, each bin's share in proportion to its overlap with the cell.
 *
 * @param {{ ms: number, n: number, at: number }[]} bins
 * @param {number} from the first bin ending after `c0`
 * @param {number} c0
 * @returns {number}
 */
function eventsIn(bins, from, c0) {
  const c1 = c0 + CELL_MS;
  let events = 0;
  for (let j = from; j < bins.length && bins[j].at - bins[j].ms < c1; j++) {
    const b = bins[j];
    events += (b.n * (Math.min(c1, b.at) - Math.max(c0, b.at - b.ms))) / b.ms;
  }
  return events;
}

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
export const SAT = 30;
const LOG_SPAN = Math.log10(SAT + 1);

/**
 * Where a density falls on the scale, floor to saturation.
 *
 * @param {number} rate events per second
 * @returns {number} 0..1
 */
export const intensity = (rate) => Math.min(1, Math.log10(rate + 1) / LOG_SPAN);
