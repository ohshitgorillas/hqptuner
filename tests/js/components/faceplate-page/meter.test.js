// Rendered suite for hqptuner/static/components/faceplate/page/SourceMeter.js: the page's Source section body. With a
// stream it draws the Range column, the spectrum and one level bar per channel, and at 13″ the readings table under
// the bars; slim, the table and the heads give way. With none it draws the no-stream line in the meter's place. Which
// state holds is the store's (tests/js/store/faceplate-page/meter.test.js); what moves is painted each animation frame
// (tests/js/components/faceplate-page/sourcepaint.test.js); this suite covers what the section renders to paint into.
//
// Renders through preact-render-to-string. A tap is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events. The stream reaches the store at the wire: METER feed events through the
// EventSource fake, playback through a fresh /api/status object; the plate through the window size the entry writes.
// The Range switch is found by `data-testid` and its options by `data-v`; every string asserted is a wire value or a
// number derived from one, minus signs read back as numbers.
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
import { PAGE_RANGES, pageRange, setPageRange } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/view.js";
import { setSpectrumStyle } from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const FULL = { w: 1366, h: 1024 };
const SLIM = { w: 1080, h: 810 };
//: A spectrum style other than the trace, so the grid's data-style shows the pick.
const RIDGES = "ridges";

// The Ranges the switch offers are the owner's: the cases pick by place in the offered set, never by value.
const [FIRST = "", SECOND = ""] = PAGE_RANGES;
const LAST = PAGE_RANGES.at(-1) ?? "";

/**
 * Open a fresh feed over one /api/status object, and send the geometry event.
 *
 * @param {{ state?: string, nyquist?: number, channels?: number }} [o]
 */
function stream({ state = "2", nyquist = 22050, channels = 2 } = {}) {
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(() => 0);
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

/** The option values lit in the Range switch. */
function lit() {
  const group = draw().find((e) => attr(e, "data-testid") === "page-range");
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
  const { seen } = renderTree(html`<${SourceMeter} />`);
  const hit = seen.find((n) => n.type === "button" && n.props["data-v"] === v);
  const fn = hit?.props.onClick;
  if (typeof fn === "function") fn();
}

beforeEach(() => {
  useStorage();
  setPageRange(FIRST);
  setSpectrumStyle("trace");
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

test("test_the_range_switch_lights_the_pages_range", () => {
  setPageRange(SECOND);
  assert.deepEqual(lit(), [SECOND]);
});

test("test_tapping_a_range_picks_it", () => {
  tap(LAST);
  assert.equal(pageRange.value, LAST);
});

test("test_the_frequency_axis_labels_the_source_nyquist", () => {
  stream({ nyquist: 48000 });
  assert.equal(num(draw().find((e) => hasAttr(e, "data-nyq"))), 48);
});

test("test_the_level_scale_ends_at_the_pages_range", () => {
  setPageRange(SECOND);
  const scale = withClass("lvs")[0];
  const last = scale
    ? elements(scale.html)
        .filter((e) => e.name === "span")
        .at(-1)
    : undefined;
  assert.equal(num(last), -Number(SECOND));
});

test("test_a_bar_before_its_first_reading_hides_its_hold_mark", () => {
  const marks = withClass("hd").map((e) => /visibility:\s*hidden/.test(attr(e, "style") || ""));
  assert.deepEqual(marks, [true, true]);
});

test("test_a_13_inch_plate_draws_the_readings_table", () => {
  assert.equal(withClass("lvtab").length, 1);
});

test("test_a_slim_plate_draws_no_readings_table", () => {
  viewport.value = SLIM;
  assert.equal(withClass("lvtab").length, 0);
});

test("test_a_slim_plate_still_draws_the_range_column", () => {
  viewport.value = SLIM;
  assert.equal(withClass("mrange").length, 1);
});

test("test_the_spectrum_plot_stacks_the_spectrum_svg_then_the_effects_canvas_then_the_shader_canvas", () => {
  const layers = ["svg.spectrum", "canvas.sfx", "canvas.sgl"];
  const plot = withClass("splot")[0];
  const order = plot
    ? elements(plot.html)
        .flatMap((e) => classes(e).map((c) => ({ start: e.start, layer: `${e.name}.${c}` })))
        .filter((e) => layers.includes(e.layer))
        .sort((a, b) => a.start - b.start)
        .map((e) => e.layer)
    : [];
  assert.deepEqual(order, layers);
});

test("test_the_spectrum_grid_carries_the_ridges_style_when_it_is_picked", () => {
  setSpectrumStyle(RIDGES);
  const grid = withClass("sgrid1")[0];
  assert.equal(grid ? attr(grid, "data-style") : undefined, RIDGES);
});
