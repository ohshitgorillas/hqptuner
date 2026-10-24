// The Speakers drawer's switch follows the daemon form with the drawer's draft over it.
//
// The value cases assert a relation between two readings
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
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { loadSpeakers } from "../../../hqptuner/static/store/matrix/speakers.js";
import {
  discardDraft,
  setSpeakersGate,
  speakerDraft,
} from "../../../hqptuner/static/store/faceplate/drawers/speakers.js";
import { ok, stagingWire } from "../support/wire/wire.js";

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
  stagingWire({ routes: (path) => (path === "/api/speakers" ? ok({ data: form(enabled) }) : undefined) });
  engineState.value = {};
  config.value = { fields: [{ name: "direct_sdm", value: false }], file: {}, active: "" };
  matrixConfig.value = { fields: [], active: "[Default]" };
  await loadSpeakers();
  await discardAll();
  discardDraft();
}

test("test_the_speakers_switch_follows_the_daemons_speakers_form", async () => {
  await reset(false);
  const off = speakerDraft().enabled;
  await reset(true);
  assert.notDeepEqual(speakerDraft().enabled, off);
});

test("test_the_speakers_switch_follows_the_drawers_draft_over_the_daemons_form", async () => {
  await reset(false);
  const daemon = speakerDraft().enabled;
  setSpeakersGate(true);
  assert.notDeepEqual(speakerDraft().enabled, daemon);
});
