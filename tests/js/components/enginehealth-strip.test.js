// Behavioral suite for the Engine Health card's apodizing-events density strip:
// the chart-recorder band, its bars, and the time-window selector beside its
// heading.
//
// The strip is a pure function of the apodizing history store, so it is driven
// exactly as tests/js/store/apodhistory.test.js drives it — a poll is a FRESH
// object written to engineStatus carrying the daemon's own Status fields, and
// the cadence a bin records is moved by writing the signals the app itself
// writes (liveMode, activeTab, quickSystemUpdates) and read back through
// store/ui.js's fastPollMs. Nothing of HQPTuner's is stubbed (docs/testing.md
// rule 4), and the markup is read as a browser would present it.
//
// Hazards, inherited from that seam:
//
//   1. Module state persists for the life of the file: every case starts a
//      fresh track of its own, sets the cadence it wants, and sets the window
//      it wants, so no case depends on what the one before it left behind.
//   2. Writing the SAME object reference to engineStatus does not notify, so
//      every simulated poll must be a fresh object.
//   3. The strip's visibility flag is sticky by design, so the "hidden" case
//      hides it explicitly (a stopped engine) rather than assuming a fresh one.
//
// setApodWindow() runs here without the storage fake from
// tests/js/support/storage.js: this process has no localStorage, which is
// prefs.js's storage-disabled path, and every setter still moves its signal in
// memory. Persistence is not this file's subject.
//
// The window <select> cannot be operated by SSR — render-to-string fires no
// events — so the choose case reaches its handler through preact's own
// `options.vnode` seam, the renderer's public surface, as the combobox suites
// do. Nothing of the component's is stubbed to get there.
//
// Bar height maps the event count logarithmically and saturates; only the
// monotonicity and the saturation boundary are contract, so the formula itself
// is deliberately not pinned.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/enginehealth-strip.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { elements, classes, text } from "../support/markup.js";
import { renderWith } from "../support/wheel.js";
import { STOPPED, readCadences, poll, append, feed } from "../support/apodpolls.js";
import { html } from "../../../hqptuner/static/lib/dom.js";
import { EngineHealth } from "../../../hqptuner/static/components/EngineHealth.js";
import { liveMode, apodWindow, setApodWindow } from "../../../hqptuner/static/store/prefs.js";
import { initApodHistory } from "../../../hqptuner/static/store/apodhistory.js";

/** @typedef {import("../support/wheel.js").VNode} VNode */
/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// The two cadences the app itself produces, read rather than assumed
// (tests/js/store/polling.test.js pins where each comes from).
const { live: LIVE_CADENCE, base: CADENCE } = readCadences();

// The width case needs one cadence to be exactly twice the other, and the
// window-span cases read real millisecond sums. Guard rather than assert, so a
// store change that moved either cadence fails loudly instead of quietly
// passing on arithmetic that no longer means what it says.
if (LIVE_CADENCE !== 1000 || CADENCE !== 2000) {
  throw new Error(
    `this suite needs the LIVE cadence at 1000ms and the default at 2000ms; got ${LIVE_CADENCE}/${CADENCE}`,
  );
}

initApodHistory();

/** One render of the card, with every vnode preact built along the way. */
const renderCard = () => renderWith(html`<${EngineHealth} />`);

const card = () => renderCard().out;

/**
 * @param {string} out
 * @param {string} token
 * @returns {MarkupElement[]}
 */
const byClass = (out, token) => elements(out).filter((el) => classes(el).includes(token));

/**
 * The strip's section, head to close.
 *
 * @param {string} out
 * @returns {MarkupElement}
 */
function strip(out) {
  const [found] = byClass(out, "eh-strip");
  if (!found) throw new Error("the render carries no apodizing strip");
  return found;
}

/**
 * The trough's chart.
 *
 * @param {string} out
 * @returns {MarkupElement}
 */
function svg(out) {
  const [trough] = byClass(strip(out).html, "eh-strip-trough");
  if (!trough) throw new Error("the strip carries no trough");
  const [chart] = elements(trough.html).filter((el) => el.name === "svg");
  if (!chart) throw new Error("the trough carries no svg");
  return chart;
}

/**
 * The chart's own time span: the width of its viewBox, in milliseconds.
 *
 * @param {string} out
 * @returns {number}
 */
function spanMs(out) {
  const box = (/\sviewBox="([^"]*)"/.exec(svg(out).attrs) || [])[1];
  if (box === undefined) throw new Error("the chart carries no viewBox");
  return Number(box.split(/\s+/)[2]);
}

/**
 * @param {string} out
 * @returns {MarkupElement[]}
 */
const bars = (out) => elements(svg(out).html).filter((el) => el.name === "rect" && classes(el).includes("eh-bar"));

/**
 * @param {string} out
 * @returns {MarkupElement}
 */
function onlyBar(out) {
  const drawn = bars(out);
  if (drawn.length !== 1) throw new Error(`expected one bar, found ${drawn.length}`);
  return drawn[0];
}

/**
 * @param {MarkupElement} el
 * @param {string} name
 * @returns {number}
 */
function attrNum(el, name) {
  const raw = (new RegExp(`\\s${name}="([^"]*)"`).exec(el.attrs) || [])[1];
  if (raw === undefined) throw new Error(`<${el.name}> carries no ${name}`);
  return Number(raw);
}

/** @param {string} out */
const heading = (out) => {
  const [head] = byClass(strip(out).html, "eh-strip-head");
  if (!head) throw new Error("the strip carries no heading row");
  return head;
};

/** @param {string} out */
const optionsOf = (out) =>
  [...strip(out).html.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map((m) => ({
    value: (/ value="([^"]*)"/.exec(m[1]) || ["", ""])[1],
    selected: m[1].includes("selected"),
    label: m[2],
  }));

/**
 * Which window the picker shows: preact-render-to-string emits no `value` on a
 * <select>, it marks the matching <option selected> instead.
 *
 * @param {string} out
 * @returns {string | undefined}
 */
const shownWindow = (out) => (optionsOf(out).find((o) => o.selected) || { value: undefined }).value;

/**
 * The picker's own change handler, from the renderer's vnode seam.
 *
 * @param {VNode[]} seen
 * @returns {(event: object) => void}
 */
function chooser(seen) {
  const picker = seen.find((v) => v && v.type === "select" && v.props);
  if (!picker) throw new Error("the render carries no window picker");
  const handler = picker.props.onChange || picker.props.onInput;
  if (typeof handler !== "function") throw new Error("the window picker carries no change handler");
  return /** @type {(event: object) => void} */ (handler);
}

/** A track whose history is exactly `deltas`, drawn in `window`. */
/**
 * @param {number[]} deltas
 * @param {string} [window]
 * @param {boolean} [live]
 */
function shown(deltas, window = "30", live = false) {
  setApodWindow(window);
  liveMode.value = live;
  feed(deltas);
}

// --- the strip appears only when the track has apodized -------------------------

test("test_a_hidden_strip_puts_no_strip_section_in_the_card", () => {
  shown([2, 3]);
  poll({ state: STOPPED }); // the engine stopping hides it
  assert.equal(byClass(card(), "eh-strip").length, 0);
});

test("test_a_visible_strip_puts_a_strip_section_in_the_card", () => {
  shown([2, 3]);
  assert.equal(byClass(card(), "eh-strip").length, 1);
});

// --- one bar per counted interval -------------------------------------------------

test("test_every_visible_bin_that_counted_events_draws_its_own_bar", () => {
  shown([1, 2, 3]);
  assert.equal(bars(card()).length, 3);
});

test("test_an_interval_that_counted_nothing_draws_no_bar", () => {
  shown([1, 0, 2]);
  assert.equal(bars(card()).length, 2);
});

// --- a bar is as wide as the interval it stands for ---------------------------------

test("test_a_bar_covering_twice_the_interval_is_drawn_twice_as_wide", () => {
  shown([5], "30", false); // one bin at the 2000ms cadence
  const slow = attrNum(onlyBar(card()), "width");
  shown([5], "30", true); // one bin at the 1000ms cadence
  assert.equal(slow, 2 * attrNum(onlyBar(card()), "width"));
});

test("test_the_newest_bar_ends_at_the_right_edge_of_the_chart", () => {
  shown([1, 2, 3]);
  const out = card();
  const newest = bars(out).reduce((a, b) => (attrNum(a, "x") >= attrNum(b, "x") ? a : b));
  assert.equal(attrNum(newest, "x") + attrNum(newest, "width"), spanMs(out));
});

// --- a bar is as tall as the count it stands for -------------------------------------

test("test_a_busier_interval_is_drawn_taller", () => {
  shown([2]);
  const quiet = attrNum(onlyBar(card()), "height");
  shown([50]);
  assert.ok(attrNum(onlyBar(card()), "height") > quiet);
});

test("test_a_hundred_events_in_one_interval_draws_a_saturated_bar", () => {
  shown([100]);
  assert.deepEqual(classes(onlyBar(card())), ["eh-bar", "sat"]);
});

test("test_a_count_just_under_a_hundred_draws_an_unsaturated_bar", () => {
  shown([99]);
  assert.deepEqual(classes(onlyBar(card())), ["eh-bar"]);
});

// --- the chart spans the window, not the history ---------------------------------------

for (const seconds of [30, 60, 120, 300]) {
  test(`test_a_fixed_window_spans_its_own_seconds_however_little_has_been_recorded: ${seconds}s`, () => {
    shown([1, 2], String(seconds));
    assert.equal(spanMs(card()), seconds * 1000);
  });
}

test("test_the_whole_track_window_spans_the_recorded_intervals_it_shows", () => {
  // two bins at the 2000ms cadence, then one in LIVE at 1000ms
  shown([1, 2], "all", false);
  liveMode.value = true;
  append([3]);
  assert.equal(spanMs(card()), 2 * CADENCE + LIVE_CADENCE);
});

// --- the window picker -------------------------------------------------------------------

test("test_the_strip_is_headed_apodizing_events", () => {
  shown([1]);
  const [subhead] = byClass(heading(card()).html, "subhead");
  assert.equal(subhead && text(subhead), "Apodizing Events");
});

test("test_the_picker_offers_the_five_windows_shortest_first", () => {
  shown([1]);
  assert.deepEqual(
    optionsOf(card()).map((o) => o.label),
    ["30 s", "1 min", "2 min", "5 min", "All"],
  );
});

test("test_the_picker_shows_the_window_in_force", () => {
  shown([1], "120");
  assert.equal(shownWindow(card()), "120");
});

test("test_the_picker_shows_the_whole_track_window_when_it_is_in_force", () => {
  shown([1], "all");
  assert.equal(shownWindow(card()), "all");
});

test("test_choosing_a_window_moves_the_window_in_force", () => {
  shown([1], "30");
  chooser(renderCard().seen)({ target: { value: "60" } });
  assert.equal(apodWindow.value, "60");
});

// --- the counter beside the strip -----------------------------------------------------------

test("test_the_apodizing_counter_is_labelled_apodizing_counter", () => {
  shown([1]);
  assert.ok(elements(card()).some((el) => text(el) === "Apodizing counter"));
});
