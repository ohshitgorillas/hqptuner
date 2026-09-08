// Behavioral suite for components/ApodLamp.js — the header's apodizing
// indicator, a lamp whose brightness tracks how densely the current poll
// interval apodized.
//
// The lamp is a pure function of two stores it reads for itself: the apodizing
// history (store/apodhistory.js) and the preference that turns it on
// (store/prefs.js apodLight). It is driven exactly as
// tests/js/store/apodhistory.test.js and tests/js/components/enginehealth-strip.test.js
// drive the same history — a poll is a FRESH object written to engineStatus
// carrying the daemon's own Status fields, and the cadence a bin records is
// moved by writing the signals the app itself writes (liveMode, activeTab,
// quickSystemUpdates) and read back through store/ui.js's fastPollMs. Nothing
// of HQPTuner's is stubbed (docs/testing.md rule 4).
//
// Hazards, inherited from that seam:
//
//   1. Module state persists for the life of the file: every case starts a
//      fresh track of its own and sets the cadence and the preference it wants,
//      so no case depends on what the one before it left behind.
//   2. Writing the SAME object reference to engineStatus does not notify, so
//      every simulated poll must be a fresh object.
//
// The preference is driven by assigning its signal rather than through
// setApodLight(): this process has no localStorage, and persistence of that
// mechanism is not this file's subject — it is pinned in
// tests/js/store/plainnames-pref*.test.js and apodwindow-pref*.test.js.
//
// The preference is a tri-state — "off", "all", "uncorrected" — and on the
// last of the three the lamp reads what went UNCORRECTED, so the running
// filter's class becomes an input. That class joins by the raw engine name the
// Status frame reports as `active_filter` (docs/protocol.md) to the live
// enumeration's `arg` flags bitfield, bit 0 apodizing and bit 1 half-apodizing,
// which the daemon serves as a string: full "1", half "2", neither "0". The
// fixture below serves one filter of each class, with the `apodizing` field the
// backend derives from bit 0 alongside the raw `arg`, the way
// tests/js/components/controls/combobox-apod.test.js serves the same three.
//
// BRIGHTNESS IS READ AS A NUMBER AND NOTHING ELSE. The lamp carries a legend
// beside it and a hover title; both are owner-owned copy, so no case here
// names, counts or selects on a word of either (docs/testing.md rule 9). The
// one observable is the `--lamp` custom property on the element carrying
// data-testid="apod-lamp". The intensity curve itself is NOT contract and is
// deliberately not pinned: the density case below is a COMPARISON between two
// renders, so no case names the brightness any given rate happens to reach.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/apodlamp.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { elements, attr } from "../../support/markup.js";
import { readCadences, feed } from "../../support/apodpolls.js";
import { html } from "../../../../hqptuner/static/lib/dom.js";
import { ApodLamp } from "../../../../hqptuner/static/components/ApodLamp.js";
import { liveMode, apodLight } from "../../../../hqptuner/static/store/prefs.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { enums } from "../../../../hqptuner/static/store/signals.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

// The two cadences the app itself produces, read rather than assumed
// (tests/js/store/polling.test.js pins where each comes from).
const { live: LIVE_CADENCE, base: CADENCE } = readCadences();

// The density case can only tell a RATE from a raw event count if the two
// cadences differ. Guard rather than assert, so a store change that collapsed
// them fails loudly instead of quietly passing on a comparison that no longer
// means what it says.
if (LIVE_CADENCE === CADENCE) {
  throw new Error(`the LIVE and default cadences are both ${CADENCE}ms; this suite needs them to differ`);
}

// The density strip saturates at thirty events per second
// (tests/js/components/enginehealth-strip.test.js); both rates below stay well
// under it, so neither is pinned against a ceiling.
/**
 * How many events land in one bin recorded at `cadenceMs` to make `perSecond`.
 *
 * @param {number} cadenceMs
 * @param {number} perSecond
 * @returns {number}
 */
const inOneBin = (cadenceMs, perSecond) => (perSecond * cadenceMs) / 1000;

initApodHistory();

const lamp = () => render(html`<${ApodLamp} />`);

/**
 * The lamp element, located by its own test id — never by anything it reads.
 *
 * @param {string} out
 * @returns {MarkupElement}
 */
function lampElement(out) {
  const [found] = elements(out).filter((el) => attr(el, "data-testid") === "apod-lamp");
  if (!found) throw new Error("the render carries no apodizing lamp");
  return found;
}

/**
 * How bright the lamp is standing: the `--lamp` custom property, as a number.
 * Raises rather than guessing when the element carries no such property, so a
 * lamp coloured some other way fails the case that reads it instead of quietly
 * scoring dark.
 *
 * @param {string} out
 * @returns {number}
 */
function brightness(out) {
  const el = lampElement(out);
  const style = attr(el, "style");
  if (style === undefined) throw new Error("the lamp carries no style");
  const named = /--lamp\s*:\s*([^;]+)/.exec(style);
  if (!named) throw new Error(`the lamp's style carries no --lamp property: ${style}`);
  const value = Number(named[1].trim());
  if (!Number.isFinite(value)) throw new Error(`the lamp's --lamp is not a number: ${named[1]}`);
  return value;
}

/**
 * A fresh track whose recorded bins are exactly `deltas`, polled at the cadence
 * `live` selects, with the lamp switched on.
 *
 * @param {number[]} deltas
 * @param {boolean} [live]
 */
function lit(deltas, live = false) {
  apodLight.value = "all";
  liveMode.value = live;
  feed(deltas);
}

// --- brightness follows the RATE, not the raw count -----------------------------

test("test_a_denser_interval_lights_the_lamp_brighter_than_a_sparser_one", () => {
  // The two intervals are ordered one way by rate and the OTHER way by raw
  // count: ten events in a 1000ms bin is ten a second, twelve in a 2000ms bin
  // is six a second. So a lamp scoring the raw count draws the sparser interval
  // brighter, and a fixed-brightness flash draws them identically — the same
  // music at the two poll cadences is what this case is about.
  const dense = inOneBin(LIVE_CADENCE, 10);
  const sparse = inOneBin(CADENCE, 6);
  if (dense >= sparse) {
    throw new Error(`this case needs the denser interval to count FEWER events; got ${dense} and ${sparse}`);
  }
  lit([sparse], false);
  const cooler = brightness(lamp());
  lit([dense], true);
  assert.ok(
    brightness(lamp()) > cooler,
    `${dense} events in ${LIVE_CADENCE}ms must light brighter than ${sparse} in ${CADENCE}ms`,
  );
});

// --- an interval that counted nothing is dark ------------------------------------

test("test_an_interval_that_counted_no_apodizing_events_leaves_the_lamp_fully_dark", () => {
  // The newest interval counted nothing, on a track that HAS apodized: a lamp
  // resting at the floor of the ramp, lit whenever the page is up, reads above
  // zero here.
  lit([5, 0]);
  assert.equal(brightness(lamp()), 0);
});

// --- the preference gates the lamp entirely ----------------------------------------

test("test_the_lamp_does_not_render_when_the_preference_is_off", () => {
  lit([5]); // a track bright enough that only the preference can account for this
  apodLight.value = "off";
  assert.equal(elements(lamp()).filter((el) => attr(el, "data-testid") === "apod-lamp").length, 0);
});

// --- "On for uncorrected events" reads the running filter's class -----------------
//
// The three cases below are all COMPARISONS between two renders of the SAME bin,
// so no case names the brightness any given rate reaches — and each is swept
// across two rates that stand at different brightnesses, so a table keyed on
// (preference, filter class) alone cannot satisfy any of them.
//
// Both rates are recorded at the default cadence and stay well under the strip's
// thirty-per-second saturation, so neither arm of a comparison is pinned against
// a ceiling that would flatten the two apart.

// One filter of each class, named by the fixture and joined by that name. `arg`
// is the raw flags bitfield as a string; `apodizing` is bit 0, which the backend
// decodes and ships alongside it.
/** @type {[string, string][]} raw engine name, arg */
const CLASSES = [
  ["plain-a", "0"],
  ["full-a", "1"],
  ["half-a", "2"],
];

const [NEITHER, FULL, HALF] = CLASSES.map(([name]) => name);

function enumerate() {
  enums.value = {
    filters: CLASSES.map(([name, arg], i) => ({
      index: String(i),
      name,
      value: String(i),
      arg,
      description: "5/5 ⥮ Any",
      apodizing: arg === "1",
    })),
  };
}

/**
 * How bright the lamp stands for one bin of `perSecond` events, with `name` the
 * filter the daemon reports running and the preference at `mode`. A fresh track
 * each call, at the default cadence.
 *
 * @param {number} perSecond
 * @param {string} name
 * @param {string} mode
 * @returns {number}
 */
function standing(perSecond, name, mode) {
  enumerate();
  liveMode.value = false;
  apodLight.value = mode;
  feed([inOneBin(CADENCE, perSecond)], { active_filter: name });
  return brightness(lamp());
}

// A filter that corrects NOTHING leaves every event of the bin uncorrected; a
// half-apodizing one leaves half of each. So on "uncorrected" the first stands
// brighter than the second at the same rate — a mode that dimmed every stream by
// one flat correction, whatever was running, draws the two identically.
for (const perSecond of [5, 12]) {
  test(`test_on_uncorrected_a_non_apodizing_filter_outshines_a_half_apodizing_one: ${perSecond}/s`, () => {
    const plain = standing(perSecond, NEITHER, "uncorrected");
    const half = standing(perSecond, HALF, "uncorrected");
    assert.ok(plain > half, `at ${perSecond}/s a non-apodizing filter must outshine a half-apodizing one`);
  });
}

// Half-apodizing carries BOTH class bits' worth of meaning to a reader that
// checks full first, and such a reader takes this render dark. The owner asked
// for half of what the same bin stands at on "On for all events".
for (const perSecond of [5, 12]) {
  test(`test_a_half_apodizing_filter_stands_at_half_the_all_events_brightness: ${perSecond}/s`, () => {
    const all = standing(perSecond, HALF, "all");
    if (all <= 0) throw new Error(`this case needs the "all" render lit at ${perSecond}/s; it stands at ${all}`);
    assert.equal(standing(perSecond, HALF, "uncorrected"), all / 2);
  });
}

// A full apodizing filter corrects the lot, so "uncorrected" has nothing to
// report and the lamp is dark — while the same bin, on "all", is lit. Both are
// read, so a lamp publishing the bin's density whatever the mode fails on the
// dark half and a lamp that never lights fails on the lit one.
for (const perSecond of [5, 12]) {
  test(`test_a_full_apodizing_filter_stands_dark_on_uncorrected_while_lit_on_all: ${perSecond}/s`, () => {
    const all = standing(perSecond, FULL, "all");
    const uncorrected = standing(perSecond, FULL, "uncorrected");
    assert.deepEqual([uncorrected, all > 0], [0, true]);
  });
}
