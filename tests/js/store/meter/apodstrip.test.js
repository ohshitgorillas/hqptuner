// Store suite for the apodizing strip on playback time: a bin of the
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
// The engine plays only while /api/health reports the connection Ready, so every case starts on a Ready connection.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/apodstrip.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { closeMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { initSpectrogram, stripEnd } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { append } from "../../support/apodpolls.js";
import { fakeClock } from "../../support/clock.js";
import { STAMPED_48K, STAMPED_48K_END_MS, STAMPED_48K_SECOND_END_MS, play } from "../../support/meterfeed.js";
import { ELSEWHERE_MS, newestAt, openFeed48k, readyTrack48k } from "../../support/meter/meterrig.js";

const { clock } = fakeClock();

initApodHistory();
initSpectrogram();

beforeEach(() => {
  readyTrack48k(clock);
});

// --- no edge, no stamp ---------------------------------------------------------------------------------------------

test("test_a_bin_arriving_on_a_feed_that_has_queued_no_frame_since_it_opened_carries_no_stamp", () => {
  play(STAMPED_48K);
  openFeed48k(clock);
  append([1]);
  assert.equal(newestAt(), null);
});

test("test_a_bin_arriving_with_no_feed_open_carries_no_stamp", () => {
  play(STAMPED_48K);
  closeMeterFeed();
  append([1]);
  assert.equal(newestAt(), null);
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
