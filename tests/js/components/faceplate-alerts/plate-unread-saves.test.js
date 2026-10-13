// Rendered suite for where the faceplate (the frame hqptuner/static/app.js composes) tells the user that a save the
// server refused did not land, for three saves: a profile description, a favorite star and the narrowing facets. The
// refusal shows as one `warn` line directly under the top bar, and tapping that line takes it off the plate. That a
// later successful save in the same area takes the alert down is pinned at the store lane, in
// tests/js/store/faceplate-alerts/alerts-unread-saves.test.js.
//
// The wire is the seam: each save goes through the store's own public API, and the three REST paths are answered by
// the route table in tests/js/support/wire/unreadsaves.js inside a `stagingWire`, which answers the staging reads. The
// rest of the plate's state is set the way tests/js/components/faceplate-alerts/plate-dropped.test.js sets it, with a
// healthy reading that lists nothing dropped, so no other line sits under the top bar. The region under the top bar is
// read through tests/js/support/plateline.js. Taps are fired through the renderer's vnode seam, since render-to-string
// fires no events. The sentences are owner copy and are nowhere in this file: a line is an element carrying a severity.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/plate-unread-saves.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "../../support/domseam.js";
import {
  health,
  config,
  pendingPreset,
  engineState,
  engineStatus,
  matrixConfig,
  lastApply,
} from "../../../../hqptuner/static/store/signals.js";
import { applying, discardAll } from "../../../../hqptuner/static/store/actions.js";
import { engineBusy } from "../../../../hqptuner/static/store/enginewrite.js";
import { liveBook, livePresets } from "../../../../hqptuner/static/store/live/presets.js";
import { unfolded } from "../../../../hqptuner/static/store/faceplate/stations.js";
import { body, openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import { readPlate, shownLines, lineTap } from "../../support/plateline.js";
import { attr } from "../../support/markup.js";
import { stagingWire, quiesce } from "../../support/wire/wire.js";
import { AREAS, save, saveRoutes, resetSaves } from "../../support/wire/unreadsaves.js";

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** The plate's design size. */
const DESIGN_SIZE = { w: 1080, h: 810 };

/** The severity a refused save's line carries. */
const WARN = "warn";

/** A /api/health reading whose credentials the daemon accepted and which lists no dropped setting. */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true, info: {}, dropped_settings: [] };

/** A tap event: the members a tap handler may call. */
const TAP = { preventDefault() {}, stopPropagation() {}, target: {}, currentTarget: {} };

/** @type {StagingWire} */
let wire;

beforeEach(async () => {
  wire = stagingWire({ routes: saveRoutes });
  viewport.value = { ...DESIGN_SIZE };
  engineState.value = {};
  engineStatus.value = null;
  matrixConfig.value = { fields: [] };
  config.value = {
    fields: [],
    file: {},
    active: "Day",
    profiles: { value: "Day", options: ["", "Day"].map((n) => ({ value: n, label: n })) },
  };
  liveBook.value = {};
  livePresets.value = null;
  lastApply.value = null;
  pendingPreset.value = null;
  await discardAll();
  await resetSaves();
  await quiesce(wire);
  health.value = { ...HEALTHY };
  applying.value = false;
  engineBusy.value = false;
  unfolded.value = null;
  body.value = "chain";
  openPopover.value = null;
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

/** How many `warn` lines show directly under the top bar. */
const warnsUnderBar = () => shownLines(readPlate().under).filter((e) => attr(e, "data-sev") === WARN).length;

/** How many `warn` lines the faceplate renders anywhere, under the top bar or elsewhere. */
const warnsOnPlate = () =>
  readPlate().seen.filter((v) => typeof v.type === "string" && v.props["data-sev"] === WARN).length;

/** Tap the first `warn` line the faceplate renders, wherever it is, and wait for the wire to go quiet. */
async function tapWarn() {
  const onTap = lineTap(readPlate().seen, WARN);
  if (typeof onTap === "function") await Promise.resolve(onTap(TAP)).catch(() => undefined);
  await quiesce(wire);
}

for (const area of AREAS) {
  test(`test_a_refused_${area}_save_shows_one_warn_line_under_the_top_bar`, async () => {
    const before = warnsUnderBar();
    await save(area, true);
    assert.equal(warnsUnderBar() - before, 1);
  });

  test(`test_tapping_the_line_a_refused_${area}_save_raised_takes_it_off_the_plate`, async () => {
    const before = warnsOnPlate();
    await save(area, true);
    const raised = warnsOnPlate() - before;
    await tapWarn();
    assert.deepEqual([raised, warnsOnPlate() - before], [1, 0]);
  });
}
