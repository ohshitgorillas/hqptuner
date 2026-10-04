// The engine row's readings, off one Status frame: the process speed, the input and output buffer fill as whole
// percents, and the clipping and apodizing counts for this track and in total. Every reading is a playback-time one:
// nothing is shown (null) while the engine is not playing, for a field the frame does not carry as a number, for a
// buffer the daemon reports as -1 (it does not apply on this path), and for an output buffer that has not been seen to
// fill this track (store/health.js).

/** @typedef {import("../health.js").StatusFrame} StatusFrame */

/**
 * One counter's counts, null where there is none to show.
 *
 * @typedef {object} Count
 * @property {number | null} track  this track's count
 * @property {number | null} total  the engine's running total
 */

/**
 * @typedef {object} EngineReadings
 * @property {number | null} speed   process speed, ×
 * @property {number | null} input   input buffer fill, whole percent
 * @property {number | null} output  output buffer fill, whole percent
 * @property {Count} clips
 * @property {Count} apod
 */

const PLAYING = 2; // Status state: 0 Stopped, 1 Paused, 2 Playing, 3 Stopping

/**
 * The engine row's readings for a Status frame.
 *
 * @param {StatusFrame | null | undefined} status  the Status frame as the poll delivers it
 * @param {{ clips: number, apod: number }} counters  this track's deltas (store/health.js trackCounters)
 * @param {boolean} outputApplies  whether the output buffer has filled this track (store/health.js)
 * @returns {EngineReadings}
 */
export function engineReadings(status, counters, outputApplies) {
  const st = status || {};
  const playing = Number(st.state) === PLAYING;
  /** @param {string | undefined} v */
  const reading = (v) => (playing && v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  /** @param {string | undefined} v */
  const percent = (v) => {
    const fill = reading(v);
    return fill === null || fill < 0 ? null : Math.round(Math.min(fill, 1) * 100);
  };
  /**
   * @param {number} track
   * @param {string | undefined} total
   * @returns {Count}
   */
  const count = (track, total) => ({ track: playing ? track : null, total: reading(total) });
  return {
    speed: reading(st.process_speed),
    input: percent(st.input_fill),
    output: outputApplies ? percent(st.output_fill) : null,
    clips: count(counters.clips, st.clips),
    apod: count(counters.apod, st.apod),
  };
}
