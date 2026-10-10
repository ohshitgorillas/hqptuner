// Behavioral suite for store/sync.js over a page the browser hides and shows:
// no push stream is opened while `document.hidden` is true, the stream is closed
// when the page goes hidden, and the page coming back opens a new one, once.
//
// The stream is
// the EventSource fake (tests/js/support/eventsource.js), the page is the
// document fake (tests/js/support/page.js), and globalThis.fetch answers the
// metadata prime through the static wire fake.
//
// startSync is called once, at module load, over a hidden page, and the cases run
// in sequence: each one moves the page the way the browser would and reads the
// streams opened so far.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/hidden.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { startSync } from "../../../../hqptuner/static/store/sync.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { setHidden, usePage } from "../../support/page.js";
import { staticWire } from "../../support/wire/wire.js";

useEventSource();
usePage(true);
staticWire();
startSync();

test("test_no_stream_is_opened_while_the_page_is_hidden", () => {
  assert.equal(lastStream(), null);
});

test("test_the_page_becoming_visible_opens_the_push_stream", () => {
  setHidden(false);
  assert.equal(lastStream()?.url, "/api/push");
});

test("test_a_visibilitychange_on_a_visible_page_opens_no_second_stream", () => {
  const open = lastStream();
  setHidden(false);
  assert.equal(lastStream(), open);
});

test("test_the_stream_is_closed_when_the_page_goes_hidden", () => {
  const open = lastStream();
  setHidden(true);
  assert.equal(open?.closed, true);
});

test("test_a_visibilitychange_that_leaves_the_page_hidden_opens_nothing", () => {
  setHidden(true);
  assert.equal(lastStream()?.closed, true);
});

test("test_the_page_coming_back_opens_a_new_stream", () => {
  setHidden(false);
  assert.equal(lastStream()?.closed, false);
});
