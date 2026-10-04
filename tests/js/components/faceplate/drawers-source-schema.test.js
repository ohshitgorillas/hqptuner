// Rendered suite for hqptuner/static/components/faceplate/drawers/source-drawer.js: the Source drawer drawn from its schema
// by the generic drawer. Its one tab holds the meter block, mounted from the schema's blocks, and nothing in it stages,
// so the apply group never shows. What the meter draws is tests/js/components/faceplate/drawers-source.test.js's.
//
// Renders through preact-render-to-string, with no stream open, so the meter is in its idle state. Panels are found by
// `data-tab`, the block by `data-block`, the meter's state by `data-meter` and the apply group by its `data-testid`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/drawers-source-schema.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import {
  SOURCE_BLOCKS,
  SOURCE_DRAWER,
} from "../../../../hqptuner/static/components/faceplate/drawers/source-drawer.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { useStorage } from "../../support/storage.js";
import { attr, elements, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const draw = () => elements(render(html`<${Drawer} schema=${SOURCE_DRAWER} blocks=${SOURCE_BLOCKS} />`));

beforeEach(() => {
  useStorage();
  engineStatus.value = { status: { state: "0" }, metering: true };
  openStage.value = "source";
});

test("test_the_meter_block_mounts_the_source_meter", () => {
  const block = draw().find((e) => attr(e, "data-block") === "meter");
  const states = block ? elements(block.html).filter((e) => hasAttr(e, "data-meter")) : [];
  assert.deepEqual(
    states.map((e) => attr(e, "data-meter")),
    ["idle"],
  );
});

test("test_the_meter_tab_shows_with_the_apply_group_hidden", () => {
  const all = draw();
  const panel = all.find((e) => hasAttr(e, "data-tab") && !hasAttr(e, "hidden"));
  const group = all.find((e) => attr(e, "data-testid") === "apply-group");
  assert.deepEqual(
    [panel ? attr(panel, "data-tab") : undefined, group ? hasAttr(group, "hidden") : undefined],
    ["meter", true],
  );
});
