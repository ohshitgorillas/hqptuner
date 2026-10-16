// Store suite for the apodizing strip on playback time (docs/spec/timing.md, the "Apodizing strip" row): a bin of the
// apodizing history (hqptuner/static/store/apodhistory.js) is stamped once, on arrival, at the meter feed's edge, the end
// of the last frame the feed store has queued since its connection opened, less the effective delay
// (hqptuner/static/store/meter/delay.js) at that moment; with no edge, no feed open or none queued yet, the bin carries
// no stamp. The strip's right edge, stripEnd (hqptuner/static/store/meter/spectrogram.js), is the one playhead and
// nothing else.
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

import { closeMeterFeed, openMeterFeed, takeMeterFrames } from "../../../../hqptuner/static/store/meter/feed.js";
import { initSpectrogram, stripEnd } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { effectiveDelay, spectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
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

/** The offset the meters run behind the feed, s. */
const OFFSET_S = 0.25;

/** An engine output delay as Status reports it, microseconds. */
const ENGINE_DELAY_US = "500000";

/** ms in one s. */
const MS_PER_S = 1000;

/** How far two playback times in ms may differ and still be the same time: far under one sample at any rate. */
const SAME_MS = 1e-6;

/** A playback position no table here reaches: playback, ms. */
const ELSEWHERE_MS = 1000;

/** How many of STAMPED_48K's events end at STAMPED_48K_SECOND_END_MS. */
const FIRST_TWO = 2;

initApodHistory();
initSpectrogram();

/** The newest bin's stamp, NaN where it has none: playback, ms. */
const newestAt = () => apodBins.value.at(-1)?.at ?? NaN;

/** The effective delay now: playback, ms. */
const delayMs = () => effectiveDelay.value * MS_PER_S;

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

// --- the stamp a bin carries ---------------------------------------------------------------------------------------

for (const [name, fields] of /** @type {Array<[string, Record<string, string>]>} */ ([
  ["the_offset_alone", {}],
  ["the_offset_and_the_engines_output_delay", { output_delay: ENGINE_DELAY_US }],
])) {
  test(`test_a_bin_arriving_while_the_playhead_is_null_is_stamped_at_the_feeds_edge_less_${name}`, () => {
    play(STAMPED_48K);
    append([1], fields);
    assert.ok(...near(newestAt(), STAMPED_48K_END_MS - delayMs(), SAME_MS));
  });
}

test("test_a_bins_stamp_is_the_feeds_edge_less_the_delay_whatever_the_playhead_reads", () => {
  playhead.value = ELSEWHERE_MS;
  play(STAMPED_48K);
  append([1]);
  assert.ok(...near(newestAt(), STAMPED_48K_END_MS - delayMs(), SAME_MS));
});

test("test_frames_already_taken_off_the_queue_still_set_the_feeds_edge", () => {
  play(STAMPED_48K);
  takeMeterFrames();
  append([1]);
  assert.ok(...near(newestAt(), STAMPED_48K_END_MS - delayMs(), SAME_MS));
});

test("test_a_bins_stamp_stays_where_its_arrival_put_it_as_the_feed_moves_on", () => {
  play(STAMPED_48K.slice(0, FIRST_TWO));
  append([1]);
  play(STAMPED_48K.slice(FIRST_TWO));
  append([1]);
  assert.ok(...near(apodBins.value[0]?.at ?? NaN, STAMPED_48K_SECOND_END_MS - delayMs(), SAME_MS));
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
