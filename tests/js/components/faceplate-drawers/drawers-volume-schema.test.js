// Rendered suite for hqptuner/static/components/faceplate/drawers/volume.js, the Volume drawer's schema drawn by the
// generic drawer: its Level, Gain and Range tabs, the Fixed volume choice lighting the line the staged store picks, a
// staged edit to a line's detail key dotting the Level tab, the Range tab mounting the range block, and where the restart
// mark sits: on the Fixed volume choice's header with its lines bare, and on the range block's header with its boxes
// bare (docs/spec/faceplate-spec.md, Drawers (all), Lanes). What the block draws is pinned in
// tests/js/components/faceplate-drawers/drawers-volume-range.test.js, the line picked and a pick's staging in
// tests/js/store/faceplate/drawers-volume.test.js.
//
// Renders through preact-render-to-string; the store is driven at the wire by the staging fake. Tabs are found by
// `data-tab`, the choice by `data-choice`, its lines by `data-v`, the block by `data-block`, a range box by its input's
// `data-k` and the label enclosing it, and the restart mark by its `data-testid`; nothing asserted is copy.
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
import { attr, classes, elements } from "../../support/markup.js";

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

/** The restart mark's test id, shared by every surface that carries it. */
const MARK = "restart-mark";

/** The Fixed volume choice and its three lines, by the values the store picks. */
const FIXED_CHOICE = "fixed_mode";
const FIXED_LINES = ["off", "manual", "auto"];

/** The range block and the settings its three boxes write, in Min, Startup, Max order. */
const RANGE_BLOCK = "range";
const RANGE_KEYS = ["volume_min", "startup_volume", "volume_max"];

/**
 * Whether `inner` lies inside `outer`.
 *
 * @param {MarkupElement} inner
 * @param {MarkupElement} outer
 */
const within = (inner, outer) =>
  inner.start >= outer.start && inner.start + inner.html.length <= outer.start + outer.html.length;

/** @param {MarkupElement} el */
const isMark = (el) => attr(el, "data-testid") === MARK;

/**
 * Whether the Fixed volume choice's header carries the mark, then whether each line does, in Off, Manual, Auto order;
 * a line not drawn reads null. The header is everything in the choice outside its lines.
 *
 * @returns {(boolean | null)[] | null}
 */
function fixedMarks() {
  const all = markup();
  const choice = all.find((el) => attr(el, "data-choice") === FIXED_CHOICE);
  if (!choice) return null;
  const lines = FIXED_LINES.map((v) => all.find((el) => within(el, choice) && attr(el, "data-v") === v));
  const marks = all.filter((el) => isMark(el) && within(el, choice));
  const header = marks.some((m) => !lines.some((line) => line && within(m, line)));
  return [header, ...lines.map((line) => (line ? marks.some((m) => within(m, line)) : null))];
}

/**
 * Whether the range block's header carries the mark, then whether each box does, in Min, Startup, Max order; a box not
 * drawn reads null. A box is the label enclosing the setting's input; the header is what the block draws before its
 * first box.
 *
 * @returns {(boolean | null)[] | null}
 */
function rangeMarks() {
  const all = markup();
  const block = all.find((el) => attr(el, "data-block") === RANGE_BLOCK);
  if (!block) return null;
  const inputs = RANGE_KEYS.map((k) => all.find((el) => el.name === "input" && attr(el, "data-k") === k));
  const boxes = inputs.map((input) =>
    input
      ? all.filter((el) => el.name === "label" && within(input, el)).sort((a, b) => a.html.length - b.html.length)[0]
      : undefined,
  );
  const first = Math.min(...inputs.map((input) => (input ? input.start : Infinity)));
  const marks = all.filter((el) => isMark(el) && within(el, block));
  const header = marks.some((m) => m.start < first);
  return [header, ...boxes.map((box) => (box ? marks.some((m) => within(m, box)) : null))];
}

test("test_the_fixed_volume_choice_carries_the_restart_mark_on_its_header_and_none_on_its_lines", () => {
  assert.deepEqual(fixedMarks(), [true, false, false, false]);
});

test("test_the_range_block_carries_the_restart_mark_on_its_header_and_none_on_its_boxes", () => {
  assert.deepEqual(rangeMarks(), [true, false, false, false]);
});
