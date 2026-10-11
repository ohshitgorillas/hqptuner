// Behavioral suite for the Speakers drawer's switch, `spken`, as an entry of the engine control catalog
// (store/schema.js over store/schema/): the entry carries a lane of its own, `speakers`, and the catalog's value for it
// reads the speakers form, the daemon's /speakers form with the drawer's draft over it.
//
// The value domain of the switch is the catalog's to choose, so the value cases assert a relation between two readings
// (the form switched on against switched off, the draft flipped against not) rather than a literal.
//
// The wire is the seam: each case writes the daemon's /speakers form into `speakers`, and the draft is reset through
// `discardDraft` on every case. Every source signal the catalog reads is reassigned, since module-level signals outlive
// a test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/spken-catalog.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { config, engineState, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { effective } from "../../../hqptuner/static/store/resolve.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { speakers, speakersBusy, speakersError } from "../../../hqptuner/static/store/matrix/speakers.js";
import { discardDraft, setSpeakersGate } from "../../../hqptuner/static/store/faceplate/drawers/speakers.js";
import { stagingWire } from "../support/wire/wire.js";

/** The catalog id of the Speakers drawer's switch. */
const SPKEN = "spken";

/** The lane the owner names for the speakers form's entries. */
const SPEAKERS_LANE = "speakers";

const LABELS = ["Left", "Right"];

/**
 * The daemon's /speakers form as the server parses it, with its switch.
 *
 * @param {boolean} enabled
 */
const form = (enabled) => ({
  enabled,
  channels: LABELS.map((label, index) => ({ index, label, level: 0, distance: 250 + index })),
});

/** @param {boolean} enabled  the daemon's switch */
async function reset(enabled) {
  stagingWire();
  engineState.value = {};
  config.value = { fields: [{ name: "direct_sdm", value: false }], file: {}, active: "" };
  matrixConfig.value = { fields: [], active: "[Default]" };
  speakers.value = form(enabled);
  speakersBusy.value = false;
  speakersError.value = "";
  await discardAll();
  discardDraft();
}

test("test_the_catalog_gives_spken_the_speakers_lane", () => {
  const entry = /** @type {Record<string, { lane?: unknown } | undefined>} */ (schema)[SPKEN];
  assert.equal(entry?.lane, SPEAKERS_LANE);
});

test("test_the_catalog_value_of_spken_follows_the_daemons_speakers_form", async () => {
  await reset(false);
  const off = effective(SPKEN);
  await reset(true);
  assert.notDeepEqual(effective(SPKEN), off);
});

test("test_the_catalog_value_of_spken_follows_the_drawers_draft_over_the_daemons_form", async () => {
  await reset(false);
  const daemon = effective(SPKEN);
  setSpeakersGate(true);
  assert.notDeepEqual(effective(SPKEN), daemon);
});
