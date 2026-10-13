// Rendered suite for hqptuner/static/components/faceplate/drawers/pipelines-drawer.js: the DSP pipelines drawer drawn
// from its schema by the generic drawer. Its tabs are the Overview and one per output the pipeline set feeds, and a
// staged pipeline set dots the tab it shows. What the Overview and an output tab draw is
// tests/js/components/faceplate-drawers/drawers-pipelines.test.js's.
//
// Renders through preact-render-to-string; the store is driven at the wire by the staging fake, the pipeline set
// reaching it as the config file's canonical JSON. Tabs are found by `role` and `data-tab`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-pipelines-schema.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import {
  PIPELINES_BLOCKS,
  PIPELINES_DRAWER,
} from "../../../../hqptuner/static/components/faceplate/drawers/pipelines-drawer.js";
import { engineState } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, stagePipelines } from "../../../../hqptuner/static/store/actions.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { showTab } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { quiesce, stagingWire } from "../../support/wire/wire.js";
import { attr, classes, elements } from "../../support/markup.js";
import { loadPipelines, plain } from "../../support/rendered/pipelines-fixture.js";

/** @type {ReturnType<typeof stagingWire>} */
let wire;

beforeEach(async () => {
  wire = stagingWire();
  engineState.value = {};
  openPopover.value = null;
  openStage.value = "pipelines";
  loadPipelines([plain(0, 0), plain(1, 1)]);
  await discardAll();
  showTab(PIPELINES_DRAWER.id, "overview");
});

/** The drawer's tab buttons. */
const tabs = () =>
  elements(render(html`<${Drawer} schema=${PIPELINES_DRAWER} blocks=${PIPELINES_BLOCKS} />`)).filter(
    (e) => attr(e, "role") === "tab",
  );

test("test_the_tabs_follow_the_outputs_the_pipeline_set_feeds", () => {
  loadPipelines([plain(0, 0), plain(1, 3), plain(0, 3)]);
  assert.deepEqual(
    tabs().map((e) => attr(e, "data-tab")),
    ["overview", "out0", "out3"],
  );
});

/** Whether the Overview tab carries the dirty dot, or null when it is not drawn. */
const dotted = () => {
  const tab = tabs().find((e) => attr(e, "data-tab") === "overview");
  return tab ? classes(tab).includes("dirty") : null;
};

test("test_a_staged_pipeline_set_dots_the_tab_it_shows", async () => {
  stagePipelines([plain(0, 0), plain(1, 1), plain(0, 1)]);
  await quiesce(wire);
  assert.equal(dotted(), true);
});
