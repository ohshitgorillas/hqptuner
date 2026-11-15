// A job's `url` is where eqstage sends the login pair and the staged payload, so
// it may name only a loopback HQPTuner over http. A refused url sends nothing.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqstage/eqstage-url.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { runJob } from "../../../scripts/eqstage/eqstage.js";

/** @typedef {import("../../../scripts/eqstage/post.js").FetchImpl} FetchImpl */

const ROW = { index: 0, source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "iir:type=peak;f=200;q=1;g=1" };
const EQ = { bands: [{ type: "peak", f: 5000, q: 2, g: -4 }] };

/**
 * A wire that answers the baseline reads and records every URL it is asked for.
 *
 * @returns {{ urls: string[], fetch: FetchImpl }}
 */
function recordingWire() {
  /** @type {string[]} */
  const urls = [];
  const answer = async (/** @type {string} */ url) => {
    urls.push(String(url));
    const ok = (/** @type {unknown} */ body) => ({ ok: true, status: 200, statusText: "OK", json: async () => body });
    return String(url).endsWith("/api/matrix") ? ok({ data: { rows: [ROW] } }) : { ...ok({}), ok: false, status: 404 };
  };
  return { urls, fetch: /** @type {FetchImpl} */ (/** @type {unknown} */ (answer)) };
}

/**
 * Run a dry job against `url` and report what the wire saw.
 *
 * @param {string} url
 * @returns {Promise<{ urls: string[], outcome: Promise<unknown> }>}
 */
async function dryRun(url) {
  const wire = recordingWire();
  const outcome = runJob({ url, eq: EQ, dry_run: true }, { fetch: wire.fetch });
  await outcome.catch(() => undefined);
  return { urls: wire.urls, outcome };
}

test("test_a_non_http_scheme_on_a_loopback_host_sends_no_request", async () => {
  assert.deepEqual((await dryRun("https://127.0.0.1:8090")).urls, []);
});

test("test_a_loopback_address_outside_the_three_hosts_sends_no_request", async () => {
  assert.deepEqual((await dryRun("http://127.0.0.2:8090")).urls, []);
});

test("test_an_unparsable_url_sends_no_request", async () => {
  assert.deepEqual((await dryRun("not a url")).urls, []);
});

test("test_a_refused_url_rejects_naming_the_url", async () => {
  await assert.rejects((await dryRun("http://192.0.2.1:8090")).outcome, /http:\/\/192\.0\.2\.1:8090/);
});

test("test_localhost_on_another_port_is_accepted", async () => {
  assert.equal((await dryRun("http://localhost:9123")).urls[0], "http://localhost:9123/api/config");
});

test("test_ipv6_loopback_on_another_port_is_accepted", async () => {
  assert.equal((await dryRun("http://[::1]:9123")).urls[0], "http://[::1]:9123/api/config");
});
