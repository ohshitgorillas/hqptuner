// The wire the unread-error suites drive three areas over: the apply lane (POST /api/config/apply), the live lane
// (POST /api/config/live) and the live snapshots (GET /api/livepresets, POST /api/livepresets/{name}/apply). Each area
// answers from this module's table, `outcome`, which a suite sets before it calls the area's verb: a success in the
// real shape, or one of the failures the real backend answers. The reads around them (/api/state, /api/enumerations,
// /api/config, /api/matrix) answer the same payload every time, so an area's re-read after a write moves nothing a
// suite reads beside the area itself. Built on `stagingWire`, so the staging reads ride their real paths and the
// suites wait on `quiesce` rather than on a stopwatch.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { stagingWire, ok, bad } from "./wire.js";

/** @typedef {import("./wire.js").StagingWire} StagingWire */
/** @typedef {import("./wire.js").FakeResponse} FakeResponse */

/** The snapshot the suites apply, by name, as the book holds it. */
export const SNAPSHOT = "Den";

/** The live control the suites write, and the enum ID they write to it. */
export const LIVE_FIELD = "filter";
export const LIVE_VALUE = "40";

/** The status the apply lane is refused with, and its `detail`, both the fixture's own. */
const APPLY_REFUSAL = 503;
const APPLY_DETAIL = "the config file could not be written";

/** A live write the daemon never answered: a 503 with FastAPI's `detail` string. */
const LIVE_STALL = 503;
const LIVE_STALL_DETAIL = "SetFilter: no reply within 5.0s";

/** A live setting the daemon refused inside a 200 report. */
const LIVE_REASON = "invalid filter";

/** A snapshot apply refused outright: a 409 whose `detail` is per field. */
const SNAPSHOT_REFUSAL = 409;
const SNAPSHOT_DETAIL = { filter1x: "the pcm chain is not loaded (engine chain: sdm)" };

/** A snapshot list the backend could not read. */
const LIST_REFUSAL = 500;
const LIST_DETAIL = "the snapshot store is unreadable";

/**
 * How each area answers its next request.
 *
 * @type {{ apply: "ok" | "refused", live: "ok" | "threw" | "refused", snapshot: "ok" | "refused", list: "ok" | "refused" }}
 */
export const outcome = { apply: "ok", live: "ok", snapshot: "ok", list: "ok" };

/** Every area answering success again. */
export function allSucceed() {
  Object.assign(outcome, { apply: "ok", live: "ok", snapshot: "ok", list: "ok" });
}

/** The engine's state, as /api/state carries it in its frame. */
export const STATE = () => ({
  mode: "1",
  filter1x: "1",
  filterNx: "1",
  shaper: "0",
  rate: "0",
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: "pcm",
});

/** The enumerations, each item's index differing from its value. */
export const ENUMS = () => ({
  filters: [
    { index: "0", value: "0", name: "none" },
    { index: "1", value: "40", name: "poly-sinc-gauss-long" },
  ],
  shapers: [{ index: "0", value: "0", name: "none" }],
  rates: [{ index: "0", rate: "0" }],
  junk_filters: [{ index: "0", value: "0", name: "none" }],
  mode: { name: "PCM" },
});

/** The config form, as /api/config carries it. */
export const CONFIG = () => ({
  fields: [],
  file: { mode: "pcm" },
  active: "Day",
  profiles: { value: "Day", options: ["", "Day"].map((n) => ({ value: n, label: n })) },
});

/** The snapshot as GET /api/livepresets lists it. */
const RECORD = () => ({
  name: SNAPSHOT,
  chain: "pcm",
  fields: { mode: "pcm", filter1x: "40", rate: "0" },
  names: { mode: "PCM", filter1x: "poly-sinc-gauss-long" },
});

/** The book as the live snapshot store holds it: station, then name, then record. */
export const BOOK = () => {
  const { name, ...record } = RECORD();
  return { Day: { [name]: record } };
};

/** @returns {FakeResponse} */
function live() {
  if (outcome.live === "threw") return bad(LIVE_STALL, LIVE_STALL_DETAIL);
  const verified = outcome.live === "ok";
  const entry = verified
    ? { setting: LIVE_FIELD, ok: true }
    : { setting: LIVE_FIELD, ok: false, code: "daemon_refused", error: LIVE_REASON };
  return ok({ report: { live: [entry] } });
}

/** @returns {FakeResponse} */
function snapshotApply() {
  if (outcome.snapshot === "refused") return bad(SNAPSHOT_REFUSAL, SNAPSHOT_DETAIL);
  return ok({ report: { live: [{ setting: "filter1x", ok: true }], stored: {} } });
}

/** @returns {FakeResponse} */
function list() {
  if (outcome.list === "refused") return bad(LIST_REFUSAL, LIST_DETAIL);
  return ok({ station: "Day", presets: [RECORD()], stations: BOOK() });
}

/** @type {Record<string, () => FakeResponse>} */
const TABLE = {
  "/api/config/live": live,
  [`/api/livepresets/${SNAPSHOT}/apply`]: snapshotApply,
  "/api/livepresets": list,
  "/api/state": () => ok({ stale: false, loaded_at: 1, data: STATE() }),
  "/api/enumerations": () => ok({ data: ENUMS() }),
  "/api/config": () => ok({ data: CONFIG() }),
  "/api/matrix": () => ok({ data: { fields: [] } }),
};

/**
 * Install the wire, every area answering success.
 *
 * @returns {StagingWire}
 */
export function unreadWire() {
  allSucceed();
  return stagingWire({
    routes: (path) => {
      const bare = path.split("?")[0];
      if (bare === "/api/config/apply" && outcome.apply === "refused") return bad(APPLY_REFUSAL, APPLY_DETAIL);
      const answer = TABLE[bare];
      return answer ? answer() : undefined;
    },
  });
}
