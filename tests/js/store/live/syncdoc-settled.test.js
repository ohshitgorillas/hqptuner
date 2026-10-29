// Behavioral suite for `startSync(doc)` in store/sync.js taking its document with no default, read once every reply,
// timer and listener the start and each page flip set going has run: called with no document, it follows no page, not
// even the one hosted as the global document.
//
// The page is a fake page (tests/js/support/page.js), visible and hosted as the global document; the stream is the
// EventSource fake (tests/js/support/eventsource.js) and globalThis.fetch answers the metadata prime through the static
// wire fake. A sync that fell back on the global document would open the push stream for the visible page, at once or
// on a later turn, whether it read that page's visibility or listened for its flips, and the page going hidden would
// close it; so no stream is opened at all, and none is closed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/syncdoc-settled.test.js

import test, { after } from "node:test";
import assert from "node:assert/strict";

import { startSync } from "../../../../hqptuner/static/store/sync.js";
import { fakeClock } from "../../support/clock.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { fakePage, hostPage } from "../../support/page.js";
import { staticWire } from "../../support/wire/wire.js";

const { clock, advance } = fakeClock();
const page = fakePage({ clock, hidden: false });

useEventSource();
after(hostPage(page));
staticWire();

//: startSync called the way its signature forbids, with no document.
const startBare = /** @type {() => void} */ (/** @type {unknown} */ (startSync));

/** Let every queued reply, microtask, timer and page re-render run: ten macrotask turns, each moving the clock 1 s. */
async function settle() {
  for (let turn = 0; turn < 10; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    advance(1000);
    page.settle();
  }
}

test("test_once_settled_the_hosted_page_showing_then_hiding_opens_and_closes_no_stream_of_a_sync_started_with_no_document", async () => {
  try {
    startBare();
  } catch {
    // With no document there is no page to follow; a sync that refuses to start follows none either.
  }
  await settle();
  page.setHidden(true);
  await settle();
  page.setHidden(false);
  await settle();
  page.setHidden(true);
  await settle();
  assert.equal(lastStream(), null);
});
