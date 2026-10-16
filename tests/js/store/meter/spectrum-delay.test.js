// Store suite for the spectrum delay, store/meter/delay.js: how far behind the feed's edge the playhead sits.
//
// Three values. The user's spectrum offset is the text typed in the Display popover's Delay box, in seconds, kept in
// the browser under `hqptuner.spectrumOffset` and 0 where nothing is stored; `setSpectrumOffset` takes the box's text
// and `spectrumOffset` holds it. The engine's delay is the daemon's `output_delay` on the Status poll
// (docs/spec/protocol.md, Status), microseconds on the wire and seconds in the store; it is a view of an Engine reading
// (docs/spec/settings-truth.md rule 5), so it holds no copy of its own and is nothing the moment the reading it was
// taken from is gone, absent from the reading, or the reading itself absent. The effective delay, `effectiveDelay`, is
// the engine delay (nothing counting as 0) plus the offset, never below zero.
//
// What the box does with text outside -5 to 5 or text that is not a number is not settled by the spec or by the box's
// own min, max and step, and nothing here asserts it. Whether a zero `output_delay` reads as no engine delay or as an
// engine delay of 0 cannot be seen through these three names, since both add nothing to the effective delay.
//
// The engine reading reaches the store at the wire: a fresh /api/status object on engineStatus, its Status fields
// strings as the route serves them. Storage is the fake from tests/js/support/storage.js, installed and seeded at file
// scope before the module is first imported, since the stored offset is read when the module loads; the cases that
// read what a page loads with use instances under `.fresh-<tag>.js` specifiers (tests/js/support/vendor-resolve.js),
// which no case types into and which share signals.js with the main one.
//
// The surface is read off the module namespace with optional access, so a module without a name fails these cases on
// their assertions. Every value is read as a number: the offset may be held as the typed text or as its number. A case
// that changes the reading reads the effective delay once before the change, as a paint would, so a copy taken then is
// there to be caught.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrum-delay.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { useStorage } from "../../support/storage.js";
import { near } from "../../support/near.js";

const MODULE = "../../../../hqptuner/static/store/meter/delay.js";
const KEY = "hqptuner.spectrumOffset";

// Two offsets the browser may hold from an earlier visit, one each side of zero, both inside the box's span.
const STORED_LATE = "1.25";
const STORED_EARLY = "-0.75";

// Offsets a case types into the box.
const TYPED = "0.5";
// Early, but by less than the engine delay, so the sum stays above zero.
const TYPED_AGAIN = "-0.125";
// An offset earlier than the engine's delay is late, so the sum falls below zero.
const TYPED_EARLY = "-1";

// The daemon's output_delay as the status route carries it, microseconds as a string, and the same delay in seconds.
const ENGINE_DELAY_US = "250000";
const ENGINE_DELAY_S = 0.25;

// Exact in binary at every value used here; the margin only keeps the cases off float formatting.
const SAME_S = 1e-9;

/**
 * The spectrum delay surface.
 *
 * @typedef {{
 *   spectrumOffset?: { value: unknown },
 *   setSpectrumOffset?(text: string): void,
 *   effectiveDelay?: { value: unknown },
 * }} DelaySurface
 */

/**
 * A held value read as seconds; nothing held reads as NaN, so it never passes for zero.
 *
 * @param {unknown} v
 * @returns {number}
 */
const seconds = (v) => (v == null || v === "" ? Number.NaN : Number(v));

/**
 * One fresh status poll carrying the given Status fields.
 *
 * @param {Record<string, string>} fields
 */
function poll(fields) {
  engineStatus.value = {
    status: { state: "2", ...fields },
    metadata: null,
    junk: null,
    autopilot: false,
    metering: true,
    advisor: false,
  };
}

const storage = useStorage();
storage.setItem(KEY, STORED_LATE);

/** @type {DelaySurface} */
const delay = await import(MODULE);

/** @type {DelaySurface} */
const late = await import(MODULE.replace(/\.js$/, ".fresh-delay-late.js"));

storage.setItem(KEY, STORED_EARLY);
/** @type {DelaySurface} */
const early = await import(MODULE.replace(/\.js$/, ".fresh-delay-early.js"));

storage.removeItem(KEY);
/** @type {DelaySurface} */
const unset = await import(MODULE.replace(/\.js$/, ".fresh-delay-unset.js"));

/** The effective delay in force, in seconds, read as the meter loop reads it on a paint. */
const effective = () => seconds(delay.effectiveDelay?.value);

beforeEach(() => {
  engineStatus.value = null;
  delay.setSpectrumOffset?.(TYPED);
});

// --- the offset the browser holds is the offset the page comes up with -------------------------------------------------

test("test_a_stored_late_offset_is_the_offset_the_page_loads_with", () => {
  assert.ok(...near(seconds(late.spectrumOffset?.value), Number(STORED_LATE), SAME_S));
});

test("test_a_stored_early_offset_is_the_offset_the_page_loads_with", () => {
  assert.ok(...near(seconds(early.spectrumOffset?.value), Number(STORED_EARLY), SAME_S));
});

test("test_a_browser_holding_no_offset_loads_an_offset_of_zero", () => {
  assert.ok(...near(seconds(unset.spectrumOffset?.value), 0, SAME_S));
});

// --- a typed offset is kept and takes effect ---------------------------------------------------------------------------

test("test_typing_an_offset_stores_it_under_the_browser_key", () => {
  delay.setSpectrumOffset?.(TYPED_AGAIN);
  assert.ok(...near(seconds(storage.getItem(KEY)), Number(TYPED_AGAIN), SAME_S));
});

test("test_typing_an_offset_makes_it_the_offset_in_force", () => {
  delay.setSpectrumOffset?.(TYPED_AGAIN);
  assert.ok(...near(seconds(delay.spectrumOffset?.value), Number(TYPED_AGAIN), SAME_S));
});

// --- the effective delay -----------------------------------------------------------------------------------------------

test("test_with_no_engine_reading_the_effective_delay_is_the_offset", () => {
  assert.ok(...near(effective(), Number(TYPED), SAME_S));
});

test("test_the_engines_output_delay_adds_its_microseconds_as_seconds_to_the_effective_delay", () => {
  poll({ output_delay: ENGINE_DELAY_US });
  assert.ok(...near(effective() - Number(TYPED), ENGINE_DELAY_S, SAME_S));
});

test("test_the_effective_delay_follows_a_typed_offset_while_the_engine_delay_stands", () => {
  poll({ output_delay: ENGINE_DELAY_US });
  const before = effective();
  delay.setSpectrumOffset?.(TYPED_AGAIN);
  assert.ok(...near(effective() - before, Number(TYPED_AGAIN) - Number(TYPED), SAME_S));
});

test("test_an_offset_earlier_than_the_engine_delay_floors_the_effective_delay_at_zero", () => {
  poll({ output_delay: ENGINE_DELAY_US });
  delay.setSpectrumOffset?.(TYPED_EARLY);
  assert.ok(...near(effective(), 0, SAME_S));
});

// --- the engine delay is a view of the reading and nothing more ----------------------------------------------------

test("test_the_engine_delay_is_gone_the_moment_the_status_reading_is_gone", () => {
  poll({ output_delay: ENGINE_DELAY_US });
  effective();
  engineStatus.value = null;
  assert.ok(...near(effective(), Number(TYPED), SAME_S));
});

test("test_a_reading_without_output_delay_leaves_no_engine_delay_from_the_reading_before_it", () => {
  poll({ output_delay: ENGINE_DELAY_US });
  effective();
  poll({});
  assert.ok(...near(effective(), Number(TYPED), SAME_S));
});
