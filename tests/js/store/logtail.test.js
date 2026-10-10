// Behavioral suite for store/logtail.js: a refresh fetches /api/log and holds
// the lines it answered.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/logtail.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { logLines, logMessage, refreshLogTail } from "../../../hqptuner/static/store/logtail.js";
import { bad, ok, stagingWire } from "../support/wire/wire.js";

const TAIL = ["[10:00:01] engine started", "[10:00:02] output opened", "[10:00:03] playback began"];

const initialLines = logLines.value;
const initialMessage = logMessage.value;

test.after(() => {
  logLines.value = initialLines;
  logMessage.value = initialMessage;
});

// Answers GET /api/log in the route's response shape; every other path falls through.
/** @param {string} path */
const logRoute = (path) =>
  path.split("?")[0] === "/api/log" ? ok({ path: "/var/log/hqplayerd.log", enabled: true, lines: TAIL }) : undefined;

test("a refresh replaces the held lines with the lines the log endpoint answered", async () => {
  stagingWire({ routes: logRoute });
  logLines.value = ["[09:59:59] a line from an earlier read"];
  await refreshLogTail();
  assert.deepEqual(logLines.value, TAIL);
});

// --- a failed read --------------------------------------------------------------
//
// The message wording is copy (docs/testing.md rule 9) and is not asserted; what
// is asserted is where the failure's own reason, a string this fake put on the
// wire, lands in it. The reason rides the route's refusal as its `detail`, the
// one failure whose message the client hands on as the wire said it.

const REASON = "the log file is not readable by hqplayerd";
const REFUSED = 502;

// GET /api/log answers a refusal carrying `detail`; every other path falls through.
/** @param {string} detail */
const refusingLogRoute = (detail) => (/** @type {string} */ path) =>
  path.split("?")[0] === "/api/log" ? bad(REFUSED, detail) : undefined;

// The message a refresh leaves behind when the log read is refused with `detail`.
/** @param {string} detail */
async function messageAfterRefusal(detail) {
  stagingWire({ routes: refusingLogRoute(detail) });
  logMessage.value = "";
  await refreshLogTail();
  return logMessage.value;
}

test("a failed read ends its message with the failure's reason and a full stop", async () => {
  const message = await messageAfterRefusal(REASON);
  assert.ok(message.endsWith(`${REASON}.`), message);
});

test("a failed read carries the reason itself, not the error's string form", async () => {
  const message = await messageAfterRefusal(REASON);
  assert.equal(message.includes(`Error: ${REASON}`), false, message);
});

test("a reason that already ends in a full stop gets no second one", async () => {
  const bare = await messageAfterRefusal(REASON);
  const stopped = await messageAfterRefusal(`${REASON}.`);
  assert.equal(stopped, bare);
});

// --- a log HQPlayer does not serve ------------------------------------------------
//
// The route refuses a log HQPlayer has none of with its own code, and the pane
// says so in a sentence of its own rather than the failed-read sentence wrapped
// around the refusal's detail. The sentence is copy (docs/testing.md rule 9), so
// these tests pin what tells it apart: it does not carry the detail, and it is
// not what a failed read with the same detail leaves.

const LOG_ABSENT = "daemon_log_absent";
const READ_FAILED = "daemon_read_failed";
const ABSENT_STATUS = 404;
const FAILED_STATUS = 502;
const ONE_DETAIL = "hqplayerd answered no log file";
const OTHER_DETAIL = "logging is switched off in hqplayerd";

// GET /api/log answers a refusal in the REST API's own shape, `detail` and
// `code` (docs/architecture.md section 8.1); every other path falls through.
/**
 * @param {number} status
 * @param {string} code
 * @param {string} detail
 */
const codedLogRefusal = (status, code, detail) => (/** @type {string} */ path) =>
  path.split("?")[0] === "/api/log" ? { ok: false, status, json: async () => ({ detail, code }) } : undefined;

// The message a refresh leaves behind when the log read is refused with `code`.
/**
 * @param {number} status
 * @param {string} code
 * @param {string} detail
 */
async function messageAfterCodedRefusal(status, code, detail) {
  stagingWire({ routes: codedLogRefusal(status, code, detail) });
  logMessage.value = "";
  await refreshLogTail();
  return logMessage.value;
}

test("an absent log leaves the same message whatever detail its refusal carries", async () => {
  const one = await messageAfterCodedRefusal(ABSENT_STATUS, LOG_ABSENT, ONE_DETAIL);
  const other = await messageAfterCodedRefusal(ABSENT_STATUS, LOG_ABSENT, OTHER_DETAIL);
  assert.equal(other, one);
});

test("an absent log leaves a different message from a failed read with the same detail", async () => {
  const absent = await messageAfterCodedRefusal(ABSENT_STATUS, LOG_ABSENT, ONE_DETAIL);
  const failed = await messageAfterCodedRefusal(FAILED_STATUS, READ_FAILED, ONE_DETAIL);
  assert.notEqual(absent, failed);
});
