// Behavioral suite for lib/api.js's upload lane — the one wrapper the store
// suites never reach (multipart, not JSON) — plus the preset-name URL escaping.
//
// The wire is faked at globalThis.fetch (docs/testing.md rule 4) and restored
// after every test. File and FormData are the platform's own.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/api.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { api } from "../../hqptuner/static/lib/api.js";
import { ok, bad } from "./wire.js";

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

// Capture what fetch was handed, answering with a canned response.
function wire(answer = ok({})) {
  const seen = { path: null, opts: null };
  globalThis.fetch = async (path, opts = {}) => {
    seen.path = path;
    seen.opts = opts;
    return answer;
  };
  return seen;
}

const FILE = () => new File(["1000 -3.0"], "eq.txt", { type: "text/plain" });

// --- the multipart upload path -----------------------------------------------

test("test_an_upload_posts_multipart_form_data_not_json", async () => {
  const seen = wire();
  await api.uploadFilter(FILE());
  assert.equal(seen.opts.body instanceof FormData, true);
});

test("test_an_upload_carries_the_file_under_the_declared_field", async () => {
  const seen = wire();
  await api.uploadFilter(FILE());
  assert.equal(seen.opts.body.get("file").name, "eq.txt");
});

test("test_an_upload_sets_no_content_type_of_its_own", async () => {
  // the multipart boundary belongs to fetch; a hand-set header would break it
  const seen = wire();
  await api.uploadFilter(FILE());
  assert.equal(seen.opts.headers, undefined);
});

test("test_a_config_restore_uploads_under_the_cfgfile_field", async () => {
  const seen = wire();
  await api.restore(FILE());
  assert.equal(seen.opts.body.get("cfgfile").name, "eq.txt");
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
