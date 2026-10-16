// The queued feed frames laid end to end on playback time, each as long as its frame time, with the playhead somewhere
// inside the first. Moving the playhead along crosses whole frames and parts of frames; a frame it has passed the end
// of leaves the timeline. The playhead's own pace is model/gauges/pace.js's.
//
// Pure: every function hands back a new timeline and leaves the one it was given untouched.

/** @typedef {import("./meter/meter.js").MeterFrame} MeterFrame */
/**
 * Frames oldest first, and how far into the first of them the playhead stands, ms.
 *
 * @typedef {{ frames: MeterFrame[], head: number }} Timeline
 */
/**
 * What one move along the timeline crossed: each frame it touched with the ms of it crossed, oldest first; the frames
 * it passed the end of, oldest first; and the timeline left ahead.
 *
 * @typedef {{ pieces: { frame: MeterFrame, ms: number }[], passed: MeterFrame[], timeline: Timeline }} Crossing
 */

/** @type {Timeline} */
export const TIMELINE_EMPTY = { frames: [], head: 0 };

// What is left of a frame, ms, below which the playhead counts as past its end.
const END_MS = 1e-6;

/**
 * `timeline` with `frames` laid on after its last.
 *
 * @param {Timeline} timeline
 * @param {MeterFrame[]} frames  oldest first
 * @returns {Timeline}
 */
export function extend(timeline, frames) {
  return { frames: timeline.frames.concat(frames), head: timeline.head };
}

/**
 * The playback queued ahead of the playhead, ms.
 *
 * @param {Timeline} timeline
 * @returns {number}
 */
export function ahead(timeline) {
  return timeline.frames.reduce((sum, f) => sum + f.ms, 0) - timeline.head;
}

/**
 * Move the playhead `ms` along `timeline`, no further than its end.
 *
 * @param {Timeline} timeline
 * @param {number} ms
 * @returns {Crossing}
 */
export function cross(timeline, ms) {
  const frames = timeline.frames.slice();
  let head = timeline.head;
  let left = ms;
  /** @type {Crossing["pieces"]} */
  const pieces = [];
  /** @type {MeterFrame[]} */
  const passed = [];
  while (frames.length && left > END_MS) {
    const frame = frames[0];
    const take = Math.min(left, frame.ms - head);
    if (take > 0) pieces.push({ frame, ms: take });
    left -= take;
    head += take;
    if (frame.ms - head < END_MS) {
      passed.push(frame);
      frames.shift();
      head = 0;
    }
  }
  return { pieces, passed, timeline: { frames, head } };
}
