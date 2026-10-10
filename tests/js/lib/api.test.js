// Behavioral suite for lib/api.js's upload lane — the one wrapper the store
// suites never reach (multipart, not JSON) — plus the preset-name URL escaping.
//
// The wire is faked at globalThis.fetch (docs/testing.md rule 4) and restored
// after every test. File and FormData are the platform's own.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/api.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { api } from "../../../hqptuner/static/lib/api.js";
import { ok, bad } from "../support/wire/wire.js";

/**
 * @typedef {import("../support/wire/wire.js").FakeResponse} FakeResponse
 * @typedef {{ path: string | null, opts: RequestInit | null }} Seen
 */

// The DOM lib declares fetch answering with a real Response, which the wire
// fakes do not build, so the global is reached through its own view here.
/** @type {{ fetch?: unknown }} */
const env = globalThis;

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

// Capture what fetch was handed, answering with a canned response.
/**
 * @param {FakeResponse} [answer]
 * @returns {Seen}
 */
function wire(answer = ok({})) {
  /** @type {Seen} */
  const seen = { path: null, opts: null };
  /**
   * @param {string} path
   * @param {RequestInit} [opts]
   * @returns {Promise<FakeResponse>}
   */
  const fake = async (path, opts = {}) => {
    seen.path = path;
    seen.opts = opts;
    return answer;
  };
  env.fetch = fake;
  return seen;
}

// Every case here drives exactly one call, so the request is always there.
/**
 * @param {Seen} seen
 * @returns {RequestInit}
 */
const sent = (seen) => /** @type {RequestInit} */ (seen.opts);

/**
 * @param {Seen} seen
 * @param {string} field
 * @returns {File}
 */
const uploaded = (seen, field) => /** @type {File} */ (/** @type {FormData} */ (sent(seen).body).get(field));

const FILE = () => new File(["1000 -3.0"], "eq.txt", { type: "text/plain" });

// --- the multipart upload path -----------------------------------------------

test("test_an_upload_posts_multipart_form_data_not_json", async () => {
  const seen = wire();
  await api.uploadFilter(FILE());
  assert.equal(sent(seen).body instanceof FormData, true);
});

test("test_an_upload_carries_the_file_under_the_declared_field", async () => {
  const seen = wire();
  await api.uploadFilter(FILE());
  assert.equal(uploaded(seen, "file").name, "eq.txt");
});

test("test_an_upload_sets_no_content_type_of_its_own", async () => {
  // the multipart boundary belongs to fetch; a hand-set header would break it
  const seen = wire();
  await api.uploadFilter(FILE());
  assert.equal(sent(seen).headers, undefined);
});

test("test_a_config_restore_uploads_under_the_cfgfile_field", async () => {
  const seen = wire();
  await api.restore(FILE());
  assert.equal(uploaded(seen, "cfgfile").name, "eq.txt");
});

test("test_an_upload_returns_the_parsed_response", async () => {
  wire(ok({ uploaded: "eq.txt" }));
  assert.deepEqual(await api.uploadFilter(FILE()), { uploaded: "eq.txt" });
});

test("test_a_refused_upload_surfaces_the_daemons_own_reason", async () => {
  wire(bad(422, "not a filter file"));
  await assert.rejects(() => api.uploadFilter(FILE()), /not a filter file/);
});

// --- a failure with no usable detail -----------------------------------------
// Its sentence is copy (docs/testing.md rule 9), so these cases pin what the
// sentence is built from: the status and what the wire carried, never the
// request path, never the wording itself.

// The message a call's rejection carries. A call that resolves has nothing to
// describe, so the helper refuses rather than handing back a value that could
// compare equal to another.
/**
 * @param {() => Promise<unknown>} call
 * @returns {Promise<string>}
 */
async function rejection(call) {
  const outcome = await call().then(
    () => null,
    (/** @type {unknown} */ e) => ({ message: e instanceof Error ? e.message : String(e) }),
  );
  if (outcome === null) throw new Error("the call resolved; there is no rejection to read");
  return outcome.message;
}

/**
 * @param {number} status
 * @returns {Promise<string>}
 */
async function unexplained(status) {
  wire(bad(status));
  return rejection(() => api.status());
}

test("test_an_unexplained_server_error_reads_the_same_from_any_endpoint", async () => {
  // multipart lane and JSON lane alike: the description is the status's, not the path's
  wire(bad(500));
  const fromUpload = await rejection(() => api.uploadFilter(FILE()));
  const fromStatus = await rejection(() => api.status());
  assert.equal(fromUpload, fromStatus);
});

test("test_every_gateway_failure_reads_alike_whichever_of_502_503_504", async () => {
  const gateway = await unexplained(502);
  const others = [await unexplained(503), await unexplained(504)];
  assert.deepEqual(others, [gateway, gateway]);
});

// Two client errors of different meaning: a sentence built from the status
// tells them apart, where one built from the status class alone would not.
const CONFLICT = 409;
const FORBIDDEN = 403;

test("test_an_unexplained_409_and_an_unexplained_403_read_differently", async () => {
  const conflict = await unexplained(CONFLICT);
  const forbidden = await unexplained(FORBIDDEN);
  assert.notEqual(conflict, forbidden);
});

test("test_a_missing_endpoint_is_described_without_its_status_code", async () => {
  // the 404 rides on err.status; the sentence names the path, not the number
  const message = await unexplained(404);
  assert.doesNotMatch(message, /404/);
});

// FastAPI's request-validation refusal: a list of errors, each locating its
// field and giving pydantic's reason.
const FIELD = "file";
const REASON = "Field required";
const VALIDATION = {
  ok: false,
  status: 422,
  json: async () => ({ detail: [{ type: "missing", loc: ["body", FIELD], msg: REASON, input: null }] }),
};

test("test_a_validation_refusal_names_the_field_it_could_not_use", async () => {
  wire(VALIDATION);
  const message = await rejection(() => api.uploadFilter(FILE()));
  assert.equal(message.includes(FIELD), true, message);
});

test("test_a_validation_refusal_gives_the_reason_the_wire_carried", async () => {
  // case-blind: the sentence may lower-case pydantic's leading capital
  wire(VALIDATION);
  const message = await rejection(() => api.uploadFilter(FILE()));
  assert.match(message, new RegExp(REASON, "i"));
});

// A fetch that never reached HQPTuner rejects with the browser's own wording,
// which differs by engine.
const CHROMIUM_NETWORK_ERROR = "Failed to fetch";
const GECKO_NETWORK_ERROR = "NetworkError when attempting to fetch resource.";

/**
 * @param {string} wording
 * @returns {Promise<string>}
 */
async function unreachable(wording) {
  env.fetch = async () => {
    throw new TypeError(wording);
  };
  return rejection(() => api.status());
}

test("test_an_unreachable_backend_reads_the_same_in_every_browser", async () => {
  const chromium = await unreachable(CHROMIUM_NETWORK_ERROR);
  const gecko = await unreachable(GECKO_NETWORK_ERROR);
  assert.equal(chromium, gecko);
});

// --- preset names in the path ---------------------------------------------------

test("test_a_preset_name_is_url_encoded_in_the_path", async () => {
  const seen = wire();
  await api.preset("Night / Loud");
  assert.equal(seen.path, "/api/preset/Night%20%2F%20Loud");
});

// --- error codes on a refusal ---------------------------------------------------

test("test_a_refusal_exposes_the_status_and_the_bodys_code_on_the_error", async () => {
  // the body is seeded here, so its code is this test's own string to assert
  wire({ ok: false, status: 409, json: async () => ({ detail: { rate: "x" }, code: "route_refused" }) });
  /** @type {{ status?: number, code?: string }} */
  const err = await api.status().then(
    () => ({}),
    (e) => e,
  );
  assert.deepEqual([err.status, err.code], [409, "route_refused"]);
});
