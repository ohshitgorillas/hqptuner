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

import { elements, attr } from "../support/markup.js";
import { readCadences, feed } from "../support/apodpolls.js";
import { html } from "../../../hqptuner/static/lib/dom.js";
import { ApodLamp } from "../../../hqptuner/static/components/ApodLamp.js";
import { liveMode, apodLight } from "../../../hqptuner/static/store/prefs.js";
import { initApodHistory } from "../../../hqptuner/static/store/apodhistory.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

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
  apodLight.value = true;
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
  apodLight.value = false;
  assert.equal(elements(lamp()).filter((el) => attr(el, "data-testid") === "apod-lamp").length, 0);
});
