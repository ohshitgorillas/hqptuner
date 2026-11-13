// Structural suite for the one-home rule over the stage drawers' controls: every control a drawer draws has exactly one
// declared home, the engine catalog (`schema`, store/schema.js over store/schema/) for anything a lane writes, or a
// declared local (store/schema/local.js) for a browser pref or a store switch, and the drawer item naming it carries
// nothing of its own: whatever it holds beside its id is the home's own value, never a second derivation.
//
// The suite does not presume which home an id belongs in. A home is found by looking in both: the catalog by key, the
// local module by any export holding the id as a key. The local module is imported dynamically, so a tree without it
// reads as one with no locals declared rather than failing to load.
//
// Every string asserted is a control id the drawers and their rendered suites already name (`data-field`,
// `data-choice`) or a property name of a drawer item.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawer-homes.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { HF_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/hf.js";
import { SHAPING_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/modes.js";
import { SPEAKERS_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/speakers-drawer.js";
import { VOLUME_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/volume.js";
import { homeCount, ownDerivations } from "../../support/drawer-homes.js";

/** Each control id with the drawer that draws it. */
const CONTROLS = [
  { id: "autopilot", drawer: HF_DRAWER },
  { id: "dactype", drawer: SHAPING_DRAWER },
  { id: "dacchip", drawer: SHAPING_DRAWER },
  { id: "fixed_mode", drawer: VOLUME_DRAWER },
  { id: "spken", drawer: SPEAKERS_DRAWER },
];

for (const { id } of CONTROLS) {
  test(`test_the_${id}_control_is_declared_in_exactly_one_home`, async () => {
    assert.equal(await homeCount(id), 1);
  });
}

for (const { id, drawer } of CONTROLS) {
  test(`test_the_${id}_drawer_item_derives_nothing_of_its_own`, async () => {
    assert.deepEqual(await ownDerivations(drawer, id), []);
  });
}
