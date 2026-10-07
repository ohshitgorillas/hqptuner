// Rendered suite for hqptuner/static/components/faceplate/drawers/matrix-family.js: the Crossfeed and Loudness
// schemas drawn by the generic drawer. The blocks' own drawing is pinned in drawers-crossfeed.test.js and
// drawers-loudness.test.js; this suite pins the wiring: the gate row's options, each block mounting under its tab,
// and the family: a key one block stages dots its own title and makes the other member's Apply live.
//
// Renders through preact-render-to-string over the /matrix form in `matrixConfig`, staged edits going through `edit`
// against the staging fake.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-matrix-family-schema.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import {
  CROSSFEED_DRAWER,
  FAMILY_BLOCKS,
  LOUDNESS_DRAWER,
} from "../../../../hqptuner/static/components/faceplate/drawers/matrix-family.js";
import { config, matrixConfig, metadata } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { registerDrawer } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { ok, stagingWire } from "../../support/wire/wire.js";
import { attr, classes, elements, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

const TYPES = [
  { value: "lshelf", label: "lshelf" },
  { value: "hshelf", label: "hshelf" },
];

beforeEach(async () => {
  stagingWire({ fallback: (w) => ok(w.staged) });
  metadata.value = null;
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: true },
      { name: "iir2fir", value: "0" },
      { name: "post_bauer_enabled", value: "0" },
      { name: "post_loudness_enabled", value: true },
      { name: "post_loudness_rangelow", value: "-60" },
      { name: "post_loudness_rangehigh", value: "-20" },
      { name: "post_loudness_lowtype", value: "lshelf", options: TYPES },
      { name: "post_loudness_lowfreq", value: "80" },
      { name: "post_loudness_lowsteep", value: "0.5" },
      { name: "post_loudness_lowlevel", value: "20" },
      { name: "post_loudness_hightype", value: "hshelf", options: TYPES },
      { name: "post_loudness_highfreq", value: "5000" },
      { name: "post_loudness_highsteep", value: "1" },
      { name: "post_loudness_highlevel", value: "10" },
    ],
  };
  config.value = { fields: [], file: { matrix_pipelines: "[]" } };
  openStage.value = null;
  await discardAll();
  registerDrawer(CROSSFEED_DRAWER);
  registerDrawer(LOUDNESS_DRAWER);
});

/** @param {DrawerSchema} schema */
const markup = (schema) => elements(render(html`<${Drawer} schema=${schema} blocks=${FAMILY_BLOCKS} />`));

test("test_the_loudness_gate_row_offers_bypass_then_engage", () => {
  const row = markup(LOUDNESS_DRAWER).find((e) => attr(e, "data-k") === "loudness_enabled");
  const labels = row
    ? elements(row.html)
        .filter((e) => e.name === "button" && attr(e, "data-v") !== undefined)
        .map(text)
    : [];
  assert.deepEqual(labels, ["Bypass", "Engage"]);
});

test("test_each_drawer_mounts_its_block_under_its_one_tab", () => {
  const mounted = (/** @type {DrawerSchema} */ schema, /** @type {string} */ name) => {
    const block = markup(schema).find((e) => attr(e, "data-block") === name);
    return block ? elements(block.html).length > 0 && schema.tabs.length : 0;
  };
  assert.deepEqual([mounted(CROSSFEED_DRAWER, "crossfeed"), mounted(LOUDNESS_DRAWER, "loudness")], [1, 1]);
});

test("test_a_bound_the_loudness_block_stages_dots_its_title_and_makes_crossfeeds_apply_live", async () => {
  const before = [titleDot(LOUDNESS_DRAWER), applyLive(CROSSFEED_DRAWER)];
  await edit("loudness_range_low", "-50");
  assert.deepEqual(
    [before, [titleDot(LOUDNESS_DRAWER), applyLive(CROSSFEED_DRAWER)]],
    [
      [false, false],
      [true, true],
    ],
  );
});

/** @param {DrawerSchema} schema */
function titleDot(schema) {
  const t = markup(schema).find((e) => classes(e).includes("t") && e.name === "span");
  return t ? classes(t).includes("dirty") : undefined;
}

/** @param {DrawerSchema} schema */
function applyLive(schema) {
  const apply = markup(schema).find((e) => attr(e, "data-testid") === "apply");
  return apply ? !hasAttr(apply, "disabled") : undefined;
}
