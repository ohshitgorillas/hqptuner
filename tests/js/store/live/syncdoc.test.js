// Behavioral suite for `startSync(doc)` in store/sync.js: it takes its document with no default, and production code
// reads no global `document` (docs/superpowers/specs/rebuild-integrate-design.md, Modules, and the Homes row "Page
// access from production code").
//
// A visible page is hosted as the global `document`, and startSync is called once, at module load, with no document.
// A sync that falls back on the global reads that visible page and opens its push stream; one with no default has no
// page to read and opens none, whatever the hosted page does. Whether the call itself throws is no part of the claim.
//
// The stream is the EventSource fake (tests/js/support/eventsource.js) and globalThis.fetch answers the metadata prime
// through the static wire fake.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/syncdoc.test.js

import test, { after } from "node:test";
import assert from "node:assert/strict";

import { startSync } from "../../../../hqptuner/static/store/sync.js";
import { fakeClock } from "../../support/clock.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { fakePage, hostPage } from "../../support/page.js";
import { staticWire } from "../../support/wire/wire.js";

const hosted = fakePage({ clock: fakeClock().clock, hidden: false });

useEventSource();
after(hostPage(hosted));
staticWire();
try {
  /** @type {any} */ (startSync)();
} catch {
  // A sync handed no document may refuse; it must not reach for the global one instead.
}

test("test_a_sync_started_with_no_document_opens_no_stream_for_the_visible_global_page", () => {
  assert.equal(lastStream(), null);
});

test("test_the_global_page_hiding_then_showing_opens_no_stream_for_a_sync_started_with_no_document", () => {
  hosted.setHidden(true);
  hosted.setHidden(false);
  assert.equal(lastStream(), null);
});
