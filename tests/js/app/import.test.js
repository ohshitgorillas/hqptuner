// Import suite for hqptuner/static/app.js: the entry module exports `boot` and does nothing on import; the app
// starts only when the page's boot call hands it a document (docs/superpowers/specs/rebuild-integrate-design.md,
// Modules and Homes, "App start").
//
// The wire is the fetch fake (tests/js/support/wire/wire.js) behind a log of every path it is handed, the staging
// paths it answers itself included, and the EventSource fake (tests/js/support/eventsource.js). The process's own
// timers are mocked across the import and moved a minute on, so a start parked behind a global timer runs before the
// wire is read. A module is imported once per process, so this file holds the one case that imports it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/app/import.test.js

import test, { mock } from "node:test";
import assert from "node:assert/strict";

import { lastStream, useEventSource } from "../support/eventsource.js";
import { quiesce, stagingWire } from "../support/wire/wire.js";

/** How far the process's mocked timers move after the import, ms: a minute, past any start or poll it could park. */
const MINUTE_MS = 60_000;

/**
 * The global the wire fake installs its `fetch` on, viewed as an optional member, as the wire fake views it.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

test("test_importing_the_app_exports_boot_and_asks_the_wire_for_nothing", async () => {
  useEventSource();
  /** @type {string[]} every path the page asked the wire for */
  const asked = [];
  const wire = stagingWire();
  const served = /** @type {(path: string, opts?: object) => Promise<unknown>} */ (env.fetch);
  env.fetch = (/** @type {string} */ path, /** @type {object | undefined} */ opts) => {
    asked.push(path);
    return served(path, opts);
  };
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const loaded = await import("../../../hqptuner/static/app.js").then(
    (app) => typeof app.boot,
    (error) => String(error),
  );
  mock.timers.tick(MINUTE_MS);
  mock.timers.reset();
  await quiesce(wire);
  assert.deepEqual(
    { boot: loaded, asked, stages: wire.stages, stream: lastStream() },
    { boot: "function", asked: [], stages: [], stream: null },
  );
});
