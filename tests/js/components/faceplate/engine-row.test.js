// Rendered suite for hqptuner/static/components/faceplate/EngineRow.js: the engine row's speed gauge, buffer meters and
// event counters, drawn from the Status poll. The readings themselves are store/faceplate/engine.js's, pinned in
// tests/js/store/faceplate/engine.test.js; this suite pins how the row draws them: the needle swings with the speed,
// the figure and each buffer take their zone, a reading with nothing to show prints no figure and no zone, and a
// counter's lamp lights while this track has counted.
//
// The wire is the seam: each case writes Status frames into `engineStatus`, as the poll does, with the health store's
// baseline effect registered so this track's deltas and the output buffer's latch follow the frames. Every case starts
// a track of its own.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/engine-row.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { EngineRow } from "../../../../hqptuner/static/components/faceplate/EngineRow.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { initHealth } from "../../../../hqptuner/static/store/health.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {Record<string, string>} Frame */

initHealth();

/** A Status frame while playing. @type {Frame} */
const PLAYING = {
  state: "2",
  process_speed: "1.62",
  input_fill: "0.82",
  output_fill: "0.74",
  clips: "3",
  apod: "5398",
};

let track = 0;

/**
 * The row's elements after a track starts on `first` and the poll then reads `frame` on the same track.
 *
 * @param {Frame} frame  overrides on PLAYING
 * @param {Frame} [first]  overrides on PLAYING for the track's first frame; the same as `frame` when omitted
 */
function row(frame, first = frame) {
  track += 1;
  const serial = String(track);
  engineStatus.value = { status: { ...PLAYING, ...first, track_serial: serial } };
  engineStatus.value = { status: { ...PLAYING, ...frame, track_serial: serial } };
  return elements(render(html`<${EngineRow} />`));
}

/** @param {MarkupElement[]} all @param {string} cls */
const byClass = (all, cls) => all.find((e) => classes(e).includes(cls));

/** @param {MarkupElement[]} all @param {string} k */
const keyed = (all, k) => all.find((e) => attr(e, "data-k") === k);

/** A zone attribute, empty when it renders bare; undefined when the element or the attribute is missing. */
const zoneOf = (/** @type {MarkupElement | undefined} */ e) =>
  e && hasAttr(e, "data-zone") ? (attr(e, "data-zone") ?? "") : undefined;

/** @param {Frame} f */
const needleX = (f) => {
  const n = byClass(row(f), "ndl");
  return Number(n ? attr(n, "x2") : NaN);
};

/** @param {Frame} f */
const figureZone = (f) => zoneOf(byClass(row(f), "val"));

/** @param {Frame} f @param {string} k */
const meter = (f, k) => keyed(row(f), k);

/** @param {MarkupElement | undefined} e @param {string} cls */
const inside = (e, cls) => (e ? byClass(elements(e.html), cls) : undefined);

/**
 * Whether a counter's lamp is lit.
 *
 * @param {MarkupElement[]} all
 * @param {string} k
 */
const lit = (all, k) => {
  const lamp = inside(keyed(all, k), "lamp");
  return lamp ? classes(lamp).includes("bad") : undefined;
};

/**
 * The digits of each count a counter prints, this track's first.
 *
 * @param {MarkupElement[]} all
 * @param {string} k
 */
const counts = (all, k) => {
  const c = keyed(all, k);
  const cnts = c ? elements(c.html).filter((e) => classes(e).includes("cnt")) : [];
  return cnts.map((e) => text(e).replace(/\D/g, ""));
};

// --- the gauge ---------------------------------------------------------------------------------------------------

test("test_a_faster_engine_swings_the_needle_further_right", () => {
  assert.ok(needleX({ process_speed: "2.0" }) > needleX({ process_speed: "0.9" }));
});

test("test_the_speed_figure_takes_the_zone_its_needle_sits_in", () => {
  const zones = ["0.8", "0.9", "1.5"].map((s) => figureZone({ process_speed: s }));
  assert.deepEqual(zones, ["bad", "warn", "ok"]);
});

test("test_a_stopped_engine_gives_the_figure_no_zone", () => {
  assert.deepEqual([figureZone({}), figureZone({ state: "0" })], ["ok", ""]);
});

test("test_the_figure_prints_the_reported_speed", () => {
  const val = byClass(row({ process_speed: "1.37" }), "val");
  assert.match(val ? text(val) : "", /1\.37/);
});

// --- the buffers -------------------------------------------------------------------------------------------------

test("test_a_buffer_fills_its_bar_to_its_percent", () => {
  const fill = inside(meter({ input_fill: "0.82" }, "input_fill"), "fill");
  assert.match(fill ? attr(fill, "style") || "" : "", /width:\s*82%/);
});

test("test_a_buffer_prints_its_percent", () => {
  const mv = inside(meter({ input_fill: "0.82" }, "input_fill"), "mv");
  assert.match(mv ? text(mv) : "", /82/);
});

test("test_a_buffer_takes_the_zone_its_fill_reads", () => {
  const zones = ["0.1", "0.3", "0.82"].map((f) => zoneOf(meter({ input_fill: f }, "input_fill")));
  assert.deepEqual(zones, ["bad", "warn", "ok"]);
});

test("test_an_output_buffer_that_never_filled_this_track_prints_no_figure_and_no_zone", () => {
  const filled = meter({}, "output_fill");
  const never = meter({ output_fill: "0" }, "output_fill");
  const figure = (/** @type {MarkupElement | undefined} */ e) => {
    const mv = inside(e, "mv");
    return mv ? /\d/.test(text(mv)) : undefined;
  };
  assert.deepEqual([figure(filled), zoneOf(filled), figure(never), zoneOf(never)], [true, "ok", false, ""]);
});

// --- the counters ------------------------------------------------------------------------------------------------

test("test_the_clip_lamp_lights_while_this_track_has_clipped", () => {
  const clipped = row({ clips: "5" }, { clips: "3" });
  const clean = row({ clips: "3" });
  assert.deepEqual([lit(clipped, "clips"), lit(clean, "clips")], [true, false]);
});

test("test_the_apodizing_lamp_lights_while_this_track_has_counted", () => {
  const counted = row({ apod: "5410" }, { apod: "5398" });
  const clean = row({ apod: "5398" });
  assert.deepEqual([lit(counted, "apod"), lit(clean, "apod")], [true, false]);
});

test("test_a_counter_prints_this_tracks_count_over_the_total", () => {
  assert.deepEqual(counts(row({ apod: "5410" }, { apod: "5398" }), "apod"), ["12", "5410"]);
});

test("test_a_stopped_engine_prints_no_counts", () => {
  assert.deepEqual(counts(row({ state: "0" }), "clips"), ["", ""]);
});
