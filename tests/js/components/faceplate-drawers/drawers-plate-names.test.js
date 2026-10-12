// Rendered suite for the nameplate a stage drawer's option row draws (hqptuner/static/components/faceplate/drawer/):
// under the Standard option style the closed plate reads the engine's option name and nothing beside it, as
// HQPlayer's own picker does.
//
// Renders the Resampling drawer through preact-render-to-string with the store driven at the wire: the engine, its
// /config form and the plain-names overlay from tests/js/support/listsfixture.js (SDM chain loaded), the option style
// set through the preference, and the staging fake answering the REST paths. The row is found by its catalog key
// (`data-k`), its plate by the list it opens (`data-list`); the engine name asserted is the fixture's own.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-plate-names.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { RESAMPLING_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/modes.js";
import { pendingPreset } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { stagingWire } from "../../support/wire/wire.js";
import { loadLists, resetLists } from "../../support/listsfixture.js";
import { attr, elements, text } from "../../support/markup.js";

/** The loaded SDM chain's 1x filter row, by its catalog key. */
const ROW = "sdm_filter_1x";

/** The engine name the fixture's /config form picks for that row, one its plain-names overlay files under a family. */
const PICKED = "poly-sinc-gauss-long";

beforeEach(async () => {
  stagingWire();
  loadLists({ chain: "sdm", plain: false });
  resetLists();
  pendingPreset.value = null;
  openStage.value = RESAMPLING_DRAWER.id;
  cancel();
  await discardAll();
});

/** What the row's nameplate reads, or a string saying there is none, so a missing plate never reads as a name. */
function plateText() {
  const all = elements(render(html`<${Drawer} schema=${RESAMPLING_DRAWER} />`));
  const row = all.find((e) => attr(e, "data-k") === ROW);
  const plate = row && elements(row.html).find((e) => e.name === "button" && attr(e, "data-list") === ROW);
  return plate ? text(plate) : "no nameplate";
}

test("test_under_standard_a_drawer_rows_nameplate_reads_the_engine_name_alone", () => {
  assert.equal(plateText(), PICKED);
});
