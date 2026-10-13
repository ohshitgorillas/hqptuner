// The three areas whose failures the unread-error suites raise on the plate: the apply lane, a live write and the live
// snapshots. Each area is reached through the store's own exported verb over the wire in
// tests/js/support/wire/unreadwire.js: a failure sets that wire's table to the failure, calls the verb and waits for
// the wire to go quiet; a success does the same on a table answering success. No store function is stubbed.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { applyAll } from "../../../hqptuner/static/store/actions.js";
import { writeLive } from "../../../hqptuner/static/store/live/write.js";
import { applyLivePreset, bookWanted } from "../../../hqptuner/static/store/live/presets.js";
import { quiesce } from "./wire/wire.js";
import { outcome, allSucceed, SNAPSHOT, LIVE_FIELD, LIVE_VALUE } from "./wire/unreadwire.js";

/** @typedef {import("./wire/wire.js").StagingWire} StagingWire */
/** @typedef {"apply" | "live" | "snapshot" | "list"} Area */

/**
 * Each area's verb, called once and settled; a rejection is the area's own business, and what it leaves behind is the
 * suite's question.
 *
 * @type {Record<Area, () => Promise<unknown>>}
 */
const VERBS = {
  apply: () => applyAll(),
  live: () => writeLive(LIVE_FIELD, LIVE_VALUE),
  snapshot: () => applyLivePreset(SNAPSHOT),
  list: async () => {
    bookWanted.value = false;
    await Promise.resolve();
    bookWanted.value = true;
  },
};

/**
 * Run one area's verb over the wire with that area answering `answer`, then answer success everywhere again.
 *
 * @param {StagingWire} wire
 * @param {Area} area
 * @param {string} answer
 */
async function run(wire, area, answer) {
  Object.assign(outcome, { [area]: answer });
  await VERBS[area]().catch(() => undefined);
  await quiesce(wire);
  allSucceed();
}

/**
 * The failures the suites raise, by name: the area each fails in and the answer it fails with.
 *
 * @type {Record<string, { area: Area, answer: string }>}
 */
export const FAILURES = {
  a_failed_apply: { area: "apply", answer: "refused" },
  a_live_write_that_threw: { area: "live", answer: "threw" },
  a_live_write_hqplayer_refused: { area: "live", answer: "refused" },
  a_failed_snapshot_apply: { area: "snapshot", answer: "refused" },
  a_failed_snapshot_list: { area: "list", answer: "refused" },
};

/**
 * Fail one area the way `FAILURES[name]` names.
 *
 * @param {StagingWire} wire
 * @param {string} name
 */
export const fail = (wire, name) => run(wire, FAILURES[name].area, FAILURES[name].answer);

/**
 * Run one area's verb to success.
 *
 * @param {StagingWire} wire
 * @param {Area} area
 */
export const succeed = (wire, area) => run(wire, area, "ok");

/**
 * Run every area's verb to success, so a suite starts with no area's failure outstanding.
 *
 * @param {StagingWire} wire
 */
export async function succeedEverywhere(wire) {
  for (const area of /** @type {Area[]} */ (["apply", "live", "snapshot", "list"])) await succeed(wire, area);
}
