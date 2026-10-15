// Rendered suite for hqptuner/static/components/faceplate/page/SourceMeter.js: the page's Source section body. With a
// stream it draws the spectrum and one level bar per channel; slim, the heads give way. With none it draws the no-stream line in the meter's place. Which
// state holds is the store's (tests/js/store/faceplate-page/meter.test.js); what moves is painted each animation frame
// (tests/js/components/faceplate-page/sourcepaint.test.js); this suite covers what the section renders to paint into.
//
// Renders through preact-render-to-string. The stream reaches the store at the wire: meter feed events through the
// EventSource fake, playback through a fresh /api/status object; the plate through the window size the entry writes.
// Every string asserted is a wire value or a number derived from one, minus signs read back as numbers. The Levels floor is picked through the store's setter,
// read off the module namespace with optional access so a store without one fails the floor cases on their assertions;
// the spectrum's color suite is picked the same way, and whether a suite changes what the trace draws is read by
// comparing the spectrum's markup under it against its markup under Mono. Under the Accent palette the trace draws
// in shades of the accent in force, read from the theme store's signals, and a change of accent reaches the next
// render: the trace's markup after a change differs from its markup with no change.
//
// Not reachable here: the trace's path geometry against the plot's own box, which the store's points carry and the
// stylesheet stretches; a browser run closes it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/meter.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SourceMeter } from "../../../../hqptuner/static/components/faceplate/page/SourceMeter.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { METER_RANGES, setPageRange, setSpectrumStyle } from "../../../../hqptuner/static/store/ui/prefs.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import * as uiPrefs from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { fakeClock } from "../../support/clock.js";
import { attr, classes, elements, text } from "../../support/markup.js";
import { accent, accentHex } from "../../../../hqptuner/static/store/ui/theme.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const FULL = { w: 1366, h: 1024 };
//: A spectrum style other than the trace, so the grid's data-style shows the pick.
const RIDGES = "ridges";

// The Ranges the page offers are the owner's: the cases pick by place in the offered set, never by value.
const [FIRST = ""] = METER_RANGES;
const LAST = METER_RANGES.at(-1) ?? "";

// Two Levels floors the owner offers, as the store holds them, in dBFS.
const SHALLOW = "-48";
const DEEP = "-90";

//: Two suites the owner offers, as the store holds them.
const MONO = "mono";
const INFERNO = "inferno";

/**
 * The spectrum's Colors surface on the prefs module.
 *
 * @type {{ setSpectrumStyle(v: string): void, setSpectrumColors?(v: string): void }}
 */
const colorsStore = uiPrefs;

/** @type {{ setMeterFloor?(v: string): void }} */
const floorStore = uiPrefs;

/**
 * Pick the Levels floor `v`.
 *
 * @param {string} v
 */
const pickFloor = (v) => floorStore.setMeterFloor?.(v);

/**
 * Open a fresh feed over one /api/status object, and send the geometry event.
 *
 * @param {{ state?: string, nyquist?: number, channels?: number }} [o]
 */
function stream({ state = "2", nyquist = 22050, channels = 2 } = {}) {
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(fakeClock().clock);
  lastStream()?.emit("geometry", { nyquist, channels, centres: [1000, 2000] });
}

const draw = () => elements(render(html`<${SourceMeter} />`));

/**
 * The elements carrying class `cls`.
 *
 * @param {string} cls
 */
const withClass = (cls) => draw().filter((e) => classes(e).includes(cls));

/**
 * A rendered number, its minus sign read back as one.
 *
 * @param {MarkupElement | undefined} el
 */
const num = (el) => (el ? parseFloat(text(el).replace("−", "-")) : NaN);

beforeEach(() => {
  useStorage();
  setPageRange(FIRST);
  pickFloor(SHALLOW);
  setSpectrumStyle("trace");
  colorsStore.setSpectrumColors?.(MONO);
  viewport.value = FULL;
  stream();
});

test("test_a_live_stream_draws_the_spectrum", () => {
  assert.equal(draw().filter((e) => e.name === "svg" && classes(e).includes("spectrum")).length, 1);
});

test("test_a_stereo_stream_draws_two_level_bars", () => {
  assert.equal(withClass("lvb").length, 2);
});

test("test_a_six_channel_stream_draws_six_level_bars", () => {
  stream({ channels: 6 });
  assert.equal(withClass("lvb").length, 6);
});

test("test_no_stream_draws_the_line_in_place_of_the_meter", () => {
  stream({ state: "0" });
  assert.deepEqual(
    draw()
      .filter((e) => ["mnone", "spectrum", "mrange"].some((c) => classes(e).includes(c)))
      .map((e) => classes(e)),
    [["mnone"]],
  );
});

/** The numbers down the level scale, top to bottom. */
function levelScale() {
  const scale = withClass("lvs")[0];
  return scale
    ? elements(scale.html)
        .filter((e) => e.name === "span")
        .map(num)
    : [];
}

test("test_the_level_scale_ends_at_a_shallow_levels_floor", () => {
  pickFloor(SHALLOW);
  const shallow = levelScale().at(-1);
  assert.equal(shallow, Number(SHALLOW));
});

test("test_the_level_scale_ends_at_a_deep_levels_floor", () => {
  pickFloor(DEEP);
  assert.equal(levelScale().at(-1), Number(DEEP));
});

test("test_changing_the_range_leaves_the_level_scale_where_it_was", () => {
  setPageRange(FIRST);
  const before = levelScale();
  setPageRange(LAST);
  assert.deepEqual(levelScale(), before);
});

test("test_a_bar_before_its_first_reading_hides_its_hold_mark", () => {
  const marks = withClass("hd").map((e) => /visibility:\s*hidden/.test(attr(e, "style") || ""));
  assert.deepEqual(marks, [true, true]);
});

test("test_the_spectrum_grid_carries_the_ridges_style_when_it_is_picked", () => {
  setSpectrumStyle(RIDGES);
  const grid = withClass("sgrid1")[0];
  assert.equal(grid ? attr(grid, "data-style") : undefined, RIDGES);
});

// ── color suites ────────────────────────────────────────────────────────

/**
 * The spectrum's markup under the Trace style and color suite `suite`.
 *
 * @param {string} suite
 */
function traceUnder(suite) {
  colorsStore.setSpectrumColors?.(suite);
  const svg = draw().find((e) => e.name === "svg" && classes(e).includes("spectrum"));
  return svg?.html;
}

test("test_a_change_of_suite_changes_what_the_trace_draws", () => {
  const mono = traceUnder(MONO);
  assert.notEqual(traceUnder(INFERNO), mono);
});

// ── the Accent palette ───────────────────────────────────────────────────

//: The palette that draws in the user's accent, as the store holds it.
const ACCENT = "accent";
//: Two custom accents, unlike each other.
const FIRST_HEX = "#4f9dde";
const SECOND_HEX = "#c03a9b";
//: An accent preset, as the theme store holds it, under the custom hexes.
const PRESET = "violet";

/**
 * The spectrum's markup under the Trace style and Accent, rendered once with the custom accent FIRST_HEX and again
 * after the accent becomes `then`: the second render's.
 *
 * @param {string} then
 */
function traceAfterChange(then) {
  accent.value = PRESET;
  accentHex.value = FIRST_HEX;
  traceUnder(ACCENT);
  accentHex.value = then;
  return traceUnder(ACCENT);
}

test("test_under_accent_the_trace_follows_a_change_of_accent", () => {
  assert.notEqual(traceAfterChange(SECOND_HEX), traceAfterChange(FIRST_HEX));
});
