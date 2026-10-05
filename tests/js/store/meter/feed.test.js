// Store suite for hqptuner/static/store/meter/feed.js: initMeterFeed() holds the METER feed open while metering runs
// and closed while it is off, and a repeated call registers nothing further.
//
// Metering reaches the store at the wire, through fresh /api/status objects on engineStatus; the feed is the EventSource
// fake (tests/js/support/eventsource.js). The feed's clock is the fixed one initMeterFeed() is handed. The effect
// initMeterFeed() registers outlives each test, so every case first switches metering off, which closes any feed an
// earlier case left open, then starts a fresh log of opened streams and switches metering on.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/feed.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { initMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";

const clock = () => 0;

beforeEach(() => {
  engineStatus.value = { metering: false };
  useEventSource();
  engineStatus.value = { metering: true };
  initMeterFeed(clock);
});

test("test_metering_on_holds_one_stream_open_on_the_feed", () => {
  assert.deepEqual([lastStream()?.url, lastStream()?.closed], ["/api/meter/feed", false]);
});

test("test_metering_switched_off_closes_the_stream", () => {
  engineStatus.value = { metering: false };
  assert.equal(lastStream()?.closed, true);
});

test("test_a_second_init_opens_no_second_stream", () => {
  const first = lastStream();
  initMeterFeed(clock);
  assert.deepEqual([lastStream() === first, lastStream()?.closed], [true, false]);
});
