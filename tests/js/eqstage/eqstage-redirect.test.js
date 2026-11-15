// eqstage never follows a redirect: the stage POST carries the staged payload and
// the login POST carries the credentials, so a server that answers either with a
// 307 must not get them re-sent to the Location it names. Real fetch against a
// loopback server on an ephemeral port; every path 307s to /sink, and /sink
// counts what reaches it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqstage/eqstage-redirect.test.js

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { loggedInFetch, postStage, verifyPending } from "../../../scripts/eqstage/post.js";
import { readBaseline } from "../../../scripts/eqstage/rows.js";

/** @type {import("node:http").Server} */
let server;
let base = "";
let sinkHits = 0;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/sink") {
      sinkHits += 1;
      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(307, { Location: "/sink" }).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
});

beforeEach(() => {
  sinkHits = 0;
});

after(() => {
  server.close();
});

const PAYLOAD = { live: {}, http: { matrix_pipelines: "[]" } };

test("test_a_redirected_baseline_read_never_reaches_the_target", async () => {
  await readBaseline(base, globalThis.fetch).catch(() => undefined);
  assert.equal(sinkHits, 0);
});

test("test_a_redirected_stage_post_never_reaches_the_target", async () => {
  await postStage(base, PAYLOAD, globalThis.fetch).catch(() => undefined);
  assert.equal(sinkHits, 0);
});

test("test_a_redirected_pending_read_never_reaches_the_target", async () => {
  await verifyPending(base, PAYLOAD, globalThis.fetch).catch(() => undefined);
  assert.equal(sinkHits, 0);
});

test("test_a_redirected_login_post_never_reaches_the_target", async () => {
  await loggedInFetch(base, { username: "u", password: "p" }, globalThis.fetch).catch(() => undefined);
  assert.equal(sinkHits, 0);
});
