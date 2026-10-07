// Rendered suite for hqptuner/static/components/faceplate/drawers/Source.js: the Source drawer's meter block. With a
// stream it draws the apodizing strip over the spectrogram, its frequency axis labelled to the source Nyquist, and the
// Range, Channel and Window switches lit at the prefs and writing them; with none it draws the no-stream line in the
// meter's place. Which state holds, the axes and the strip's events are the store's
// (tests/js/store/faceplate/drawers-source.test.js); this suite covers what the block draws from them.
//
// Renders through preact-render-to-string. A tap is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events. The stream reaches the store at the wire: METER feed events through the
// EventSource fake, playback through a fresh /api/status object. Switches are found by `data-testid` and options by
// `data-v`; every string asserted is a wire value or a number derived from one.
//
// Not reachable here: the two canvases' pixels, which a mount effect paints and server rendering never runs, and the
// colours read from the stylesheet's tokens. The painting rules are the model's (model/gauges/meter-plot.js,
// lib/spectroraster.js) and tested there; a browser run closes the wiring.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/drawers-source.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SourceMeter } from "../../../../hqptuner/static/components/faceplate/drawers/Source.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import {
  METER_RANGES,
  apodWindow,
  meterChannel,
  meterRange,
  setApodWindow,
  setMeterChannel,
  setMeterRange,
} from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const SCHEMA = { id: "source", title: "Source", aria: "Source", tabs: [{ id: "meter", label: "Meter", body: [] }] };

// The Ranges the switch offers are the owner's: the cases pick by place in the offered set, never by value.
const [FIRST = "", SECOND = ""] = METER_RANGES;
const LAST = METER_RANGES.at(-1) ?? "";

/**
 * Open a fresh feed over one /api/status object, and send the geometry event when one is given.
 *
 * @param {{ state?: string, geometry?: object }} [o]
 */
function stream({ state = "2", geometry } = {}) {
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(() => 0);
  if (geometry) lastStream()?.emit("geometry", geometry);
}

const draw = () => elements(render(html`<${SourceMeter} schema=${SCHEMA} />`));

/**
 * The option values lit in the switch carrying `testid`.
 *
 * @param {string} testid
 * @returns {(string | undefined)[]}
 */
function lit(testid) {
  const group = draw().find((e) => attr(e, "data-testid") === testid);
  if (!group) return [];
  return elements(group.html)
    .filter((e) => e.name === "button" && classes(e).includes("on"))
    .map((e) => attr(e, "data-v"));
}

/**
 * Tap the button carrying option value `v`, or nothing when none does.
 *
 * @param {string} v
 */
function tap(v) {
  const { seen } = renderTree(html`<${SourceMeter} schema=${SCHEMA} />`);
  const hit = seen.find((n) => n.type === "button" && n.props["data-v"] === v);
  const fn = hit?.props.onClick;
  if (typeof fn === "function") fn();
}

beforeEach(() => {
  useStorage();
  setApodWindow("60");
  setMeterChannel("sum");
  setMeterRange(FIRST);
  stream();
});

test("test_a_live_stream_draws_the_apodizing_strip_over_the_spectrogram", () => {
  assert.deepEqual(
    draw()
      .filter((e) => e.name === "canvas")
      .sort((a, b) => a.start - b.start)
      .map((e) => classes(e)),
    [["apodstrip"], ["spec"]],
  );
});

test("test_no_stream_draws_the_line_in_place_of_the_meter", () => {
  stream({ state: "0" });
  const root = draw().at(-1);
  assert.deepEqual(root ? classes(root) : [], ["mnone"]);
});

test("test_the_frequency_axis_labels_the_source_nyquist", () => {
  stream({ geometry: { nyquist: 96000, channels: 2, bins: 1025 } });
  const nyq = draw().find((e) => hasAttr(e, "data-nyq"));
  assert.equal(nyq ? Number(text(nyq)) : NaN, 96);
});

test("test_the_channel_switch_lights_the_picked_channel", () => {
  setMeterChannel("1");
  assert.deepEqual(lit("meter-channel"), ["1"]);
});

test("test_the_range_switch_lights_the_picked_range", () => {
  setMeterRange(SECOND);
  assert.deepEqual(lit("meter-range"), [SECOND]);
});

test("test_the_window_switch_lights_the_picked_window", () => {
  setApodWindow("30");
  assert.deepEqual(lit("meter-window"), ["30"]);
});

test("test_tapping_a_channel_picks_it", () => {
  tap("1");
  assert.equal(meterChannel.value, "1");
});

test("test_tapping_a_range_picks_it", () => {
  tap(LAST);
  assert.equal(meterRange.value, LAST);
});

test("test_tapping_a_window_picks_it", () => {
  tap("30");
  assert.equal(apodWindow.value, "30");
});
