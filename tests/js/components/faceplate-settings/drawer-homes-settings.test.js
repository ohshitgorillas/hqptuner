// Structural suite for the one-home rule over the Settings drawers' local rows: every browser pref or store switch a
// Settings drawer draws has exactly one declared home, a declared local (store/schema/local.js), and the drawer item
// naming it carries nothing of its own: whatever it holds beside its id is the home's own value, never a second
// derivation. The Hardware drawer's engine attributes are the catalog's and are not stated here.
//
// The helpers are drawer-homes.test.js's (tests/js/support/drawer-homes.js): a home is found by looking in both the
// catalog and the local module, so the suite does not presume which one an id belongs in.
//
// Every string asserted is a control id the drawers and their rendered suites already name (`data-field`) or a
// property name of a drawer item. The Visual drawer's Display row is found by the four display-format ids it offers in
// the rendered drawer (tests/js/support/fields-offering.js), not by an id the suite presumes.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/drawer-homes-settings.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { BEHAVIOR_DRAWER } from "../../../../hqptuner/static/components/faceplate/settings/engine-rows.js";
import { HARDWARE_DRAWER } from "../../../../hqptuner/static/components/faceplate/settings/hardware.js";
import { VISUAL_DRAWER } from "../../../../hqptuner/static/components/faceplate/settings/visual.js";
import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { homeCount, ownDerivations } from "../../support/drawer-homes.js";
import { fieldsOffering } from "../../support/fields-offering.js";

/** Each local control id with the Settings drawer that draws it. */
const CONTROLS = [
  { id: "pinallow", drawer: BEHAVIOR_DRAWER },
  { id: "hwallcpu", drawer: HARDWARE_DRAWER },
  { id: "hwallgpu", drawer: HARDWARE_DRAWER },
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

const FORMATS = ["auto", "expanded", "normal", "compact"];

/** The Visual drawer's Display row id, or a name no schema carries when the drawer draws none. */
const displayRow = () =>
  fieldsOffering(render(html`<${Drawer} schema=${VISUAL_DRAWER} />`), FORMATS)[0] ?? "(no display row)";

test("test_the_display_row_control_is_declared_in_exactly_one_home", async () => {
  assert.equal(await homeCount(displayRow()), 1);
});

test("test_the_display_row_drawer_item_derives_nothing_of_its_own", async () => {
  assert.deepEqual(await ownDerivations(VISUAL_DRAWER, displayRow()), []);
});
