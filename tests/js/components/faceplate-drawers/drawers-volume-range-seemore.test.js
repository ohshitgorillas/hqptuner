// Rendered suite for the Volume drawer's Range block holding part of a setting's paragraph back, the way every other
// drawer row does: a settings metadata entry may carry `more`, the prose held back, beside `tooltip`, the start shown.
// The block shows a marked entry's tooltip, then the `see more` trigger, whose popover holds the `more` prose; an entry
// with no `more` shows its tooltip whole, with no trigger.
//
// The mark lives in the metadata, so the fixture puts it where block code could not have guessed it: on the Min and
// Startup entries, and not on the Max entry or either loudness bound.
//
// Renders through preact-render-to-string with the store driven at the wire by the staging fake. The trigger is found
// by its `data-testid`, the popover by its `role` (tests/js/support/seemore.js); every string asserted is one the test
// put into the metadata.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-volume-range-seemore.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { VolumeRangeBody } from "../../../../hqptuner/static/components/faceplate/drawers/VolumeRange.js";
import {
  config,
  matrixConfig,
  metadata,
  volume,
  volumeDrag,
  volumeRange,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/view.js";
import { stagingWire } from "../../support/wire/wire.js";
import { elements, text } from "../../support/markup.js";
import { TRIGGER, popoverTexts, triggersInSight, wordsAfter, wordsOf } from "../../support/seemore.js";

/** The plate at the design size, 10.2″ (docs/spec/faceplate-spec.md). */
const DESIGN = { w: 1080, h: 810 };

const SCHEMA = { id: "volume", title: "volume-title", aria: "volume", tabs: [] };

/** The Range entries that carry `more`, keyed by setting. */
const MARKED = {
  volume_min: {
    label: "Minimum fixture label",
    tooltip: "Start of the minimum fixture paragraph",
    more: "Prose the minimum fixture entry holds back.",
  },
  startup_volume: {
    label: "Startup fixture label",
    tooltip: "Start of the startup fixture paragraph",
    more: "Prose the startup fixture entry holds back.",
  },
};

/** The Range entry that carries no `more`. */
const UNMARKED = {
  volume_max: { label: "Maximum fixture label", tooltip: "Whole maximum fixture paragraph" },
};

const META = {
  settings: {
    volume: { ...MARKED, ...UNMARKED },
    dsp: {
      loudness_range_low: { label: "Low bound fixture label", tooltip: "Whole low bound fixture paragraph" },
      loudness_range_high: { label: "High bound fixture label", tooltip: "Whole high bound fixture paragraph" },
    },
  },
};

beforeEach(async () => {
  stagingWire();
  viewport.value = DESIGN;
  metadata.value = META;
  config.value = {
    fields: [
      { name: "fixed_volume_enabled", value: false },
      { name: "volume_fixed", value: false },
      { name: "direct_sdm", value: false },
      { name: "volume_min", value: "-60" },
      { name: "volume_max", value: "0" },
      { name: "defaults_volume", value: "-20" },
    ],
    file: { volume_fixed: "0" },
  };
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: false },
      { name: "post_loudness_enabled", value: false },
      { name: "post_loudness_rangelow", value: "-45" },
      { name: "post_loudness_rangehigh", value: "-15" },
    ],
  };
  volume.value = "-12.5";
  volumeDrag.value = null;
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  await discardAll();
});

/** The block's markup. */
const block = () => render(html`<${VolumeRangeBody} schema=${SCHEMA} />`);

/**
 * The words in sight after a tooltip, inside the paragraph that shows it, or null when no paragraph shows it.
 *
 * @param {string} tooltip
 * @returns {string[] | null}
 */
function afterTooltip(tooltip) {
  const shown = elements(block()).find((e) => e.name === "p" && text(e).includes(tooltip));
  return shown ? wordsAfter(shown.html, tooltip) : null;
}

test("test_the_range_block_shows_one_see_more_trigger_per_entry_carrying_more", () => {
  assert.equal(triggersInSight(block()), Object.keys(MARKED).length);
});

for (const [key, { tooltip }] of Object.entries(MARKED)) {
  test(`test_the_${key}_paragraph_shows_its_tooltip_and_then_the_see_more_trigger`, () => {
    assert.deepEqual(afterTooltip(tooltip), [TRIGGER]);
  });
}

test("test_the_range_blocks_see_more_popovers_hold_each_entrys_more_prose", () => {
  assert.deepEqual(
    popoverTexts(block()).map(wordsOf).sort(),
    Object.values(MARKED)
      .map(({ more }) => wordsOf(more))
      .sort(),
  );
});
