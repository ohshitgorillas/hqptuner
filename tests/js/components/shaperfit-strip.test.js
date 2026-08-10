// Behavioral suite for where the rate/shaper alerts sit in
// components/AlertStrip.js — after the engine-health alerts, before the
// junk-filter advice chip, and present whether or not anything is playing.
//
// The strip has three sources and each has its own suite: engine health
// (alertstrip.test.js), the junk advice chip (junkadvice.test.js) and the
// rate/shaper conflicts (store/shaperfit-alerts.test.js, which owns the
// derivation). This one drives all three at once and pins only what the strip
// itself decides — the order they appear in, and that an empty strip is zero
// pixels.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// assigns a FRESH status object (writing the same reference to a signal does not
// notify), and the shaper inputs are stated at the wire by the shared fixture.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/shaperfit-strip.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { AlertStrip } from "../../../hqptuner/static/components/AlertStrip.js";
import { reset, DSD512, DSD1024, PCM_8X, MODULATOR } from "../support/shaperfit-fixtures.js";

/** @typedef {import("../support/shaperfit-fixtures.js").Scenario} Scenario */

const FLOORS = { sdm: { [MODULATOR]: 40960000 } };
// The engine will run SDM at DSD512 under a 40.96 MHz floor: one critical row.
/** @type {Scenario} */
const CONFLICTING = { chain: "sdm", mode: "2", sdmRate: DSD512, pcmRate: PCM_8X, floors: FLOORS };
// The same settings one tier up, where nothing is wrong.
const CONSISTENT = { ...CONFLICTING, sdmRate: DSD1024 };

const SHAPER_TEXT =
  "The current settings are invalid: modulator ASDM7EC is incompatible with DSD512 output. " +
  "HQPlayer cannot produce output.";
const HEALTH_TEXT = "Clipping ×13 this track";
const JUNK_TEXT = "Ultrasonic junk above 30 kHz suggests the 30k filter";

// Nothing playing: health derives no alert from an idle engine, so a strip with
// anything in it under this frame has something other than health in it.
const IDLE = () => ({ status: { state: "0", track_serial: "1" }, junk: null });
// Playing, clipping, with junk advice: one row from each of the other two
// sources, so the shaper rows have something to be ordered against.
const NOISY = () => ({
  status: { state: "2", track_serial: "1", process_speed: "1.5", clips: "13" },
  junk: { filter: "30k", reason: JUNK_TEXT, ceiling_khz: 30 },
});

const strip = () => render(html`<${AlertStrip} />`);

// Where each source's text landed, in the order they appear. A text the strip
// never rendered throws rather than sorting to the front: a missing row must
// fail loudly instead of quietly reordering the ones that are there.
/** @param {string} out */
function order(out) {
  const at = /** @type {[string, string][]} */ ([
    ["health", HEALTH_TEXT],
    ["shaper", SHAPER_TEXT],
    ["junk", JUNK_TEXT],
  ]).map(([name, text]) => {
    const i = out.indexOf(text);
    if (i < 0) throw new Error(`the strip rendered no ${name} row`);
    return { name, i };
  });
  return at.sort((a, b) => a.i - b.i).map((e) => e.name);
}

test("test_an_empty_strip_renders_nothing_at_all", async () => {
  await reset({ ...CONSISTENT, status: IDLE() });
  assert.equal(strip(), "");
});

test("test_a_shaper_conflict_renders_while_the_engine_is_stopped", async () => {
  // The conflict is in the settings, not in the playback: a strip that waited
  // for a transport would hide it exactly while the user is fixing it.
  await reset({ ...CONFLICTING, status: IDLE() });
  assert.ok(strip().includes(SHAPER_TEXT));
});

// Every class token of every element in the strip, so a severity can be looked
// for as a WHOLE token: a row that gains a class alongside `alert-crit` has not
// changed severity, and matching the attribute run whole would call that a
// regression.
/** @param {string} out */
const classTokens = (out) => [...out.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));

test("test_a_shaper_conflict_renders_at_its_own_severity_class", async () => {
  await reset({ ...CONFLICTING, status: IDLE() });
  assert.ok(classTokens(strip()).includes("alert-crit"));
});

test("test_the_shaper_rows_sit_between_the_health_alerts_and_the_junk_chip", async () => {
  await reset({ ...CONFLICTING, status: NOISY() });
  assert.deepEqual(order(strip()), ["health", "shaper", "junk"]);
});
