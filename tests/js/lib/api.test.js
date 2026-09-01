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
import { ok, bad } from "../support/wire.js";

/**
 * @typedef {import("../support/wire.js").FakeResponse} FakeResponse
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

test("test_a_refusal_that_is_not_json_falls_back_to_path_and_status", async () => {
  wire(bad(502));
  await assert.rejects(() => api.uploadFilter(FILE()), /\/api\/matrix\/filter -> 502/);
});

// --- preset names in the path ---------------------------------------------------

test("test_a_preset_name_is_url_encoded_in_the_path", async () => {
  const seen = wire();
  await api.deletePreset("Night / Loud");
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
