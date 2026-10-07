// Behavioral suite for the 1x PCM filter row of hqptuner/static/store/faceplate/drawer.js: the plate a drawer row
// shows for its staged option, the family, variant and leaf the filters plain-names overlay gives that option's
// engine name, and a pick from the row's list staging the picked name's /config form enum ID.
//
// The wire is the seam: the enumerations, State, /config form and overlays of tests/js/support/listsfixture.js with
// the SDM chain loaded and plain names on, so the PCM rows read their options off the /config form, and the staging
// fake of tests/js/support/wire/wire.js holding the pending buffer. Every engine name, enum ID, family, variant and
// leaf asserted is the fixture's own.
//
// drawer.js is imported under a built specifier so a checkout without its new exports fails per case, on an
// assertion, rather than at module link.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawer-plate.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config, staged } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { rowOptions } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { loadLists, resetLists } from "../../support/listsfixture.js";
import { quiesce, stagingWire } from "../../support/wire/wire.js";
import { useStorage } from "../../support/storage.js";

const DRAWER = new URL("../../../../hqptuner/static/store/faceplate/drawer.js", import.meta.url).href;
const drawer = await import(`${DRAWER}`);

/** The catalog key of the 1x PCM filter row, and the /config form field it stages into. */
const KEY = "pcm_filter_1x";
const FORM_FIELD = "filter1x";

/** The fixture's two PCM filter engine names: one plain family with no variant, one with a variant. */
const NONE = "none";
const GAUSS = "poly-sinc-gauss-long";

/** The fixture's plain-names breakdown of each, as the plate carries it; a filter has no rate-floor tier. */
const PLATE = {
  [NONE]: { fam: "Fam B", variant: null, leaf: "Leaf none", tier: "" },
  [GAUSS]: { fam: "Fam A", variant: "Var A", leaf: "Leaf gauss", tier: "" },
};

/** @type {import("../../support/wire/wire.js").StagingWire} */
let w = stagingWire();

beforeEach(async () => {
  useStorage();
  w = stagingWire();
  loadLists({ chain: "sdm", plain: true });
  resetLists();
  await discardAll();
});

/**
 * The /config form enum ID the 1x PCM row lists an engine name under.
 *
 * @param {string} name
 * @returns {string}
 */
const idOf = (name) => String(rowOptions(KEY).find((/** @type {{ label: string }} */ o) => o.label === name)?.value);

/**
 * Put the 1x PCM filter on the /config form at one engine name, so a pick of the other is a change.
 *
 * @param {string} name
 */
function runningOn(name) {
  const id = idOf(name);
  const form = config.value ?? { fields: [], file: {} };
  config.value = {
    ...form,
    fields: form.fields.map((/** @type {{ name: string }} */ f) => (f.name === FORM_FIELD ? { ...f, value: id } : f)),
  };
}

// --- the plate -----------------------------------------------------------------------------------------------------

test("test_the_plate_carries_the_plain_family_variant_and_leaf_of_the_staged_filter", async () => {
  await edit(KEY, idOf(NONE));
  assert.deepEqual(drawer.drawerPlate?.(KEY), PLATE[NONE]);
});

test("test_the_plate_carries_the_variant_of_a_staged_filter_whose_family_has_one", async () => {
  runningOn(NONE);
  await edit(KEY, idOf(GAUSS));
  assert.deepEqual(drawer.drawerPlate?.(KEY), PLATE[GAUSS]);
});

// --- the pick ------------------------------------------------------------------------------------------------------

test("test_a_pick_stages_the_picked_names_config_form_enum_id", async () => {
  runningOn(NONE);
  await drawer.drawerPick?.(KEY, GAUSS);
  await quiesce(w);
  assert.equal(staged.value.http[FORM_FIELD], idOf(GAUSS));
});
