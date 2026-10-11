// Structural suite for the one-home rule over the Settings drawers' controls: every browser pref, store switch or engine
// setting a Settings drawer draws has exactly one declared home, a declared local (store/schema/local.js) or an entry of
// the engine control catalog (store/schema.js), and the drawer item naming it carries nothing of its own: whatever it
// holds beside its id is the home's own value, never a second derivation. The Hardware drawer's engine attributes are
// stated here as the catalog entries they are.
//
// The helpers are drawer-homes.test.js's (tests/js/support/drawer-homes.js): a home is found by looking in both the
// catalog and the local module, so the suite does not presume which one an id belongs in.
//
// Every string asserted is a control id the drawers and their rendered suites already name (`data-field`) or a
// property name of a drawer item.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/drawer-homes-settings.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { BEHAVIOR_DRAWER } from "../../../../hqptuner/static/components/faceplate/settings/engine-rows.js";
import { HARDWARE_DRAWER } from "../../../../hqptuner/static/components/faceplate/settings/hardware.js";
import { VISUAL_DRAWER } from "../../../../hqptuner/static/components/faceplate/settings/visual.js";
import { homeCount, ownDerivations } from "../../support/drawer-homes.js";

/** Each control id with the Settings drawer that draws it. */
const CONTROLS = [
  { id: "pinallow", drawer: BEHAVIOR_DRAWER },
  { id: "hwallcpu", drawer: HARDWARE_DRAWER },
  { id: "hwallgpu", drawer: HARDWARE_DRAWER },
  { id: "multicore", drawer: HARDWARE_DRAWER },
  { id: "ecores", drawer: HARDWARE_DRAWER },
  { id: "cuda", drawer: HARDWARE_DRAWER },
  { id: "vstyle", drawer: VISUAL_DRAWER },
  { id: "vapod", drawer: VISUAL_DRAWER },
  { id: "vdys", drawer: VISUAL_DRAWER },
  { id: "vfill", drawer: VISUAL_DRAWER },
  { id: "vbottom", drawer: VISUAL_DRAWER },
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
