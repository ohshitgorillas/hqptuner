// Behavioral suite for store/live/write.js's re-mirror under overlap: two
// remirrorLive calls in flight at once, the first one's reads answering last.
// The engine's State is whatever the most recent read of it said, so a page that
// asked twice shows the second answer, never the first one arriving late.
//
// Fakes go at the wire only (docs/testing.md rule 4): globalThis.fetch answers
// /api/state and /api/enumerations on the real REST paths with the shapes they
// serve. Each answer carries the State the engine held when the request was
// made, and a request made while the first call is outstanding is held until
// the second call has had every turn it needs. Waits are event-loop turns, never
// a duration (rule 7).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/remirror.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { engineState, enums, config } from "../../../../hqptuner/static/store/signals.js";
import { liveErrors, liveBusy } from "../../../../hqptuner/static/store/live/state.js";
import { remirrorLive } from "../../../../hqptuner/static/store/live/write.js";
import { ok } from "../../support/wire/wire.js";

const FILTERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "40", name: "poly-sinc-gauss-long" },
  { index: "2", value: "25", name: "sinc-M" },
];
const SHAPERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "31", name: "TPDF" },
];
const RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "96000" },
];
const JUNK = [{ index: "0", value: "0", name: "none" }];

const ENUMS = () => ({ filters: FILTERS, shapers: SHAPERS, rates: RATES, junk_filters: JUNK, mode: { name: "PCM" } });

/** @param {string} filterNx */
const stateWith = (filterNx) => ({
  mode: "1",
  filter1x: "1",
  filterNx,
  shaper: "1",
  rate: "1",
  filter_junk: "0",
  adaptive: "0",
  active_chain: "pcm",
});

// Three distinct filterNx indices: what the page held before, what the engine
// answered the first call, what it answered the second.
const SEEDED_FILTER = "2";
const FIRST_FILTER = "0";
const SECOND_FILTER = "1";

// The fields the write landed: filter is one that rebuilds the engine's menus,
// so the re-mirror reads the enumerations as well as the State.
const WRITTEN = () => ["filter"];

/**
 * The global fetch this suite fakes, viewed as an optional member.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

const TURNS = 10;
const settle = async () => {
  for (let turn = 0; turn < TURNS; turn += 1) await new Promise((resolve) => setImmediate(resolve));
};

/**
 * A daemon whose answer depends on when it was asked. While `held` is true a
 * read of /api/state or /api/enumerations is parked and later answers the first
 * State; once `held` is false it answers the second State at once. Every read
 * of /api/enumerations answers `served`, the menus the engine holds. Every path
 * asked is recorded on `asked`, so a read that never reached the wire is observable.
 *
 * @param {{ served?: ReturnType<typeof ENUMS> }} [opts]
 */
function overlapWire({ served = ENUMS() } = {}) {
  /** @type {{ held: boolean, parked: (() => void)[], asked: string[] }} */
  const w = { held: true, parked: [], asked: [] };
  env.fetch = async (/** @type {string} */ path) => {
    w.asked.push(path);
    if (path === "/api/state" || path === "/api/enumerations") {
      const filterNx = w.held ? FIRST_FILTER : SECOND_FILTER;
      if (w.held) await new Promise((resolve) => w.parked.push(() => resolve(undefined)));
      return ok({ data: path === "/api/state" ? stateWith(filterNx) : served });
    }
    if (path === "/api/config") return ok({ data: { fields: [], file: {}, active: "", profiles: null } });
    if (path === "/api/config/pending") return ok({ live: {}, http: {} });
    return ok({});
  };
  return w;
}

test("test_overlapping_remirrors_end_on_the_second_calls_state_when_the_first_answers_last", async () => {
  engineState.value = stateWith(SEEDED_FILTER);
  enums.value = ENUMS();
  config.value = { fields: [], file: {}, active: "", profiles: null };
  liveErrors.value = {};
  liveBusy.value = "";
  const w = overlapWire();

  const first = remirrorLive(WRITTEN());
  await settle();
  w.held = false;
  const second = remirrorLive(WRITTEN());
  await settle();
  for (const release of w.parked) release();
  await Promise.all([first, second]);
  await settle();

  assert.equal(engineState.value.filterNx, SECOND_FILTER);
});

// The menus the engine serves once the mode write has landed: a different mode
// and a filter list the seeded page never held.
const SWITCHED_MODE = "SDM";
const MODE_FILTERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "64", name: "poly-sinc-ext2" },
];
const MODE_ENUMS = () => ({ ...ENUMS(), filters: MODE_FILTERS, mode: { name: SWITCHED_MODE } });

// A mode write rebuilds the engine's menus and moves its rate limits; a volume
// write does neither.
const MODE_WRITTEN = () => ["mode"];
const VOLUME_WRITTEN = () => ["volume"];

/**
 * Seeds the page as it stood before the mode write, then runs a mode re-mirror
 * overlapped by a volume re-mirror whose reads answer first, releasing the mode
 * call's reads last.
 *
 * @returns {Promise<ReturnType<typeof overlapWire>>}
 */
async function overlapModeByVolume() {
  engineState.value = stateWith(SEEDED_FILTER);
  enums.value = ENUMS();
  config.value = { fields: [], file: {}, active: "", profiles: null };
  liveErrors.value = {};
  liveBusy.value = "";
  const w = overlapWire({ served: MODE_ENUMS() });

  const first = remirrorLive(MODE_WRITTEN());
  await settle();
  w.held = false;
  const second = remirrorLive(VOLUME_WRITTEN());
  await settle();
  for (const release of w.parked) release();
  await Promise.all([first, second]);
  await settle();
  return w;
}

test("test_mode_remirror_answering_last_still_lands_the_menus_served_after_the_mode_write", async () => {
  await overlapModeByVolume();

  assert.equal(enums.value.mode.name, SWITCHED_MODE);
});

test("test_mode_remirror_answering_last_still_reads_the_config_for_its_rate_limits", async () => {
  const w = await overlapModeByVolume();

  assert.ok(w.asked.includes("/api/config"), `paths that reached the wire: ${w.asked.join(", ")}`);
});
