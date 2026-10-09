// Rendered suite for the state upload in the About HQPTuner section of
// hqptuner/static/components/faceplate/settings/About.js: choosing a state file posts it to POST /api/state-import, the
// section reports the import while it runs and once it lands, a landed import reads the station list again, and a
// refusal reads by its code.
//
// Driven at the wire: a fetch fake answers the real REST paths and records every request, and no store function is
// stubbed. The upload's change is fired through the renderer's vnode seam, since render-to-string fires no events; the
// control is located by `data-testid="state-import"`. The section's wording is owner copy (docs/testing.md rule 9), so
// a status is read as the whole page's text and compared with the page in another state, never with a literal. Refusal
// details and station names are the fixture's own wire data.
//
// The status is written only from the upload's handler and persists for the life of this file, so the page as it reads
// before any import is captured once, at load. The station-list case runs last, since it moves the config.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/about-state-import.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { About } from "../../../../hqptuner/static/components/faceplate/settings/About.js";
import { health, config } from "../../../../hqptuner/static/store/signals.js";
import { liveMode } from "../../../../hqptuner/static/store/ui/prefs.js";
import { liveBook, bookWanted } from "../../../../hqptuner/static/store/live/presets.js";
import { stationTree, unfolded } from "../../../../hqptuner/static/store/faceplate/stations.js";
import { text } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";
import { ok } from "../../support/wire/wire.js";

/** @typedef {import("../../support/wire/wire.js").FakeResponse} FakeResponse */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** @type {{ path: string, method: string, body: unknown }[]} */
const CALLS = [];

const PAYLOAD = {
  reachable: true,
  info: { product: "Signalyst HQPlayer Embedded", engine: "6.0.4", platform: "Linux" },
  release: "6.0.2",
  app_version: "9.8.7",
};

const STATIONS_BEFORE = ["Attic", "Porch"];
const STATIONS_IMPORTED = ["Den", "Kitchen", "Study"];

const DETAIL = "fixture refusal 7f3a";
const OTHER_CODE = "invalid_input";

/**
 * A config as /api/config serves it, offering the "(no preset)" entry and the named presets given.
 *
 * @param {string[]} names
 */
const offering = (names) => ({
  fields: [],
  file: {},
  active: "",
  profiles: { value: "", options: [{ value: "", label: "" }, ...names.map((n) => ({ value: n, label: n }))] },
});

/**
 * A refusal in the REST API's shape: a sentence in `detail`, the identifier a client acts on in `code`.
 *
 * @param {number} status
 * @param {string} code
 * @returns {FakeResponse}
 */
const refused = (status, code) => ({ ok: false, status, json: async () => ({ detail: DETAIL, code }) });

/** What POST /api/state-import answers; a function, so a case can hold the answer back. */
let importAnswer = async () => ok({ ok: true });

/** The station names the server holds, as /api/config and /api/livepresets serve them. */
let serverStations = STATIONS_BEFORE;

/** @type {Set<Promise<FakeResponse>>} */
const inflight = new Set();

/**
 * @param {string} path
 * @returns {Promise<FakeResponse>}
 */
async function answer(path) {
  if (path === "/api/state-import") return importAnswer();
  if (path === "/api/health") return ok({ ...PAYLOAD });
  if (path === "/api/config") return ok({ data: offering(serverStations) });
  if (path === "/api/livepresets") {
    return ok({ station: "", presets: [], stations: Object.fromEntries(["", ...serverStations].map((s) => [s, {}])) });
  }
  if (path === "/api/config/pending" || path === "/api/config/stage") return ok({ live: {}, http: {} });
  return ok({});
}

function wire() {
  env.fetch = (/** @type {string} */ path, /** @type {{ method?: string, body?: unknown }} */ opts = {}) => {
    CALLS.push({ path, method: opts.method || "GET", body: opts.body });
    const req = answer(path);
    inflight.add(req);
    req.then(
      () => inflight.delete(req),
      () => inflight.delete(req),
    );
    return req;
  };
}

/** Event-loop turns until every request the fake was handed is answered and nothing new is fired. */
async function settle() {
  for (let turn = 0; turn < 100; turn += 1) {
    await Promise.allSettled([...inflight]);
    await new Promise((resolve) => setImmediate(resolve));
    if (inflight.size === 0) return;
  }
  throw new Error(`wire never went quiet: ${inflight.size} request(s) outstanding`);
}

/** The whole page's text as it renders now. */
const page = () => text({ name: "", attrs: "", start: 0, html: render(html`<${About} />`) });

health.value = { ...PAYLOAD };
const PAGE_BEFORE_ANY_IMPORT = page();

beforeEach(() => {
  health.value = { ...PAYLOAD };
  bookWanted.value = false;
  liveMode.value = false;
  liveBook.value = {};
  unfolded.value = null;
  serverStations = STATIONS_BEFORE;
  config.value = offering(STATIONS_BEFORE);
  importAnswer = async () => ok({ ok: true });
  inflight.clear();
  CALLS.length = 0;
  wire();
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

/** The state upload's change handler, or a no-op when the page draws no state upload. */
function onChange() {
  const { seen } = renderTree(html`<${About} />`);
  const fn = seen.find((v) => v.props["data-testid"] === "state-import")?.props.onChange;
  return typeof fn === "function" ? /** @type {(e: unknown) => unknown} */ (fn) : async () => undefined;
}

/** Choose one file on the state upload and wait for the import, and whatever it fires, to settle. */
async function upload(/** @type {File} */ file) {
  await onChange()({ target: { files: [file], value: "" } });
  await settle();
}

/** The page's text after a refused import carrying a code. */
async function pageAfterRefusal(/** @type {number} */ status, /** @type {string} */ code) {
  importAnswer = async () => refused(status, code);
  await upload(stateZip());
  return page();
}

/**
 * The page's text at three moments of one successful import: before it, while the server holds its answer back, and
 * once it has landed.
 */
async function pagesAcrossASuccessfulImport() {
  const before = page();
  /** @type {(r: FakeResponse) => void} */
  let release = () => {};
  importAnswer = () => new Promise((resolve) => (release = resolve));
  const done = onChange()({ target: { files: [stateZip()], value: "" } });
  await new Promise((resolve) => setImmediate(resolve));
  const during = page();
  release(ok({ ok: true }));
  await done;
  await settle();
  return { before, during, after: page() };
}

const stateZip = () => new File([new Uint8Array(8)], "hqptuner-state.zip");

test("test_a_chosen_state_file_is_posted_to_the_state_import_route_as_statefile", async () => {
  const file = stateZip();
  await upload(file);
  assert.deepEqual(
    CALLS.filter((c) => c.method === "POST" && c.path === "/api/state-import").map((c) =>
      c.body instanceof FormData ? c.body.get("statefile") : null,
    ),
    [file],
  );
});

test("test_the_page_reads_differently_while_an_import_runs_than_before_any_import", async () => {
  const { during } = await pagesAcrossASuccessfulImport();
  assert.notEqual(during, PAGE_BEFORE_ANY_IMPORT);
});

test("test_a_landed_import_reads_neither_as_still_running_nor_as_no_import", async () => {
  const { during, after } = await pagesAcrossASuccessfulImport();
  assert.equal([during, PAGE_BEFORE_ANY_IMPORT].includes(after), false);
});

test("test_an_unreadable_state_file_reads_differently_from_a_refusal_with_another_code", async () => {
  const unreadable = await pageAfterRefusal(422, "state_unreadable");
  const other = await pageAfterRefusal(422, OTHER_CODE);
  assert.notEqual(unreadable, other);
});

test("test_a_state_file_from_a_newer_hqptuner_reads_differently_from_a_refusal_with_another_code", async () => {
  const tooNew = await pageAfterRefusal(409, "state_too_new");
  const other = await pageAfterRefusal(409, OTHER_CODE);
  assert.notEqual(tooNew, other);
});

test("test_an_unreadable_state_file_reads_differently_from_one_too_new", async () => {
  const unreadable = await pageAfterRefusal(422, "state_unreadable");
  const tooNew = await pageAfterRefusal(422, "state_too_new");
  assert.notEqual(unreadable, tooNew);
});

test("test_a_refusal_with_any_other_code_prints_the_servers_reason", async () => {
  const shown = await pageAfterRefusal(422, OTHER_CODE);
  assert.equal(shown.includes(DETAIL), true);
});

test("test_a_landed_import_reads_the_station_list_again_from_the_server", async () => {
  serverStations = STATIONS_IMPORTED;
  await upload(stateZip());
  assert.deepEqual(
    stationTree().map((/** @type {{ name: string }} */ s) => s.name),
    STATIONS_IMPORTED,
  );
});
