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
// Density is carried by a column's FILL, not by its height: every drawn column
// is full height, and the density is read as a position along a continuous ramp
// across six stops, --spec-0 (the floor) to --spec-5 (busiest), each fill
// mixing two adjacent stops. The field is continuous — EVERY visible bin draws
// a column, a bin that counted nothing painting the floor rather than leaving a
// hole — and what a column reads is a RATE, events per second over the interval
// its bin observed, so the same music reads the same whichever cadence the page
// is polling at.
//
// What is contract, and what the cases below pin: the full height, the shape of
// the fill, a column per bin at its own place in time, the monotonicity, the
// rate being per second rather than per bin, the saturation point at thirty
// events per second read from both sides, and the scale being a fixed reference
// rather than a stretch over the window on screen. The interpolation itself is
// NOT contract and is deliberately not pinned — rampPosition() below reads a
// fill back as a position without asserting which position any given rate lands
// on, so no case names the percentage a count of 7 happens to reach.
//
// What is NOT contract here, beyond the interpolation: every word on screen,
// and the list of windows the picker offers. The strip's heading, the wording
// on each window, how many windows there are, the order they come in and the
// captions at the ends of the scale row are all owner-owned, reworded and
// reordered at will, so no case names or counts one (docs/testing.md rule 9).
// A heading is asserted to be present and to read something, and the scale
// row's left end to read something that changes with the window in force. The
// picker is pinned through its option VALUES alone — wire-level state rather
// than copy: which value is selected, and which value a choice puts in force.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/enginehealth-strip.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { elements, classes, text } from "../support/markup.js";
import { renderWith } from "../support/wheel.js";
import { STOPPED, readCadences, setApodCounter, poll, append, feed } from "../support/apodpolls.js";
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

// The rate the scale saturates at, in events per SECOND, and the count that
// reaches it in one bin recorded at a given cadence. A case that wants a rate
// asks for it in these terms rather than naming a per-bin count, so the same
// case still means what it says at either cadence.
const SATURATES_AT = 30;

/**
 * @param {number} cadenceMs
 * @param {number} [perSecond]
 * @returns {number}
 */
const inOneBin = (cadenceMs, perSecond = SATURATES_AT) => (perSecond * cadenceMs) / 1000;

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
 * The chart's own height: the height of its viewBox, in user units.
 *
 * @param {string} out
 * @returns {number}
 */
function boxHeight(out) {
  const box = (/\sviewBox="([^"]*)"/.exec(svg(out).attrs) || [])[1];
  if (box === undefined) throw new Error("the chart carries no viewBox");
  return Number(box.split(/\s+/)[3]);
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

// The ramp the density scale runs along: six CSS custom properties, --spec-0
// (the floor a silent bin paints) through --spec-5 (busiest), so a position is
// a number in [0, 5] and the stop a fill names IS its own position.
const RAMP_MIX =
  /fill:\s*color-mix\(\s*in\s+oklab\s*,\s*var\(\s*--spec-(\d+)\s*\)\s*([\d.]+)\s*%\s*,\s*var\(\s*--spec-(\d+)\s*\)\s*\)/;

/**
 * The two ramp stops a column's fill mixes and how far between them it sits,
 * read off the `fill:` its style carries. Which stops the fill names is its own
 * case below, so this reports the pair as it finds it and raises only when the
 * fill is not an oklab mix of two ramp stops at all.
 *
 * @param {MarkupElement} el
 * @returns {{ lower: number, upper: number, pct: number }}
 */
function rampMix(el) {
  const style = (/\sstyle="([^"]*)"/.exec(el.attrs) || [])[1];
  if (style === undefined) throw new Error(`<${el.name}> carries no style`);
  const mix = RAMP_MIX.exec(style);
  if (!mix) throw new Error(`the column's fill is not an oklab mix of two ramp stops: ${style}`);
  return { lower: Number(mix[3]), upper: Number(mix[1]), pct: Number(mix[2]) };
}

/**
 * Where a column sits along the density ramp: the two stops the fill mixes must
 * be ADJACENT, and the percentage carries the column that fraction of the way
 * from the lower stop to the next one up, so the position is
 * `lower + pct / 100` — a mix of --spec-1 at P% into --spec-0 sits at P/100,
 * and the floor stop alone sits at 0.
 *
 * Raises rather than guessing when the fill is not a mix of two adjacent ramp
 * stops, so a column coloured some other way fails the case that reads it
 * instead of quietly scoring the bottom of the ramp.
 *
 * @param {MarkupElement} el
 * @returns {number}
 */
function rampPosition(el) {
  const { lower, upper, pct } = rampMix(el);
  if (upper !== lower + 1) throw new Error(`the fill mixes non-adjacent ramp stops --spec-${lower}/--spec-${upper}`);
  if (lower < 0 || upper > 5) throw new Error(`the fill names --spec-${lower}/--spec-${upper}, outside the ramp`);
  if (pct < 0 || pct > 100) throw new Error(`the fill mixes ${pct}%, which is outside the ramp`);
  return lower + pct / 100;
}

/** @param {string} out */
const heading = (out) => {
  const [head] = byClass(strip(out).html, "eh-strip-head");
  if (!head) throw new Error("the strip carries no heading row");
  return head;
};

/**
 * What a reader sees at the LEFT end of the scale row under the field: the
 * first of the row's ends in document order. Located by the row's own end
 * marker rather than by a structural path, as the strip's other regions are.
 *
 * @param {string} out
 * @returns {string}
 */
function scaleLeft(out) {
  const ends = byClass(strip(out).html, "eh-scale-end");
  if (ends.length === 0) throw new Error("the strip carries no scale row ends");
  return text(ends.reduce((a, b) => (a.start <= b.start ? a : b)));
}

/** @param {string} out */
const optionsOf = (out) =>
  [...strip(out).html.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map((m) => ({
    value: (/ value="([^"]*)"/.exec(m[1]) || ["", ""])[1],
    selected: m[1].includes("selected"),
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
 * Every vnode of a props.children tree, flattened.
 *
 * @param {unknown} children
 * @param {VNode[]} [out]
 * @returns {VNode[]}
 */
function childList(children, out = []) {
  if (Array.isArray(children)) {
    for (const kid of children) childList(kid, out);
    return out;
  }
  if (children && typeof children === "object") out.push(/** @type {VNode} */ (children));
  return out;
}

/**
 * The values a <select> vnode offers, in order.
 *
 * @param {VNode} node
 * @returns {string[]}
 */
const offeredValues = (node) =>
  childList(node.props && node.props.children)
    .filter((v) => v && v.type === "option")
    .map((v) => String((v.props || {}).value ?? ""));

/**
 * The picker's own change handler, from the renderer's vnode seam.
 *
 * The card may grow other dropdowns, and "the first <select> preact built" would
 * quietly become one of those, so the picker is identified by the windows it
 * offers — the values read off the STRIP's own markup in the same render.
 *
 * @param {VNode[]} seen
 * @param {string[]} windows
 * @returns {(event: object) => void}
 */
function chooser(seen, windows) {
  const picker = seen.find(
    (v) => v && v.type === "select" && v.props && offeredValues(v).join(" ") === windows.join(" "),
  );
  if (!picker) throw new Error(`no window picker in the render offers [${windows}]`);
  const handler = picker.props.onChange || picker.props.onInput;
  if (typeof handler !== "function") throw new Error("the window picker carries no change handler");
  return /** @type {(event: object) => void} */ (handler);
}

/**
 * Whether anything on the card reads exactly this: a readout located by the
 * VALUE it shows, which is data rather than copy, so no wording the card is
 * free to change is named.
 *
 * @param {string} out
 * @param {string} reading
 * @returns {boolean}
 */
const reads = (out, reading) => elements(out).some((el) => text(el) === reading);

/**
 * @param {number} length
 * @param {(i: number) => number} f
 */
const series = (length, f) => Array.from({ length }, (_, i) => f(i));

/**
 * The drawn bars, oldest first.
 *
 * @param {string} out
 * @returns {MarkupElement[]}
 */
const inTimeOrder = (out) => [...bars(out)].sort((a, b) => attrNum(a, "x") - attrNum(b, "x"));

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

// --- one bar per visible bin, silent ones included -----------------------------------

test("test_every_visible_bin_draws_its_own_bar", () => {
  shown([1, 2, 3]);
  assert.equal(bars(card()).length, 3);
});

test("test_a_bin_that_counted_nothing_still_draws_its_own_bar", () => {
  shown([1, 0, 2]);
  assert.equal(bars(card()).length, 3);
});

test("test_a_bin_that_counted_nothing_is_drawn_at_the_floor_of_the_ramp", () => {
  // Silence is a painted reading, not an absence: the floor stop of the ramp.
  shown([0]);
  assert.equal(rampPosition(onlyBar(card())), 0);
});

// --- the field is continuous, and a bar stands where its interval happened -------------

test("test_a_quiet_stretch_leaves_no_unpainted_slot_between_the_bars", () => {
  // Three silent intervals between two counted ones. The strip is a field, not a
  // set of pillars: a renderer that skipped the silent bins would punch holes
  // through continuous playback, so every neighboring pair abuts exactly.
  shown([1, 0, 0, 0, 1]);
  const drawn = inTimeOrder(card());
  if (drawn.length !== 5) throw new Error(`expected the five bins to draw five bars, found ${drawn.length}`);
  // A pair that overlaps is still continuous, so the reading is "no bin begins
  // after its predecessor ended", never "every pair abuts exactly": how a
  // renderer hides the seam between two columns is its own business.
  const gaps = drawn
    .slice(1)
    .map((bar, i) => attrNum(bar, "x") - (attrNum(drawn[i], "x") + attrNum(drawn[i], "width")));
  assert.ok(Math.max(...gaps) <= 0, `the field leaves unpainted slots between bins: ${gaps.join(", ")}`);
});

test("test_a_bar_stands_at_its_own_place_in_time", () => {
  // Five bins at one cadence: the oldest and the newest stand four intervals
  // apart, wherever the field begins. A renderer that packed the bins at some
  // width of its own choosing draws them closer together.
  shown([1, 0, 0, 0, 1]);
  const drawn = inTimeOrder(card());
  if (drawn.length !== 5) throw new Error(`expected the five bins to draw five bars, found ${drawn.length}`);
  assert.equal(attrNum(drawn[4], "x") - attrNum(drawn[0], "x"), 4 * CADENCE);
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

// --- a bar stands full height, whatever it counted ------------------------------------

test("test_a_drawn_bar_is_as_tall_as_the_chart", () => {
  shown([3]);
  const out = card();
  assert.equal(attrNum(onlyBar(out), "height"), boxHeight(out));
});

test("test_a_busy_bar_is_no_taller_than_a_quiet_one", () => {
  shown([2]);
  const quiet = attrNum(onlyBar(card()), "height");
  shown([50]);
  assert.equal(attrNum(onlyBar(card()), "height"), quiet);
});

// --- a bar's colour is the rate it stands for --------------------------------------------

// Counts fed at the default cadence, so every pair stays below the rate that
// saturates (SATURATES_AT per second, inOneBin(CADENCE) events in one bin).
for (const [quiet, busy] of [
  [0, 1],
  [1, 2],
  [2, 20],
  [20, inOneBin(CADENCE) - 1],
]) {
  test(`test_a_busier_interval_is_drawn_hotter: ${quiet} then ${busy}`, () => {
    shown([quiet]);
    const cooler = rampPosition(onlyBar(card()));
    shown([busy]);
    assert.ok(rampPosition(onlyBar(card())) > cooler, `${busy} events must read hotter than ${quiet}`);
  });
}

test("test_a_bar_is_filled_by_mixing_two_adjacent_ramp_stops", () => {
  // The ramp is continuous, so a fill names one stop and its immediate
  // neighbor: a fill mixing --spec-1 with --spec-4 would put the column
  // somewhere no reading of the scale can name, and every position case would
  // report it as a monotonicity failure instead of as the wrong shape.
  shown([7]);
  const { lower, upper } = rampMix(onlyBar(card()));
  assert.equal(upper, lower + 1, `--spec-${lower} and --spec-${upper} are not adjacent stops of the ramp`);
});

test("test_the_same_rate_at_two_cadences_is_drawn_the_same", () => {
  // The reading is events per SECOND, not per bin: twenty events in a 2000ms bin
  // and ten in a 1000ms bin are the same music, so they are the same colour. A
  // renderer scoring the raw count draws the live page half as hot.
  const perSecond = 10;
  shown([inOneBin(CADENCE, perSecond)], "30", false);
  const slow = rampPosition(onlyBar(card()));
  shown([inOneBin(LIVE_CADENCE, perSecond)], "30", true);
  assert.equal(rampPosition(onlyBar(card())), slow);
});

test("test_a_rate_just_short_of_saturation_is_drawn_cooler_than_the_saturating_rate", () => {
  // The saturation POINT, from below: without this a renderer that flattened the
  // ramp well under thirty a second passes every other case in this section.
  shown([inOneBin(CADENCE) - 1]);
  const under = rampPosition(onlyBar(card()));
  shown([inOneBin(CADENCE)]);
  assert.ok(rampPosition(onlyBar(card())) > under, "a rate just short of saturation must read cooler than saturation");
});

test("test_the_saturating_rate_draws_the_top_of_the_ramp", () => {
  shown([inOneBin(CADENCE)]);
  assert.equal(rampPosition(onlyBar(card())), 5);
});

test("test_a_rate_past_saturation_is_drawn_the_same_as_the_saturating_rate", () => {
  shown([inOneBin(CADENCE)]);
  const top = rampPosition(onlyBar(card()));
  shown([inOneBin(CADENCE) * 8]);
  assert.equal(rampPosition(onlyBar(card())), top);
});

test("test_a_rate_reads_the_same_beside_a_busier_interval_as_it_does_alone", () => {
  // The scale is a fixed reference, not a stretch over whatever is on screen: an
  // implementation that normalized each window against its own busiest bin draws
  // the lone 5 at the top of the ramp and the same 5 near the floor beside a bin
  // that saturates.
  shown([5]);
  const alone = rampPosition(onlyBar(card()));
  shown([5, inOneBin(CADENCE)]);
  assert.equal(rampPosition(inTimeOrder(card())[0]), alone);
});

test("test_no_bar_is_marked_saturated", () => {
  // Read off the column itself, not off the card: absence asserted across the
  // whole card passes just as well when the strip draws no columns at all.
  shown([400]);
  const marks = classes(onlyBar(card()));
  assert.ok(!marks.includes("sat"), `a saturated count is marked with a class of its own: ${marks.join(" ")}`);
});

// --- the chart spans the window, not the history ---------------------------------------

for (const seconds of [30, 60, 120, 300]) {
  test(`test_a_fixed_window_spans_its_own_seconds_however_little_has_been_recorded: ${seconds}s`, () => {
    shown([1, 2], String(seconds));
    assert.equal(spanMs(card()), seconds * 1000);
  });
}

test("test_a_history_longer_than_the_window_draws_only_the_bars_the_window_holds", () => {
  // Every interval counted, so a bar per bin the window admits and nothing else:
  // a chart drawing the whole history instead of the window's slice draws twenty.
  const fits = Math.floor(30000 / CADENCE);
  shown(
    series(fits + 5, () => 1),
    "30",
  );
  assert.equal(bars(card()).length, fits);
});

test("test_the_whole_track_window_spans_the_recorded_intervals_it_shows", () => {
  // two bins at the 2000ms cadence, then one in LIVE at 1000ms
  shown([1, 2], "all", false);
  liveMode.value = true;
  append([3]);
  assert.equal(spanMs(card()), 2 * CADENCE + LIVE_CADENCE);
});

// --- the window picker -------------------------------------------------------------------

test("test_the_strip_carries_a_heading_of_its_own", () => {
  // That the field is announced at all, not what it is called: the wording is
  // owner-owned copy and moves without any behavior moving with it.
  shown([1]);
  const [subhead] = byClass(heading(card()).html, "subhead");
  assert.ok(subhead !== undefined && text(subhead) !== "", "the strip's heading row announces nothing");
});

test("test_the_picker_shows_the_window_in_force", () => {
  shown([1], "120");
  assert.equal(shownWindow(card()), "120");
});

test("test_the_picker_shows_the_whole_track_window_when_it_is_in_force", () => {
  shown([1], "all");
  assert.equal(shownWindow(card()), "all");
});

// --- what the left end of the scale row reads ---------------------------------------------

test("test_the_left_end_of_the_scale_row_reads_something", () => {
  // The far end of the field is announced at all. What it says there is copy.
  shown([1, 2], "30");
  assert.ok(scaleLeft(card()) !== "", "the left end of the scale row reads nothing");
});

test("test_the_whole_track_window_reads_a_different_left_end_than_a_fixed_window", () => {
  // The whole-track window has no span to name, so its left end must draw a
  // distinction against a window that does. That a distinction is drawn is the
  // behavior; the two wordings are the owner's.
  shown([1, 2], "300");
  const fixed = scaleLeft(card());
  shown([1, 2], "all");
  assert.notEqual(scaleLeft(card()), fixed);
});

test("test_two_fixed_windows_read_different_left_ends", () => {
  // The reading follows the window in force rather than standing still: a
  // renderer that printed one fixed caption for every span passes the case
  // above and fails this one.
  shown([1, 2], "30");
  const short = scaleLeft(card());
  shown([1, 2], "300");
  assert.notEqual(scaleLeft(card()), short);
});

test("test_choosing_a_window_moves_the_window_in_force", () => {
  shown([1], "30");
  const rendered = renderCard();
  chooser(
    rendered.seen,
    optionsOf(rendered.out).map((o) => o.value),
  )({ target: { value: "60" } });
  assert.equal(apodWindow.value, "60");
});

// --- the counter beside the strip -----------------------------------------------------------

test("test_the_apodizing_counter_reads_the_daemon_count_plus_this_tracks_events", () => {
  // The arithmetic, read off the card as a number: 400 stood on the daemon's
  // running counter before the track began and this track has counted 137, so
  // 537 is a reading no other stat on the card can land on. The words standing
  // beside it are copy and are not asserted on.
  setApodCounter(400);
  shown([137]);
  assert.ok(reads(card(), "537"), "no reading on the card totals the daemon counter and this track's events");
});
