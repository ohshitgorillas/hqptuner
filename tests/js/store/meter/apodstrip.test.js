// Store suite for the apodizing strip on playback time (docs/spec/timing.md, the "Apodizing strip" row): a bin of the
// apodizing history (hqptuner/static/store/apodhistory.js) arriving with no feed edge, no feed open or none queued yet,
// carries no stamp. The strip's right edge, stripEnd (hqptuner/static/store/meter/spectrogram.js), is the one playhead
// and nothing else. What a stamped bin carries is pinned in tests/js/store/meter/apodstamp.test.js.
//
// The feed is the EventSource fake (tests/js/support/eventsource.js), opened through openMeterFeed() on a fake Clock no
// case advances, carrying the hand-written STAMPED_48K table of tests/js/support/meterfeed.js, whose lengths span the
// measured range and change from one event to the next. Bins arrive through the poll seam
// (tests/js/support/apodpolls.js): every case starts a new track, whose first poll is the baseline and records no bin,
// so each bin a case reads is one its own polls appended. The history and the spectrogram are registered once, as the
// page registers them. No meter loop runs: the playhead is the signal the loop
// publishes, written here directly.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/apodstrip.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { initSpectrogram, stripEnd } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { apodBins, initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { append, newTrack, setPollStep } from "../../support/apodpolls.js";
import { fakeClock } from "../../support/clock.js";
import {
  RATE_48K,
  STAMPED_48K,
  STAMPED_48K_END_MS,
  STAMPED_48K_SECOND_END_MS,
  geometry,
  play,
} from "../../support/meterfeed.js";

const { clock } = fakeClock();

/** A playback position no table here reaches: playback, ms. */
const ELSEWHERE_MS = 1000;

initApodHistory();
initSpectrogram();

/** Open a fresh feed and send it the 48 kHz geometry. */
function open() {
  closeMeterFeed();
  useEventSource();
  openMeterFeed(clock);
  lastStream()?.emit("geometry", geometry(RATE_48K));
}

beforeEach(() => {
  useStorage();
  playhead.value = null;
  setPollStep(1);
  newTrack();
  open();
});

// --- no edge, no stamp ---------------------------------------------------------------------------------------------

test("test_a_bin_arriving_on_a_feed_that_has_queued_no_frame_since_it_opened_carries_no_stamp", () => {
  play(STAMPED_48K);
  open();
  append([1]);
  assert.equal(apodBins.value.at(-1)?.at, null);
});

test("test_a_bin_arriving_with_no_feed_open_carries_no_stamp", () => {
  play(STAMPED_48K);
  closeMeterFeed();
  append([1]);
  assert.equal(apodBins.value.at(-1)?.at, null);
});

// --- the strip's right edge ----------------------------------------------------------------------------------------

for (const edge of [ELSEWHERE_MS, STAMPED_48K_SECOND_END_MS, STAMPED_48K_END_MS]) {
  test(`test_the_strips_edge_is_the_playhead_at_${edge}_ms`, () => {
    play(STAMPED_48K);
    append([1, 1]);
    playhead.value = edge;
    assert.equal(stripEnd.value, edge);
  });
}

test("test_the_strip_has_no_edge_while_the_playhead_is_null", () => {
  play(STAMPED_48K);
  append([1, 1]);
  assert.equal(stripEnd.value, null);
});
