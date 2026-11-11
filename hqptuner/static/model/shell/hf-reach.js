// Which HF filters act on which content. Content is the source rate (a DSD bitstream counted at its rate / 64, as the
// engine decimates it for PCM conversion); a filter acts only where the content can reach it. Nothing acts below 50 kHz;
// a fixed-corner filter acts when the content's Nyquist is above its corner; an Nx filter acts when the content rate is
// above that multiple of its 44.1 or 48 kHz base. Filters are keyed by the engine's option name, never by list index.
// Both the rail's lamp and the engine-row menu read this one table, so they cannot disagree.

/** The first source rate any HF filter acts on, hertz (manual §4.6 p27: 1x rates are those below 50 kHz). */
const REACH_FLOOR = 50000;

/** A DSD bitstream's rate over its decimated PCM rate. */
const DSD_DECIMATION = 64;

/** The two rate families' base rates, hertz. */
const BASE_44 = 44100;
const BASE_48 = 48000;

/** @type {Record<string, number>} Fixed-corner filters by corner, hertz. */
const CORNER_HZ = { "20k": 20000, "30k": 30000, "40k": 40000, "50k": 50000 };

/** @type {Record<string, number>} Nx filters by multiple of the base rate. */
const MULTIPLE = { "2x": 2, "4x": 4, "8x": 8 };

/**
 * The content rate a filter is judged against: the source rate, divided by 64 for a DSD bitstream.
 *
 * @param {unknown} rate  the source rate in hertz, as a number or the engine's string
 * @param {boolean} dsd  the source is a DSD bitstream
 * @returns {number | null}  null when no rate is known
 */
export function contentRate(rate, dsd) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return null;
  return dsd ? n / DSD_DECIMATION : n;
}

/**
 * Whether an HF filter acts on content at a rate. `none`, a name this table does not know and an unknown rate all count
 * as acting, so a filter the running engine adds later is never darkened on a guess.
 *
 * @param {string} name  the filter's engine option name
 * @param {number | null} rate  the content rate in hertz, null when unknown
 * @returns {boolean}
 */
export function actsOn(name, rate) {
  if (rate === null) return true;
  const fixed = Object.hasOwn(CORNER_HZ, name);
  if (!fixed && !Object.hasOwn(MULTIPLE, name)) return true;
  if (rate < REACH_FLOOR) return false;
  if (fixed) return rate / 2 > CORNER_HZ[name];
  const base = rate % BASE_44 === 0 ? BASE_44 : BASE_48;
  return rate > MULTIPLE[name] * base;
}
