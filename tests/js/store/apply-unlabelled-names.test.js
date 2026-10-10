// Behavioral suite for how the apply summary names a control whose own schema
// entry carries no label of its own: the five card gates, which the card's
// title names, and the fixed-volume level, which shares its row with the
// fixed-volume gate (tests/js/components/chrome/card-gates.test.js). Each is
// named by the label of its own catalog entry.
//
// The persistent lane reports a divergence by wire key (docs/openapi.json,
// RestoreUnconverged: "Fields are wire keys"). The user knows each of these
// controls by the name the page shows for it, so the summary names it that way
// and never shows the wire key in its place.
//
// Every case runs in the state the page is always in: the /api/metadata
// catalog loaded, carrying a name for each control. The names are this file's
// own fixture strings, so asserting them back pins no shipped wording
// (docs/testing.md rule 9), and each differs from every key so a summary that
// shows a key cannot pass for one that shows the name.
//
// Driven over the fake wire in tests/js/support/threetrees.js. No store
// function is stubbed.

import test from "node:test";
import assert from "node:assert/strict";

import { applyAll, lastApply } from "../../../hqptuner/static/store/actions.js";
import { metadata } from "../../../hqptuner/static/store/signals.js";
import { route, trees } from "../support/threetrees.js";

// Each control with no label of its own, by the wire key the persistent lane
// reports it under: the post-process gates by their /matrix form field
// (card-gates.test.js), the matrix engine's gate by its config-XML mapping
// (docs/matrix-spec.md, wire truth), the log switch and the fixed level by
// their /config form fields (docs/settings-classification.md).
/** @type {[string, string][]} */
const UNLABELLED_CONTROLS = [
  ["crossfeed_enabled", "post_bauer_enabled"],
  ["dac_correction_enabled", "post_correction_enabled"],
  ["loudness_enabled", "post_loudness_enabled"],
  ["matrix_enabled", "matrix_enabled"],
  ["log_enabled", "log_enabled"],
  ["fixed_volume", "fixed_volume"],
];

// The five card gates, each with the name this file's catalog gives it.
/** @type {Record<string, string>} */
const GATE_NAMES = {
  crossfeed_enabled: "Fixture Blend Stage",
  dac_correction_enabled: "Fixture Converter Fix",
  loudness_enabled: "Fixture Quiet Lift",
  matrix_enabled: "Fixture Routing Grid",
  log_enabled: "Fixture Diary Switch",
};
const GATE_WIRE_KEYS = Object.fromEntries(UNLABELLED_CONTROLS);

// The fixed-volume level's wire key and the name its own catalog entry gives
// it, and the gate it shares a row with, whose entry rides along as it does on
// the page.
const FIXED_LEVEL_KEY = "fixed_volume";
const FIXED_LEVEL_NAME = "Fixture Steady Level";
const FIXED_LEVEL_ROW = "fixed_volume_enabled";

// A control does not always read its catalog entry under its own key:
// `dac_correction_enabled` reads `dac_correction` (card-gates.test.js). The
// gate's name is filed under both, so either read finds the same one.
/** @type {Record<string, { label: string, tooltip: string }>} */
const ENTRIES = {
  ...Object.fromEntries(Object.entries(GATE_NAMES).map(([k, name]) => [k, { label: name, tooltip: `${k} prose.` }])),
  dac_correction: { label: GATE_NAMES.dac_correction_enabled, tooltip: "dac_correction prose." },
  [FIXED_LEVEL_KEY]: { label: FIXED_LEVEL_NAME, tooltip: `${FIXED_LEVEL_KEY} prose.` },
  [FIXED_LEVEL_ROW]: { label: "Fixture Volume Lock", tooltip: `${FIXED_LEVEL_ROW} prose.` },
};

// The /api/metadata payload: the settings catalog keyed by tab group, plus the
// filter and shaper overlays. Every entry rides in all three groups, because
// the group a key is filed under is not the behavior under test.
const CATALOG = () => ({
  settings: { dsp: { ...ENTRIES }, volume: { ...ENTRIES }, system: { ...ENTRIES } },
  filters: { filters: {}, aliases: {} },
  shapers: { sdm_modulators: {} },
});

/**
 * The summary text after an apply whose persistent lane never converged on
 * the given wire keys, with the page's catalog loaded.
 *
 * @param {Record<string, unknown>} diff
 * @returns {Promise<string>}
 */
async function unconverged(diff) {
  metadata.value = CATALOG();
  await trees();
  route({ apply: { persistent: { applied: false, reason: "unconverged", diff } } });
  await applyAll();
  if (lastApply.value === null) throw new Error("expected an apply verdict, none was recorded");
  return String(lastApply.value.text);
}

for (const [control, wireKey] of UNLABELLED_CONTROLS) {
  test(`test_an_unconverged_${control}_is_shown_without_its_wire_key`, async () => {
    const text = await unconverged({ [wireKey]: {} });
    assert.ok(!text.includes(wireKey), text);
  });
}

for (const [control, name] of Object.entries(GATE_NAMES)) {
  test(`test_an_unconverged_${control}_is_named_by_the_name_the_catalog_gives_it`, async () => {
    const text = await unconverged({ [GATE_WIRE_KEYS[control]]: {} });
    assert.ok(text.includes(name), text);
  });
}

test("test_an_unconverged_fixed_volume_is_named_by_the_name_its_catalog_entry_gives_it", async () => {
  const text = await unconverged({ [FIXED_LEVEL_KEY]: {} });
  assert.ok(text.includes(FIXED_LEVEL_NAME), text);
});
