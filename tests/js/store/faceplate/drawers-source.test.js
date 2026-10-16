// Store suite for hqptuner/static/store/faceplate/drawers/source.js: what the Source drawer's meter shows over the meter
// feed. Which of the meter or a no-stream line shows (metering off, nothing playing, the feed silent while it plays,
// a silent DSD source with the matrix off), the linear frequency axis ending at the source Nyquist, the channel
// switch's choices and pick, the time window both charts share and its axis, the apodizing strip's events per pixel
// column, each bin laid at its own stamp back from the right edge the caller hands in, both playback, ms, and a bin
// with no stamp drawing nothing, and the spectrogram's own frequency span: at a half or a
// quarter of the band its axis tops out at that share of the source Nyquist, whatever span the page's spectrum is set
// to.
//
// The stream reaches the store at the wire: meter feed events through the EventSource fake
// (tests/js/support/eventsource.js), playback through fresh /api/status objects, the apodizing history through the poll
// seam (tests/js/support/apodpolls.js). The feed's clock is the one openMeterFeed() is handed, so silence is a clock
// step, never a wait. Prefs are written through their own setters over a fake storage. The spectrogram's span is set
// through the store's setter, reached through the module namespace so a store without one leaves the span where it was.
// The spans are the store's own identifiers, the same three the page spectrum's span uses.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawers-source.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as sourceStore from "../../../../hqptuner/static/store/faceplate/drawers/source.js";
import { setFreqSpan } from "../../../../hqptuner/static/store/faceplate/view.js";
import { engineStatus, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import {
  METER_RANGES,
  setApodWindow,
  setMeterChannel,
  setMeterRange,
} from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { setPollStep } from "../../support/apodpolls.js";
import { fakeClock } from "../../support/clock.js";

const { sourceMeter, stripEvents } = sourceStore;

const QUIET_MS = 2000; // the feed's silence threshold, store/meter/feed.js

// The Ranges the switch offers are the owner's: the cases pick by place in the offered set, never by value.
const [FIRST_RANGE = ""] = METER_RANGES;
const LAST_RANGE = METER_RANGES.at(-1) ?? "";

// The spans, as the store holds them: the whole band, its lower half, its lower quarter.
const FULL = "full";
const HALF = "half";
const QUARTER = "quarter";

/**
 * Set the spectrogram's span through the store's setter.
 *
 * @param {string} span
 */
const setSpan = (span) => sourceStore.setSpectrogramSpan?.(span);

let feed = fakeClock();

/**
 * Open a fresh feed over one /api/status object, and send the geometry event when one is given.
 *
 * @param {{ state?: string, metering?: boolean, metadata?: Record<string, string>, geometry?: object }} [o]
 */
function stream({ state = "2", metering = true, metadata = { samplerate: "44100" }, geometry } = {}) {
  closeMeterFeed();
  useEventSource();
  feed = fakeClock();
  engineStatus.value = { status: { state }, metering, metadata };
  openMeterFeed(feed.clock);
  if (geometry) lastStream()?.emit("geometry", geometry);
}

/** @param {number} nyquist @param {number} channels */
const geo = (nyquist, channels) => ({ nyquist, channels, bins: 1025 });

beforeEach(() => {
  useStorage();
  matrixConfig.value = null;
  setApodWindow("60");
  setMeterChannel("sum");
  setMeterRange(FIRST_RANGE);
  setPollStep(1);
  setSpan(FULL);
  setFreqSpan(FULL);
  stream();
});

// --- which shows ---------------------------------------------------------------------------------------------------

test("test_a_playing_source_with_frames_arriving_shows_the_meter", () => {
  assert.equal(sourceMeter().state, "live");
});

test("test_metering_switched_off_shows_the_off_line", () => {
  stream({ metering: false });
  assert.equal(sourceMeter().state, "off");
});

test("test_nothing_playing_shows_the_idle_line", () => {
  stream({ state: "0" });
  assert.equal(sourceMeter().state, "idle");
});

test("test_a_playing_pcm_source_whose_feed_went_quiet_shows_the_silent_line", () => {
  feed.advance(QUIET_MS);
  assert.equal(sourceMeter().state, "silent");
});

test("test_a_quiet_dsd_source_with_the_matrix_off_shows_the_matrix_line", () => {
  stream({ metadata: { samplerate: "2822400" } });
  feed.advance(QUIET_MS);
  assert.equal(sourceMeter().state, "matrix");
});

test("test_a_quiet_dsd_source_with_the_matrix_engaged_shows_the_silent_line", () => {
  matrixConfig.value = { fields: [{ name: "enabled", type: "checkbox", value: true }] };
  stream({ metadata: { sdm: "1", samplerate: "2822400" } });
  feed.advance(QUIET_MS);
  assert.equal(sourceMeter().state, "silent");
});

// --- frequency axis ------------------------------------------------------------------------------------------------

test("test_the_frequency_axis_ends_at_the_source_nyquist", () => {
  stream({ geometry: geo(96000, 2) });
  assert.equal(sourceMeter().freq.nyq.khz, 96);
});

test("test_the_frequency_axis_ends_at_a_cd_nyquist_before_any_geometry", () => {
  assert.equal(sourceMeter().freq.nyq.khz, 22.05);
});

test("test_the_frequency_axis_runs_from_zero_at_the_bottom", () => {
  stream({ geometry: geo(48000, 2) });
  const { ticks } = sourceMeter().freq;
  assert.equal(ticks.find((t) => t.khz === 0)?.at, 1);
});

test("test_the_frequency_axis_is_linear", () => {
  stream({ geometry: geo(48000, 2) });
  const at = sourceMeter().freq.ticks.find((t) => t.khz === 20)?.at;
  assert.equal(at === undefined ? NaN : +at.toFixed(4), 0.5833);
});

// --- the spectrogram's span ---------------------------------------------------------------------------------------

//: A 192 kHz source's Nyquist, in Hz.
const NYQ_192 = 96000;
//: The top of the half view of that source, in kHz.
const HALF_OF_192_KHZ = 48;

test("test_at_the_half_span_the_spectrogram_axis_tops_out_at_48_khz_for_a_96_khz_nyquist", () => {
  stream({ geometry: geo(NYQ_192, 2) });
  setSpan(HALF);
  assert.equal(sourceMeter().freq.nyq.khz, HALF_OF_192_KHZ);
});

test("test_the_page_spectrums_span_leaves_the_spectrogram_axis_at_its_own_span", () => {
  stream({ geometry: geo(NYQ_192, 2) });
  setSpan(HALF);
  setFreqSpan(QUARTER);
  assert.equal(sourceMeter().freq.nyq.khz, HALF_OF_192_KHZ);
});

// --- channel -------------------------------------------------------------------------------------------------------

test("test_the_channel_switch_offers_each_reported_channel_and_the_sum", () => {
  stream({ geometry: geo(48000, 6) });
  assert.deepEqual([...sourceMeter().channels].sort(), ["0", "1", "2", "3", "4", "5", "sum"]);
});

test("test_a_picked_channel_the_source_carries_is_drawn", () => {
  stream({ geometry: geo(48000, 6) });
  setMeterChannel("5");
  assert.equal(sourceMeter().channel, "5");
});

test("test_a_picked_channel_the_source_lacks_falls_back_to_the_sum", () => {
  stream({ geometry: geo(48000, 2) });
  setMeterChannel("5");
  assert.equal(sourceMeter().channel, "sum");
});

// --- range and window ----------------------------------------------------------------------------------------------

test("test_the_color_span_is_the_picked_range", () => {
  setMeterRange(LAST_RANGE);
  assert.equal(sourceMeter().range, Number(LAST_RANGE));
});

test("test_a_timed_window_spans_its_seconds", () => {
  setApodWindow("120");
  assert.equal(sourceMeter().span, 120000);
});

test("test_a_timed_window_axis_counts_back_from_its_span", () => {
  setApodWindow("30");
  assert.equal(sourceMeter().time.ticks[0]?.value, -30);
});

test("test_a_window_past_two_minutes_reads_its_axis_in_minutes", () => {
  setApodWindow("300");
  assert.equal(sourceMeter().time.ticks[0]?.value, -5);
});

// --- the apodizing strip -------------------------------------------------------------------------------------------

/**
 * One bin of the apodizing history.
 *
 * @param {number} ms  the playback it observed, ms
 * @param {number} n  the events it counted
 * @param {number | null} at  its stamp, where its playback ends: playback, ms; null where it arrived with no feed edge
 */
const bin = (ms, n, at) => ({ ms, n, at });

/**
 * The strip's events per column, as plain numbers.
 *
 * @param {Array<{ ms: number, n: number, at: number | null }>} bins
 * @param {number} span  playback, ms
 * @param {number} cols
 * @param {number} end  playback, ms
 */
const columns = (bins, span, cols, end) => Array.from(stripEvents(bins, span, cols, end));

//: A bin with no stamp, as wide as STAMPED and counting more, inside the window were its missing stamp read as 0 ms.
const UNSTAMPED = bin(1000, 4, null);
const STAMPED = bin(1000, 2, 1000);

test("test_a_bin_with_no_stamp_adds_nothing_to_the_strip", () => {
  assert.deepEqual(columns([UNSTAMPED, STAMPED], 2000, 2, 1000), columns([STAMPED], 2000, 2, 1000));
});

test("test_a_bins_events_land_under_the_playback_it_observed", () => {
  const bins = [bin(1000, 0, 1000), bin(1000, 2, 2000)];
  assert.deepEqual(Array.from(stripEvents(bins, 2000, 4, 2000)), [0, 0, 1, 1]);
});

test("test_a_lone_event_in_a_wide_interval_still_marks_the_strip", () => {
  assert.deepEqual(Array.from(stripEvents([bin(4000, 1, 4000)], 4000, 4, 4000)), [1, 1, 1, 1]);
});

test("test_a_denser_interval_draws_hotter_than_a_sparser_one", () => {
  const strip = stripEvents([bin(1000, 2, 1000), bin(1000, 4, 2000)], 2000, 2, 2000);
  assert.ok(strip[1] > strip[0]);
});

test("test_an_empty_history_draws_a_blank_strip", () => {
  assert.deepEqual(Array.from(stripEvents([], 60000, 4, 0)), [0, 0, 0, 0]);
});

test("test_a_window_wider_than_the_history_leaves_its_head_blank", () => {
  assert.deepEqual(Array.from(stripEvents([bin(1000, 3, 1000)], 2000, 2, 1000)), [0, 3]);
});

test("test_a_strip_ending_past_the_newest_bin_leaves_the_unobserved_stretch_blank", () => {
  const bins = [bin(1000, 3, 1000), bin(1000, 3, 2000)];
  assert.deepEqual(Array.from(stripEvents(bins, 2000, 4, 2500)), [2, 2, 2, 0]);
});

test("test_a_bin_straddling_the_left_edge_shows_the_part_still_inside_the_window", () => {
  const bins = [bin(2000, 6, 2000), bin(2000, 0, 4000)];
  assert.deepEqual(Array.from(stripEvents(bins, 2000, 2, 3000)), [3, 0]);
});
