// The poll seam the apodizing-history suites are driven through, shared by the
// store suite (tests/js/store/apodhistory.test.js) and the strip's render suite
// (tests/js/components/enginehealth-strip.test.js).
//
// A poll is a FRESH object written to engineStatus carrying the daemon's own
// Status fields — state, track_serial and the monotonic apodizing counter
// `apod` (`state` values per docs/protocol.md: 0 stopped, 1 paused, 2 playing,
// 3 stop requested). Writing the SAME object reference does not notify, so every
// simulated poll builds a new one.
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
  engineStatus.value = {
    status: { state: PLAYING, track_serial: String(serial), apod: String(counter), ...fields },
  };
}

/**
 * The daemon moves on to a new track.
 *
 * @param {Record<string, unknown>} [fields]
 */
export function newTrack(fields = {}) {
  serial += 1;
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
