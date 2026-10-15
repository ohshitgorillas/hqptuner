// Rendered suite for hqptuner/static/components/faceplate/drawers/Source.js: the Source drawer's meter block. With a
// stream it draws the apodizing strip over the spectrogram, its frequency axis labelled to the source Nyquist, and the
// Range, Channel and Window switches lit at the prefs and writing them, and the spectrogram's Span switch lit at the
// span in force and setting it; with none it draws the no-stream line in the
// meter's place. Which state holds, the axes and the strip's events are the store's
// (tests/js/store/faceplate/drawers-source.test.js); this suite covers what the block draws from them.
//
// Renders through preact-render-to-string. A tap is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events. The stream reaches the store at the wire: meter feed events through the
// EventSource fake, playback through a fresh /api/status object. Switches are found by `data-testid` and options by
// `data-v`; every string asserted is a wire value or a number derived from one. The Span switch's options carry the
// store's own identifiers for the span; the span is set and read through the store's signal and setter, reached through
// the module namespace so a store without them leaves a pick unread.
//
// Not reachable here: the two canvases' pixels, which a mount effect paints and server rendering never runs, and the
// colors read from the stylesheet's tokens. The painting rules are the model's (model/gauges/meter/meter-plot.js,
// lib/spectroraster.js) and tested there; a browser run closes the wiring.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-source.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SourceMeter } from "../../../../hqptuner/static/components/faceplate/drawers/Source.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import * as sourceStore from "../../../../hqptuner/static/store/faceplate/drawers/source.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import {
  METER_RANGES,
  meterChannel,
  meterRange,
  setApodWindow,
  setMeterChannel,
  setMeterRange,
} from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { fakeClock } from "../../support/clock.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements } from "../../support/markup.js";

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
  openMeterFeed(fakeClock().clock);
  if (geometry) lastStream()?.emit("geometry", geometry);
}

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

/** The spectrogram's span in force, as the store holds it. */
const span = () => sourceStore.spectrogramSpan?.value;

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
  setSpan(FULL);
  stream();
});

test("test_the_channel_switch_lights_the_picked_channel", () => {
  setMeterChannel("1");
  assert.deepEqual(lit("meter-channel"), ["1"]);
});

test("test_the_range_switch_lights_the_picked_range", () => {
  setMeterRange(SECOND);
  assert.deepEqual(lit("meter-range"), [SECOND]);
});

test("test_tapping_a_channel_picks_it", () => {
  tap("1");
  assert.equal(meterChannel.value, "1");
});

test("test_tapping_a_range_picks_it", () => {
  tap(LAST);
  assert.equal(meterRange.value, LAST);
});

test("test_the_span_switch_lights_the_half_span_while_it_is_in_force", () => {
  setSpan(HALF);
  assert.deepEqual(lit("meter-span"), [HALF]);
});

test("test_tapping_a_span_sets_the_spectrograms_span", () => {
  tap(QUARTER);
  assert.equal(span(), QUARTER);
});
