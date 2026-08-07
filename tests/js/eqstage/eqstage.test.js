// Behavioral suite for scripts/eqstage — the CLI that stages EQ changes into
// HQPTuner's server-side pending buffer. Written blind from a spec block: no
// eqstage source was read, and none existed when this was written.
//
// The wire fake below speaks the real REST shapes (docs/testing.md rule 4):
// GET /api/config, GET /api/matrix, POST /api/config/stage and
// GET /api/config/pending. The pending buffer it serves is built only by real
// stage POSTs — including the "someone else staged first" case, which is a
// second stage POST through the same path, never a doctored echo.
//
// Known gap: the file-backed eq sources ({from:"parametric_eq"} /
// {from:"snapshot"}) need fixtures on disk and are not covered here.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqstage/eqstage.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { runJob } from "../../../scripts/eqstage/eqstage.js";
import { near } from "../support/eqlab-helpers.js";

// --- fixtures -------------------------------------------------------------------

/**
 * @typedef {import("../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow
 * @typedef {import("../../../scripts/eqstage/eqstage.js").Job} Job
 * @typedef {import("../../../scripts/eqstage/eqstage.js").Report} Report
 * @typedef {import("../../../scripts/eqstage/post.js").StagePayload} StagePayload
 * @typedef {import("../../../scripts/eqstage/post.js").FetchImpl} FetchImpl
 */

const URL_BASE = "http://127.0.0.1:8090";

// Canonical row JSON: keys in order gain,gainunit,mixdown,process,source, every
// value a string, compact separators.
/**
 * @param {PipelineRow} row
 * @returns {string}
 */
const canonicalRow = (row) =>
  JSON.stringify({
    gain: String(row.gain),
    gainunit: String(row.gainunit),
    mixdown: String(row.mixdown),
    process: String(row.process),
    source: String(row.source),
  });

/**
 * @param {PipelineRow[]} rows
 * @returns {string}
 */
const canonicalRows = (rows) => `[${rows.map(canonicalRow).join(",")}]`;

const LP1_PLUS_PEAK = "iir:type=lp1;f=700,iir:type=peak;f=100;q=1;g=-2";

/** @type {PipelineRow[]} */
const ROWS = [
  { source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: LP1_PLUS_PEAK },
  { source: "1", gain: "0", gainunit: "dB", mixdown: "0", process: "iir:type=peak;f=200;q=1;g=1" },
];

// The band every test stages, chosen not to collide with anything in ROWS.
const NEW_BAND = { type: "peak", f: 5000, q: 2, g: -4 };
const EQ = { bands: [NEW_BAND] };

/**
 * @param {PipelineRow[]} rows
 * @param {number} index
 * @param {Partial<PipelineRow>} patch
 * @returns {PipelineRow[]}
 */
const withRow = (rows, index, patch) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r));

// A baseline that is NOT already canonical: keys in a different order and
// numbers left as numbers. The daemon's own config value is whatever was last
// written to it, so the tool has to canonicalise rather than pass through.
const SCRAMBLED_BASELINE = JSON.stringify([
  { process: LP1_PLUS_PEAK, source: 0, mixdown: 0, gainunit: "dB", gain: 0 },
  { mixdown: 0, gain: 0, source: 1, process: "iir:type=peak;f=200;q=1;g=1", gainunit: "dB" },
]);

// --- wire fake ------------------------------------------------------------------

/**
 * A response as this fake serves one: the four members the tool reads.
 *
 * @typedef {{ ok: boolean, status: number, statusText: string, json: () => Promise<unknown> }} FakeResponse
 */

/**
 * The log one run leaves behind: the requests it made, and the buffer they built.
 *
 * @typedef {{ calls: { path: string, method: string, body: unknown }[], pending: StagePayload }} WireLog
 */

/**
 * A wire fake, ready to be injected.
 *
 * @typedef {{ w: WireLog, fetch: FetchImpl }} Wire
 */

// The tool's declared fetch answers with a real Response, which this fake does
// not build; it is handed over as the injected implementation all the same.
/**
 * @param {(url: string, init?: RequestInit) => Promise<FakeResponse>} f
 * @returns {FetchImpl}
 */
const asFetch = (f) => /** @type {FetchImpl} */ (/** @type {unknown} */ (f));

/**
 * @param {unknown} body
 * @returns {FakeResponse}
 */
const ok = (body) => ({ ok: true, status: 200, statusText: "OK", json: async () => body });
/**
 * @param {number} status
 * @returns {FakeResponse}
 */
const bad = (status) => ({
  ok: false,
  status,
  statusText: "Internal Server Error",
  json: async () => ({ detail: "no config" }),
});

// `externalStage` models another client POSTing to /api/config/stage between our
// POST and our verify read: it goes through the same stage() the fake serves on
// the wire, so the pending buffer is always a real product of real frames.
/**
 * @param {{ rows?: PipelineRow[], configStatus?: number,
 *   externalStage?: StagePayload | null, raw?: string | null }} [options]
 * @returns {Wire}
 */
function stageWire({ rows = ROWS, configStatus = 200, externalStage = null, raw = null } = {}) {
  /** @type {WireLog} */
  const w = { calls: [], pending: { live: {}, http: {} } };
  /**
   * @param {StagePayload} body
   * @returns {StagePayload}
   */
  const stage = (body) => {
    w.pending = {
      live: { ...w.pending.live, ...body.live },
      http: { ...w.pending.http, ...body.http },
    };
    return w.pending;
  };
  let raced = false;
  const readPending = () => {
    if (externalStage && !raced) {
      raced = true;
      stage(externalStage);
    }
    return ok(w.pending);
  };
  /** @type {Record<string, (init: RequestInit) => FakeResponse>} */
  const routes = {
    "GET /api/config": () =>
      configStatus === 200
        ? ok({ data: { file: { matrix_pipelines: raw === null ? canonicalRows(rows) : raw } } })
        : bad(configStatus),
    "GET /api/matrix": () =>
      ok({ data: { rows: rows.map((r, index) => ({ index, ...r })), loaded_at: 0, stale: false } }),
    "POST /api/config/stage": (init) => ok(stage(JSON.parse(String(init.body)))),
    "GET /api/config/pending": readPending,
  };
  /**
   * @param {string} url
   * @param {RequestInit} [init]
   * @returns {Promise<FakeResponse>}
   */
  const fetch = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const path = new globalThis.URL(String(url)).pathname;
    w.calls.push({ path, method, body: init.body });
    const route = routes[`${method} ${path}`];
    return route ? route(init) : bad(404);
  };
  return { w, fetch: asFetch(fetch) };
}

/**
 * @param {WireLog} w
 * @returns {WireLog["calls"]}
 */
const posts = (w) => w.calls.filter((c) => c.method === "POST");

// Swallows the documented rejection but never a resolution: a run that succeeds
// fails the test here rather than passing on a vacuously empty POST count.
/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<void>}
 */
const rejected = (promise) =>
  promise.then(
    () => {
      throw new Error("expected runJob to reject");
    },
    () => {},
  );

// --- helpers on the answer ------------------------------------------------------

// The buffer passes every field through as an opaque value; this one is the
// pipeline JSON the tool wrote into it.
/**
 * @param {Report} answer
 * @returns {string}
 */
const stagedPipelines = (answer) => String(answer.staged.http.matrix_pipelines);

/**
 * @param {Report} answer
 * @returns {PipelineRow[]}
 */
const stagedRows = (answer) => JSON.parse(stagedPipelines(answer));

// A stage as the process string carries it: "iir:type=peak;f=5000;q=2;g=-4".
/**
 * @param {string} process
 * @returns {Record<string, string>[]}
 */
const parseStages = (process) =>
  String(process)
    .split(",")
    .filter((s) => s.length > 0)
    .map((s) => {
      /** @type {Record<string, string>} */
      const args = {};
      for (const pair of s.replace(/^iir:/, "").split(";")) {
        const [k, v] = pair.split("=");
        args[k] = v;
      }
      return args;
    });

// Format-agnostic: matches on the numeric value of f, so "700" and "700.0" both
// count as the same stage.
/**
 * @param {string} process
 * @param {string} type
 * @param {number} f
 * @returns {boolean}
 */
const hasStage = (process, type, f) => parseStages(process).some((a) => a.type === type && Number(a.f) === f);

/**
 * @param {string} process
 * @param {number} f
 * @returns {Record<string, string>}
 */
const stageAt = (process, f) => parseStages(process).find((a) => Number(a.f) === f) || {};

/**
 * @param {Partial<Job>} job
 * @param {Wire} wire
 * @returns {Promise<Report>}
 */
const run = async (job, wire) => runJob({ url: URL_BASE, eq: EQ, ...job }, { fetch: wire.fetch });

// --- the POST itself ------------------------------------------------------------

test("test_the_staged_pipelines_are_the_ones_actually_posted_to_the_daemon", async () => {
  const wire = stageWire();
  const answer = await run({ rows: [0] }, wire);
  assert.equal(JSON.parse(String(posts(wire.w)[0].body)).http.matrix_pipelines, stagedPipelines(answer));
});

// --- untouched rows -------------------------------------------------------------

test("test_a_row_outside_the_selection_is_staged_byte_identical_to_its_baseline", async () => {
  const wire = stageWire();
  const answer = await run({ rows: [0] }, wire);
  assert.equal(stagedPipelines(answer).includes(canonicalRow(ROWS[1])), true);
});

// --- canonical form -------------------------------------------------------------

test("test_every_staged_row_carries_its_keys_in_canonical_order", async () => {
  const wire = stageWire({ raw: SCRAMBLED_BASELINE });
  const answer = await run({ rows: [0] }, wire);
  assert.deepEqual(
    stagedRows(answer).map((r) => Object.keys(r).join(",")),
    ["gain,gainunit,mixdown,process,source", "gain,gainunit,mixdown,process,source"],
  );
});

test("test_every_value_in_a_staged_row_is_a_string", async () => {
  const wire = stageWire({ raw: SCRAMBLED_BASELINE });
  const answer = await run({ rows: [0] }, wire);
  const rows = stagedRows(answer);
  assert.deepEqual(
    rows.flatMap((r) => Object.values(r).map((v) => typeof v)),
    Array(rows.length * 5).fill("string"),
  );
});

// --- replace_tail / append ------------------------------------------------------

test("test_replace_tail_keeps_the_leading_crossfeed_stage", async () => {
  const wire = stageWire();
  const answer = await run({ rows: [0], mode: "replace_tail" }, wire);
  assert.equal(hasStage(stagedRows(answer)[0].process, "lp1", 700), true);
});

test("test_replace_tail_drops_the_old_eq_band_from_the_tail", async () => {
  const wire = stageWire();
  const answer = await run({ rows: [0], mode: "replace_tail" }, wire);
  assert.equal(hasStage(stagedRows(answer)[0].process, "peak", 100), false);
});

test("test_append_keeps_both_original_stages_and_adds_the_new_band", async () => {
  const wire = stageWire();
  const answer = await run({ rows: [0], mode: "append" }, wire);
  const process = stagedRows(answer)[0].process;
  assert.deepEqual(
    [hasStage(process, "lp1", 700), hasStage(process, "peak", 100), hasStage(process, "peak", 5000)],
    [true, true, true],
  );
});

test("test_the_new_band_is_staged_with_the_q_and_gain_it_was_given", async () => {
  const wire = stageWire();
  const answer = await run({ rows: [0], mode: "replace_tail" }, wire);
  const staged = stageAt(stagedRows(answer)[0].process, 5000);
  assert.deepEqual([Number(staged.q), Number(staged.g)], [2, -4]);
});

// --- preamp ---------------------------------------------------------------------

test("test_a_preamp_sets_the_selected_rows_gain", async () => {
  const wire = stageWire();
  const answer = await run({ rows: [0], preamp_db: -3.0 }, wire);
  assert.equal(stagedRows(answer)[0].gain, "-3.0");
});

test("test_a_preamp_sets_the_selected_rows_gain_unit_to_decibels", async () => {
  const wire = stageWire();
  const answer = await run({ rows: [0], preamp_db: -3.0 }, wire);
  assert.equal(stagedRows(answer)[0].gainunit, "dB");
});

test("test_a_preamp_on_a_linear_gain_row_is_rejected_for_its_gain_unit", async () => {
  const wire = stageWire({ rows: withRow(ROWS, 0, { gainunit: "Lin" }) });
  await assert.rejects(() => run({ rows: [0], preamp_db: -3.0 }, wire), /gainunit|\blin\b/i);
});

test("test_a_preamp_on_a_linear_gain_row_stages_nothing", async () => {
  const wire = stageWire({ rows: withRow(ROWS, 0, { gainunit: "Lin" }) });
  await rejected(run({ rows: [0], preamp_db: -3.0 }, wire));
  assert.deepEqual(posts(wire.w), []);
});

// The response of a lone +6 dB peak tops out at +6 dB, so auto preamp is -6.
test("test_an_auto_preamp_stages_the_negated_peak_of_the_summed_response", async () => {
  const wire = stageWire({ rows: withRow(ROWS, 0, { process: "iir:type=peak;f=100;q=1;g=-2" }) });
  const answer = await run(
    { rows: [0], mode: "replace_tail", preamp_db: "auto", eq: { bands: [{ type: "peak", f: 1000, q: 1, g: 6 }] } },
    wire,
  );
  assert.ok(...near(Number(stagedRows(answer)[0].gain), -6, 0.2));
});

test("test_forcing_the_gain_unit_stages_a_linear_gain_row_in_decibels", async () => {
  const wire = stageWire({ rows: withRow(ROWS, 0, { gainunit: "Lin" }) });
  const answer = await run({ rows: [0], preamp_db: -3.0, force_gainunit: true }, wire);
  assert.equal(stagedRows(answer)[0].gainunit, "dB");
});

// --- baseline validation --------------------------------------------------------

test("test_a_baseline_row_with_an_out_of_range_source_is_rejected_for_its_source", async () => {
  const wire = stageWire({ rows: withRow(ROWS, 0, { source: "999" }) });
  await assert.rejects(() => run({ rows: [0] }, wire), /source/i);
});

// --- dry run --------------------------------------------------------------------

test("test_a_dry_run_stages_nothing", async () => {
  const wire = stageWire();
  await run({ rows: [0], dry_run: true }, wire);
  assert.deepEqual(posts(wire.w), []);
});

test("test_a_dry_run_still_returns_the_payload_it_would_have_sent", async () => {
  const wire = stageWire();
  const answer = await run({ rows: [0], dry_run: true }, wire);
  assert.equal(hasStage(stagedRows(answer)[0].process, "peak", 5000), true);
});

// --- verification ---------------------------------------------------------------

test("test_a_pending_buffer_that_differs_from_what_was_sent_is_rejected_for_the_disagreement", async () => {
  const wire = stageWire({ externalStage: { live: {}, http: { matrix_pipelines: canonicalRows([ROWS[1]]) } } });
  await assert.rejects(() => run({ rows: [0] }, wire), /pending|verif|match|differ|disagree/i);
});

// --- baseline source ------------------------------------------------------------

test("test_an_unreadable_config_falls_back_to_the_matrix_endpoint_for_the_baseline", async () => {
  const wire = stageWire({ configStatus: 500 });
  const answer = await run({ rows: [0] }, wire);
  assert.equal(answer.baseline_source, "matrix");
});

test("test_a_matrix_derived_baseline_stages_its_rows_without_the_matrix_index_field", async () => {
  const wire = stageWire({ configStatus: 500 });
  const answer = await run({ rows: [0] }, wire);
  assert.equal(JSON.stringify(stagedRows(answer)[1]), canonicalRow(ROWS[1]));
});

// --- extra http fields ----------------------------------------------------------

test("test_an_extra_http_scalar_is_staged_alongside_the_pipelines", async () => {
  const wire = stageWire();
  const answer = await run({ rows: [0], http: { matrix_channels: "2" } }, wire);
  assert.equal(answer.staged.http.matrix_channels, "2");
});

test("test_an_extra_http_scalar_does_not_displace_the_pipelines_from_the_staged_payload", async () => {
  const wire = stageWire();
  const answer = await run({ rows: [0], http: { matrix_channels: "2" } }, wire);
  assert.deepEqual(Object.keys(answer.staged.http).sort(), ["matrix_channels", "matrix_pipelines"]);
});

// --- row selection --------------------------------------------------------------

test("test_selecting_all_rows_applies_the_eq_to_every_baseline_row", async () => {
  const wire = stageWire();
  const answer = await run({ rows: "all" }, wire);
  assert.deepEqual(
    stagedRows(answer).map((r) => hasStage(r.process, "peak", 5000)),
    [true, true],
  );
});
