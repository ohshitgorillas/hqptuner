// The poll seam the apodizing-history suites are driven through, shared by the
// store suite (tests/js/store/apodhistory.test.js) and the strip's render suite
// (tests/js/components/enginehealth-strip.test.js).
//
// A poll is a FRESH object written to engineStatus carrying the daemon's own
// Status fields — state, track_serial, the monotonic apodizing counter `apod`,
// and the playback `position` (`state` values per docs/protocol.md: 0 stopped,
// 1 paused, 2 playing, 3 stop requested). Writing the SAME object reference does
// not notify, so every simulated poll builds a new one.
//
// `position` advances on every poll, the way it does while the daemon is
// playing. That matters beyond realism: the page's poll clock and the daemon's
// own update clock both run near 2s and drift, so a poll sometimes returns the
// frame it already returned, and a repeated frame is one observation handed over
// twice rather than an interval in which nothing happened. A fixture that left
// `position` off would make every frame it builds look like a repeat of the last
// one. Frames that DO repeat are asked for explicitly, through stall(), and
// frames that run backwards through restartPosition() / restartCounter().
//
// The poll CADENCE is moved the way the app moves it — by writing the signals
// the app itself writes (activeTab, quickSystemUpdates, liveMode) and reading
// the result back through store/ui.js's fastPollMs — never by asserting a
// number. Nothing of HQPTuner's is stubbed (docs/testing.md rule 4).
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { engineStatus } from "../../../hqptuner/static/store/signals.js";
import { activeTab, fastPollMs } from "../../../hqptuner/static/store/ui.js";
import { liveMode, quickSystemUpdates } from "../../../hqptuner/static/store/prefs.js";

const PLAYING = "2";
export const STOPPED = "0";
export const PAUSED = "1";

/**
 * The two cadences the app itself produces: LIVE is shown with no opt-in of any
 * kind, and a page with no fast rule and no opt-in polls at the store's default.
 * Leaves the store off the fast lane.
 *
 * @returns {{ live: number, base: number }}
 */
export function readCadences() {
  activeTab.value = "output";
  quickSystemUpdates.value = false;
  liveMode.value = true;
  const live = fastPollMs.value;
  liveMode.value = false;
  const base = fastPollMs.value;
  return { live, base };
}

let serial = 0;
let counter = 0; // the daemon's own monotonic apodizing counter
let seconds = 0; // how far into the track the daemon says it is

// The daemon formats `position` as seconds carrying seventeen decimal places
// ("12.00000000000000000"). It is a string on the wire; a frame repeating it is
// a repeat, and a frame carrying an EARLIER one is a new track the serial never
// reported (restartPosition below).
/** @param {number} value */
const asPosition = (value) => value.toFixed(17);

/**
 * One frame of the track already running, at wherever the position now stands.
 *
 * @param {Record<string, unknown>} fields
 */
function emit(fields) {
  engineStatus.value = {
    status: {
      state: PLAYING,
      track_serial: String(serial),
      apod: String(counter),
      position: asPosition(seconds),
      ...fields,
    },
  };
}

/**
 * Put the daemon's counter where a case needs it — for the frames a real daemon
 * sends after a restart, where the counter is not where it was left.
 *
 * @param {number} value
 */
export function setApodCounter(value) {
  counter = value;
}

/**
 * One poll of the track already running.
 *
 * @param {Record<string, unknown>} [fields]
 */
export function poll(fields = {}) {
  seconds += 1;
  emit(fields);
}

/**
 * The daemon moves on to a new track: a new serial, and the position back at
 * the head of it.
 *
 * @param {Record<string, unknown>} [fields]
 */
export function newTrack(fields = {}) {
  serial += 1;
  seconds = 0;
  poll(fields);
}

/**
 * The daemon hands the NEXT track the same track_serial — the shape a track
 * ending on its own produces on a Roon source, where nothing but the readings
 * themselves marks the boundary. This is the half of it that the position
 * carries: the serial is untouched and the position drops back to the head of
 * the stream, so the frame reads EARLIER than the one before it.
 *
 * @param {Record<string, unknown>} [fields]
 */
export function restartPosition(fields = {}) {
  seconds = 0;
  emit(fields);
}

/**
 * The other half of the same unreported boundary: the serial is untouched, the
 * position advances as usual, and the daemon's apodizing counter drops back
 * near zero because it counts the current track rather than the session (584
 * to 4 across a boundary, measured on the wire).
 *
 * @param {number} [value] where the counter restarts
 * @param {Record<string, unknown>} [fields]
 */
export function restartCounter(value = 0, fields = {}) {
  counter = value;
  poll(fields);
}

/**
 * One poll per delta on the track already running — so `deltas` is exactly the
 * sequence of per-bin counts the store should have recorded, oldest first.
 *
 * @param {number[]} deltas
 * @param {Record<string, unknown>} [fields]
 * @returns {number[]}
 */
export function append(deltas, fields = {}) {
  for (const d of deltas) {
    counter += d;
    poll(fields);
  }
  return deltas;
}

/**
 * One poll per delta on frames whose `position` does NOT advance — the shape a
 * poll clock drifting against the daemon's own update clock produces, where the
 * daemon hands the same observation over a second time. A delta of 0 therefore
 * builds a frame identical to the one before it; a non-zero delta builds one
 * that repeats only the position.
 *
 * @param {number[]} deltas
 * @param {Record<string, unknown>} [fields]
 * @returns {number[]}
 */
export function stall(deltas, fields = {}) {
  for (const d of deltas) {
    counter += d;
    emit(fields);
  }
  return deltas;
}

/**
 * A fresh track, then one poll per delta.
 *
 * @param {number[]} deltas
 * @param {Record<string, unknown>} [fields]
 * @returns {number[]}
 */
export function feed(deltas, fields = {}) {
  newTrack(fields);
  return append(deltas, fields);
}
