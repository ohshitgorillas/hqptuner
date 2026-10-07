// Rendered suite for hqptuner/static/components/faceplate/drawers/volume.js, the Volume drawer's schema drawn by the
// generic drawer: its Level, Gain and Range tabs, the Fixed volume choice lighting the line the staged store picks, a
// staged edit to a line's detail key dotting the Level tab, and the Range tab mounting the range block. What the block
// draws is pinned in tests/js/components/faceplate-drawers/drawers-volume-range.test.js, the line picked and a pick's staging
// in tests/js/store/faceplate/drawers-volume.test.js.
//
// Renders through preact-render-to-string; the store is driven at the wire by the staging fake. Tabs are found by
// `data-tab`, the choice by `data-choice`, its lines by `data-v` and the block by `data-block`; nothing asserted is
// copy.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-volume-schema.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { VOLUME_BLOCKS, VOLUME_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/volume.js";
import {
  config,
  matrixConfig,
  metadata,
  volume,
  volumeDrag,
  volumeRange,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { stagingWire } from "../../support/wire/wire.js";
import { attr, classes, elements, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/** @param {{ fixed?: boolean, iso?: string }} r  running fixed_volume_enabled and volume_fixed (Auto headroom) */
function load({ fixed = false, iso = "0" } = {}) {
  config.value = {
    fields: [
      { name: "fixed_volume_enabled", value: fixed },
      { name: "fixed_volume", value: "-10" },
      { name: "volume_fixed", value: iso !== "0" },
      { name: "direct_sdm", value: false },
      { name: "volume_min", value: "-60" },
      { name: "volume_max", value: "0" },
      { name: "defaults_volume", value: "-20" },
      { name: "gain_comp", value: "0" },
      { name: "playlist_album_gain", value: false },
    ],
    file: { volume_fixed: iso, fixed_volume: "-10" },
  };
  matrixConfig.value = { fields: [] };
  volume.value = "-12.5";
  volumeDrag.value = null;
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
}

beforeEach(async () => {
  stagingWire();
  metadata.value = null;
  openStage.value = "volume";
  load();
  await discardAll();
});

/** The drawer's markup, every element. */
const markup = () => elements(render(html`<${Drawer} schema=${VOLUME_DRAWER} blocks=${VOLUME_BLOCKS} />`));

/**
 * The tab strip's buttons.
 *
 * @param {MarkupElement[]} els
 */
const tabs = (els) => els.filter((el) => el.name === "button" && attr(el, "data-tab") !== undefined);

/** Whether the Level tab carries the dirty dot. */
const levelDot = () => {
  const tab = tabs(markup()).find((el) => attr(el, "data-tab") === "level");
  return tab ? classes(tab).includes("dirty") : undefined;
};

test("test_the_drawer_shows_level_gain_and_range_tabs", () => {
  assert.deepEqual(
    tabs(markup()).map((el) => attr(el, "data-tab")),
    ["level", "gain", "range"],
  );
});

test("test_the_fixed_volume_choice_lights_the_line_the_store_picks", () => {
  const lit = (/** @type {{ fixed?: boolean, iso?: string }} */ r) => {
    load(r);
    const cur = markup().find((el) => classes(el).includes("chline") && classes(el).includes("cur"));
    return cur && attr(cur, "data-v");
  };
  assert.deepEqual([lit({}), lit({ fixed: true }), lit({ iso: "2" })], ["off", "manual", "auto"]);
});

test("test_a_staged_fixed_level_dots_the_level_tab", async () => {
  load({ fixed: true });
  const before = levelDot();
  await edit("fixed_volume", "-6");
  assert.deepEqual([before, levelDot()], [false, true]);
});

test("test_the_range_tab_mounts_the_range_block", () => {
  const block = markup().find((el) => attr(el, "data-block") === "range");
  const inner = block ? elements(block.html).some((el) => classes(el).includes("vrange")) : undefined;
  assert.equal(inner, true);
});

test("test_the_auto_line_offers_the_two_headroom_levels_and_no_off", () => {
  const line = markup().find((el) => el.name === "div" && attr(el, "data-v") === "auto");
  const labels = line
    ? elements(line.html)
        .filter((el) => el.name === "button" && attr(el, "data-v") !== undefined)
        .map(text)
    : [];
  assert.deepEqual(labels, ["−3 dB", "−6 dB"]);
});
