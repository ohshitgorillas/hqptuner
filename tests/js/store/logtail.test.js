// Behavioral suite for store/logtail.js: a refresh fetches /api/log and holds
// the lines it answered.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/logtail.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { logLines, logMessage, refreshLogTail } from "../../../hqptuner/static/store/logtail.js";
import { ok, stagingWire } from "../support/wire/wire.js";

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
