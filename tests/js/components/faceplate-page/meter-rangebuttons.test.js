// Rendered suite for the Range buttons preference on hqptuner/static/components/faceplate/page/SourceMeter.js: with a
// stream, the page's spectrum draws its −/+ Range buttons while the preference shows them and none while it hides
// them. How the buttons step the Range is tests/js/components/faceplate-page/meter.test.js's.
//
// Renders through preact-render-to-string. The stream reaches the store at the wire, as in meter.test.js: meter feed
// events through the EventSource fake, playback through a fresh /api/status object. The preference is driven by
// assigning its exported signal; the buttons are found by `data-testid`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/meter-rangebuttons.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SourceMeter } from "../../../../hqptuner/static/components/faceplate/page/SourceMeter.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { METER_RANGES, rangeButtons, setPageRange } from "../../../../hqptuner/static/store/ui/prefs.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { fakeClock } from "../../support/clock.js";
import { attr, elements } from "../../support/markup.js";

const FULL = { w: 1366, h: 1024 };

// The Ranges the page offers are the owner's: the case starts from the second, so neither button sits at an end stop.
const [, MIDDLE = ""] = METER_RANGES;

// The Range control's buttons, by `data-testid`.
const BUTTONS = ["range-wider", "range-narrower"];

/** Open a fresh feed over one /api/status object, and send the geometry event. */
function stream() {
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state: "2" }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(fakeClock().clock);
  lastStream()?.emit("geometry", { nyquist: 22050, channels: 2, centres: [1000, 2000] });
}

/** How many −/+ Range buttons the section draws. */
const rangeButtonCount = () =>
  elements(render(html`<${SourceMeter} />`)).filter((e) => BUTTONS.includes(attr(e, "data-testid") ?? "")).length;

beforeEach(() => {
  useStorage();
  rangeButtons.value = true;
  setPageRange(MIDDLE);
  viewport.value = FULL;
  stream();
});

test("test_hidden_range_buttons_draw_none_where_shown_ones_draw_both", () => {
  const shown = rangeButtonCount();
  rangeButtons.value = false;
  assert.deepEqual([shown, rangeButtonCount()], [BUTTONS.length, 0]);
});
