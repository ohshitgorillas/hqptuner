// Rendered suite for the Range buttons preference on hqptuner/static/components/faceplate/page/SourceMeter.js: with a
// stream, the page's spectrum draws its −/+ Range buttons while the preference shows them and none while it hides
// them. How the buttons step the Range is tests/js/components/faceplate-page/meter.test.js's.
//
// Renders through preact-render-to-string. The stream reaches the store at the wire, as in meter.test.js: meter feed
// events through the EventSource fake, playback through a fresh /api/status object. The preference is driven by
// assigning its exported signal; the buttons are found by `data-testid`.
// The engine plays only while /api/health reports the connection Ready, so every case starts on a Ready connection.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/meter-rangebuttons.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SourceMeter } from "../../../../hqptuner/static/components/faceplate/page/SourceMeter.js";
import { engineStatus, health } from "../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { METER_RANGES, rangeButtons, setPageRange } from "../../../../hqptuner/static/store/ui/prefs.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { fakeClock } from "../../support/clock.js";
import { attr, elements } from "../../support/markup.js";

const FULL = { w: 1366, h: 1024 };

/** The lifecycle generation of the Ready connection every case starts on. */
const GEN = 3;

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
  lastStream()?.emit("geometry", { nyquist: 22050, channels: 2, centers: [1000, 2000] });
}

/** How many −/+ Range buttons the section draws. */
const rangeButtonCount = () =>
  elements(render(html`<${SourceMeter} />`)).filter((e) => BUTTONS.includes(attr(e, "data-testid") ?? "")).length;

beforeEach(() => {
  health.value = { phase: "Ready", generation: GEN };
  useStorage();
  rangeButtons.value = true;
  setPageRange(MIDDLE);
  viewport.value = FULL;
  stream();
});

test("test_shown_range_buttons_draw_both", () => {
  const shown = rangeButtonCount();
  assert.equal(shown, BUTTONS.length);
});

test("test_hidden_range_buttons_draw_none", () => {
  rangeButtons.value = false;
  const hidden = rangeButtonCount();
  assert.equal(hidden, 0);
});

// The Ranges the page offers by span, narrowest first, and the two ends the dimming turns on.
const SPANS = [...METER_RANGES].sort((a, b) => Number(a) - Number(b));
const NARROWEST = SPANS[0] ?? "";
const WIDEST = SPANS[SPANS.length - 1] ?? "";

/**
 * Whether the Range control's `testid` button shows dimmed, once per button the section draws, with the page at `range`.
 *
 * @param {string} range
 * @param {string} testid
 * @returns {boolean[]}
 */
function dimmedAt(range, testid) {
  setPageRange(range);
  return elements(render(html`<${SourceMeter} />`))
    .filter((e) => attr(e, "data-testid") === testid)
    .map((e) => attr(e, "aria-disabled") === "true");
}

test("test_wider_is_dimmed_at_the_widest_range", () => {
  assert.deepEqual(dimmedAt(WIDEST, "range-wider"), [true]);
});

test("test_narrower_is_dimmed_at_the_narrowest_range", () => {
  assert.deepEqual(dimmedAt(NARROWEST, "range-narrower"), [true]);
});

for (const range of SPANS.filter((r) => r !== WIDEST)) {
  test(`test_wider_is_not_dimmed_at_the_${range}_range_below_the_widest`, () => {
    assert.deepEqual(dimmedAt(range, "range-wider"), [false]);
  });
}

for (const range of SPANS.filter((r) => r !== NARROWEST)) {
  test(`test_narrower_is_not_dimmed_at_the_${range}_range_above_the_narrowest`, () => {
    assert.deepEqual(dimmedAt(range, "range-narrower"), [false]);
  });
}
