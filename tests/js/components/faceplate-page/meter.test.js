// Rendered suite for hqptuner/static/components/faceplate/page/SourceMeter.js: the page's Source section body. With a
// stream it draws the spectrum with its Range control, a readout between a narrower and a wider button, and one level
// bar per channel, and at 13″ the readings table under the bars; slim, the table and the heads give way. With none it draws the no-stream line in the meter's place. Which
// state holds is the store's (tests/js/store/faceplate-page/meter.test.js); what moves is painted each animation frame
// (tests/js/components/faceplate-page/sourcepaint.test.js); this suite covers what the section renders to paint into.
//
// Renders through preact-render-to-string. A tap is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events. The stream reaches the store at the wire: METER feed events through the
// EventSource fake, playback through a fresh /api/status object; the plate through the window size the entry writes.
// The Range control's readout and buttons are found by `data-testid`; every string asserted is a wire value or a
// number derived from one, minus signs read back as numbers. The Levels floor is picked through the store's setter,
// read off the module namespace with optional access so a store without one fails the floor cases on their assertions.
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
import * as uiPrefs from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const FULL = { w: 1366, h: 1024 };
const SLIM = { w: 1080, h: 810 };
//: A spectrum style other than the trace, so the grid's data-style shows the pick.
const RIDGES = "ridges";

// The Ranges the page offers are the owner's: the cases pick by place in the offered set, never by value.
const [FIRST = ""] = PAGE_RANGES;
const LAST = PAGE_RANGES.at(-1) ?? "";

// The same Ranges by span, narrowest first: a wider Range spans more dB.
const SPANS = [...PAGE_RANGES].sort((a, b) => Number(a) - Number(b));
const NARROWEST = SPANS[0] ?? "";
const WIDEST = SPANS.at(-1) ?? "";

// The Range control's parts, by `data-testid`.
const READOUT = "range-readout";
const WIDER = "range-wider";
const NARROWER = "range-narrower";

// Two Levels floors the owner offers, as the store holds them, in dBFS.
const SHALLOW = "-48";
const DEEP = "-90";

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

/**
 * The elements carrying `data-testid` `id`.
 *
 * @param {string} id
 */
const byTestid = (id) => draw().filter((e) => attr(e, "data-testid") === id);

/** The number the Range readout shows. */
const readout = () => num(byTestid(READOUT)[0]);

/**
 * Whether the Range button `id` shows dimmed: disabled, or marked disabled for assistive technology; undefined when
 * the page draws no such button.
 *
 * @param {string} id
 */
function dimmed(id) {
  const button = byTestid(id)[0];
  return button ? hasAttr(button, "disabled") || attr(button, "aria-disabled") === "true" : undefined;
}

/**
 * Tap the Range button `id`, or nothing when none is drawn or it takes no tap.
 *
 * @param {string} id
 */
function press(id) {
  const { seen } = renderTree(html`<${SourceMeter} />`);
  const hit = seen.find((n) => n.props?.["data-testid"] === id);
  const fn = hit?.props.onClick;
  if (typeof fn === "function") fn();
}

beforeEach(() => {
  useStorage();
  setPageRange(FIRST);
  pickFloor(SHALLOW);
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

test("test_no_button_on_the_page_picks_a_range_by_its_value", () => {
  assert.equal(draw().filter((e) => e.name === "button" && PAGE_RANGES.includes(attr(e, "data-v") ?? "")).length, 0);
});

test("test_the_range_readout_shows_the_pages_range", () => {
  setPageRange(NARROWEST);
  const narrow = readout();
  setPageRange(WIDEST);
  assert.deepEqual([narrow, readout()], [Number(NARROWEST), Number(WIDEST)]);
});

test("test_wider_widens_the_range_one_step", () => {
  setPageRange(NARROWEST);
  press(WIDER);
  assert.equal(pageRange.value, SPANS[1]);
});

test("test_narrower_narrows_the_range_one_step", () => {
  setPageRange(WIDEST);
  press(NARROWER);
  assert.equal(pageRange.value, SPANS.at(-2));
});

test("test_wider_at_the_widest_range_leaves_the_readout_at_the_widest", () => {
  setPageRange(WIDEST);
  press(WIDER);
  assert.equal(readout(), Number(WIDEST));
});

test("test_narrower_at_the_narrowest_range_leaves_the_readout_at_the_narrowest", () => {
  setPageRange(NARROWEST);
  press(NARROWER);
  assert.equal(readout(), Number(NARROWEST));
});

test("test_wider_shows_dimmed_only_at_the_widest_range", () => {
  setPageRange(NARROWEST);
  const below = dimmed(WIDER);
  setPageRange(WIDEST);
  assert.deepEqual([below, dimmed(WIDER)], [false, true]);
});

test("test_narrower_shows_dimmed_only_at_the_narrowest_range", () => {
  setPageRange(WIDEST);
  const above = dimmed(NARROWER);
  setPageRange(NARROWEST);
  assert.deepEqual([above, dimmed(NARROWER)], [false, true]);
});

test("test_the_frequency_axis_labels_the_source_nyquist", () => {
  stream({ nyquist: 48000 });
  assert.equal(num(draw().find((e) => hasAttr(e, "data-nyq"))), 48);
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

test("test_the_level_scale_ends_at_the_levels_floor", () => {
  pickFloor(SHALLOW);
  const shallow = levelScale().at(-1);
  pickFloor(DEEP);
  assert.deepEqual([shallow, levelScale().at(-1)], [Number(SHALLOW), Number(DEEP)]);
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

test("test_a_13_inch_plate_draws_the_readings_table", () => {
  assert.equal(withClass("lvtab").length, 1);
});

test("test_a_slim_plate_draws_no_readings_table", () => {
  viewport.value = SLIM;
  assert.equal(withClass("lvtab").length, 0);
});

test("test_a_slim_plate_still_draws_the_range_readout", () => {
  viewport.value = SLIM;
  assert.equal(byTestid(READOUT).length, 1);
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
