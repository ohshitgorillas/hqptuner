// Behavioral suite for the METER page's level meters: while the engine plays,
// each channel's bar shows the level the engine last reported.
//
// Every case compares two bars, never a bar against a length: the floor, the
// release rate and the hold are design choices (docs/testing.md rule 11), and
// the relations below hold whatever they are. Frames reach the page through the
// fake EventSource the feed store opens (tests/js/support/eventsource.js), each
// payload written here; playback state through a fresh /api/status object. Bars
// are read by their data-testid and inline width, never by text (rule 9).
//
// Gap: the page opens the feed from a mount effect, which never runs under SSR,
// so each case opens it through the store's own openMeterFeed(). The mount and
// unmount wiring is covered by the browser hand-back.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/meter/levels.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { MeterView } from "../../../../hqptuner/static/components/meter/View.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { openMeterFeed, closeMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { useEventSource, lastStream } from "../../support/eventsource.js";
import { elements } from "../../support/markup.js";

/**
 * Open a fresh feed with the engine playing, send one `frame` per entry (each
 * entry the per-channel peaks, rms 10 dB under), and return the inline width of
 * every peak bar the page then draws, in channel order.
 *
 * @param {number[][]} frames
 * @returns {number[]}
 */
function peakWidths(frames) {
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state: "2" }, metering: true };
  openMeterFeed();
  for (const peaks of frames) {
    lastStream()?.emit("frame", { channels: peaks.map((peak) => ({ peak, rms: peak - 10, bands: [] })) });
  }
  return elements(render(html`<${MeterView} />`))
    .filter((e) => e.attrs.includes('data-testid="meter-peak"'))
    .map((e) => {
      const m = /width:\s*([\d.]+)%/.exec(e.attrs);
      return m ? Number(m[1]) : NaN;
    });
}

const width = (/** @type {number[]} */ bars, /** @type {number} */ i) => (i < bars.length ? bars[i] : NaN);

test("test_a_louder_frame_draws_a_longer_peak_bar", () => {
  const quiet = width(peakWidths([[-20]]), 0);
  assert.ok(width(peakWidths([[-3]]), 0) > quiet);
});

test("test_a_quiet_frame_after_a_loud_one_draws_longer_than_the_quiet_frame_alone", () => {
  const alone = width(peakWidths([[-20]]), 0);
  assert.ok(width(peakWidths([[-3], [-20]]), 0) > alone);
});

test("test_each_channel_draws_its_own_level", () => {
  const bars = peakWidths([[-3, -20]]);
  assert.ok(width(bars, 0) > width(bars, 1));
});
