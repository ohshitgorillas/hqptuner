// Store suite for the playback stamp an apodizing bin carries (docs/spec/timing.md, "The two clocks" and the "Apodizing
// strip" row; docs/spec/architecture.md §8.3): a bin of the apodizing history (hqptuner/static/store/apodhistory.js) is
// converted to playback time once, where it arrives, by taking the feed's edge at that moment, the end of the newest
// frame the feed store has queued. The spectrum delay, the user's offset or the engine's output delay, plays no part in
// the stamp: the strip's edge is the one playhead, which already sits the delay behind the feed's edge. A bin arriving
// with no feed edge is pinned in tests/js/store/meter/apodstrip.test.js.
//
// The feed is the EventSource fake (tests/js/support/eventsource.js), opened through openMeterFeed() on a fake Clock no
// case advances, carrying the hand-written STAMPED_48K table of tests/js/support/meterfeed.js, whose lengths span the
// measured range and change from one event to the next. Bins arrive through the poll seam
// (tests/js/support/apodpolls.js): every case starts a new track, whose first poll is the baseline and records no bin,
// so each bin a case reads is one its own polls appended. Every case runs under a spectrum offset that is not zero
// unless it names another delay. No meter loop runs.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/apodstamp.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { closeMeterFeed, openMeterFeed, takeMeterFrames } from "../../../../hqptuner/static/store/meter/feed.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { spectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { apodBins, initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { append, newTrack, setPollStep } from "../../support/apodpolls.js";
import { fakeClock } from "../../support/clock.js";
import { near } from "../../support/near.js";
import {
  RATE_48K,
  STAMPED_48K,
  STAMPED_48K_END_MS,
  STAMPED_48K_SECOND_END_MS,
  geometry,
  play,
} from "../../support/meterfeed.js";

const { clock } = fakeClock();

/** The user's spectrum offset every case starts under: s. */
const OFFSET_S = 0.25;

/** An engine output delay as Status reports it: microseconds. */
const ENGINE_DELAY_US = "500000";

/** How far two playback times in ms may differ and still be the same time: far under one sample at any rate. */
const SAME_MS = 1e-6;

/** A playback position no table here reaches: playback, ms. */
const ELSEWHERE_MS = 1000;

/** How many of STAMPED_48K's events end at STAMPED_48K_SECOND_END_MS. */
const FIRST_TWO = 2;

initApodHistory();

/** The newest bin's stamp, NaN where it has none: playback, ms. */
const newestAt = () => apodBins.value.at(-1)?.at ?? NaN;

/** Open a fresh feed and send it the 48 kHz geometry. */
function open() {
  closeMeterFeed();
  useEventSource();
  openMeterFeed(clock);
  lastStream()?.emit("geometry", geometry(RATE_48K));
}

beforeEach(() => {
  useStorage();
  spectrumOffset.value = OFFSET_S;
  playhead.value = null;
  setPollStep(1);
  newTrack();
  open();
});

// --- the delay plays no part ---------------------------------------------------------------------------------------

for (const [name, offset, fields] of /** @type {Array<[string, number, Record<string, string>]>} */ ([
  ["the_users_offset_alone", OFFSET_S, {}],
  ["the_engines_output_delay_alone", 0, { output_delay: ENGINE_DELAY_US }],
  ["the_users_offset_and_the_engines_output_delay", OFFSET_S, { output_delay: ENGINE_DELAY_US }],
])) {
  test(`test_a_bin_is_stamped_at_the_feeds_edge_under_${name}`, () => {
    spectrumOffset.value = offset;
    play(STAMPED_48K);
    append([1], fields);
    assert.ok(...near(newestAt(), STAMPED_48K_END_MS, SAME_MS));
  });
}

// --- the edge is the feed's, at arrival ----------------------------------------------------------------------------

test("test_a_bins_stamp_is_the_feeds_edge_and_not_the_playhead", () => {
  playhead.value = ELSEWHERE_MS;
  play(STAMPED_48K);
  append([1]);
  assert.ok(...near(newestAt(), STAMPED_48K_END_MS, SAME_MS));
});

test("test_frames_already_taken_off_the_queue_still_set_the_edge_a_bin_is_stamped_at", () => {
  play(STAMPED_48K);
  takeMeterFrames();
  append([1]);
  assert.ok(...near(newestAt(), STAMPED_48K_END_MS, SAME_MS));
});

test("test_a_bins_stamp_stays_at_the_edge_its_arrival_saw_as_the_feed_moves_on", () => {
  play(STAMPED_48K.slice(0, FIRST_TWO));
  append([1]);
  play(STAMPED_48K.slice(FIRST_TWO));
  append([1]);
  assert.ok(...near(apodBins.value[0]?.at ?? NaN, STAMPED_48K_SECOND_END_MS, SAME_MS));
});
