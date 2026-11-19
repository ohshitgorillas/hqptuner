// Rendered suite for where the faceplate (the frame hqptuner/static/app.js composes) shows the failures of three areas
// no one read before: a failed apply, a failed live write (one that threw, and one HQPlayer refused, its report naming
// a setting that did not verify) and a failed live snapshot (its apply, and its list). Each shows as one warning line
// directly under the top bar, and tapping that line takes it down. Clearing on the area's next success is pinned at
// the store in tests/js/store/faceplate-alerts/alerts-unread.test.js.
//
// The wire is the seam, as tests/js/components/faceplate-alerts/plate-dropped.test.js drives it: each area's own
// exported verb runs over tests/js/support/wire/unreadwire.js, whose table answers a success or a failure in the
// backend's real shapes (tests/js/support/unreadareas.js), and the rest of the plate's state is set the way that file
// sets it. The region under the top bar is read through tests/js/support/plateline.js,
// and taps are fired through the renderer's vnode seam, since render-to-string fires no events. The sentences are
// owner copy and are nowhere in this file: a line is an element carrying a severity.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/plate-unread.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import { readPlate, shownLines, lineTap } from "../../support/plateline.js";
import { attr } from "../../support/markup.js";
import { quiesce } from "../../support/wire/wire.js";
import { unreadWire, STATE, ENUMS, BOOK } from "../../support/wire/unreadwire.js";
import { FAILURES, fail, succeedEverywhere } from "../../support/unreadareas.js";
import { TAP, resetPlateSignals, seedDay, settlePlate, restoreFetch } from "../../support/rendered/alerts.js";

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

/** The plate's design size. */
const DESIGN_SIZE = { w: 1080, h: 810 };

/** The severity the owner gave these lines, as a line carries it. */
const WARN = "warn";

/** @type {StagingWire} */
let wire;

beforeEach(async () => {
  wire = unreadWire();
  viewport.value = { ...DESIGN_SIZE };
  resetPlateSignals({ state: STATE(), enumerations: ENUMS(), book: BOOK() });
  await discardAll();
  await quiesce(wire);
  await seedDay();
  settlePlate();
  await succeedEverywhere(wire);
});

afterEach(restoreFetch);

/** How many warning lines show directly under the top bar. */
const warnings = () => shownLines(readPlate().under).filter((e) => attr(e, "data-sev") === WARN).length;

/** Tap the first warning line directly under the top bar, if one takes a tap, and wait for the wire to go quiet. */
async function tapWarning() {
  const { seen, under } = readPlate();
  const onTap = lineTap(seen, WARN, under);
  if (typeof onTap === "function") await Promise.resolve(onTap(TAP)).catch(() => undefined);
  await quiesce(wire);
}

for (const name of Object.keys(FAILURES)) {
  test(`test_${name}_shows_one_warning_line_under_the_top_bar`, async () => {
    const base = warnings();
    await fail(wire, name);
    assert.equal(warnings() - base, 1);
  });
}

for (const name of ["a_failed_apply", "a_live_write_that_threw", "a_failed_snapshot_apply"]) {
  test(`test_tapping_the_line_${name}_raised_takes_it_from_under_the_top_bar`, async () => {
    const base = warnings();
    await fail(wire, name);
    const raised = warnings() - base;
    await tapWarning();
    assert.deepEqual([raised, warnings() - base], [1, 0]);
  });
}
