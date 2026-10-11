// Rendered suite for the Resampling drawer's filter row when the picked filter is a two-stage variant (`-2s`): the
// shared two-stage note sits behind `see more`, the way the Conversion page shows it. The row reads the filter's own
// prose, then the note's lead (its words before the first colon), then the trigger, whose popover holds the note alone.
//
// The /config form picks the PCM 1x filter by value; its option label is the engine name the overlay joins on, with
// the `-2s` suffix stripped and the overlay's `two_stage_note` added. A single-stage pick of the same row is the twin.
//
// Renders `Drawer` through preact-render-to-string with the store driven at the wire by the staging fake. The row is
// found by its catalog key (`data-k`), the trigger by its `data-testid`, the popover by its `role`
// (tests/js/support/seemore.js); every string asserted is one the test put on the wire or into the overlay.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-resampling-two-stage.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { RESAMPLING_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/modes.js";
import {
  config,
  engineState,
  engineStatus,
  enums,
  metadata,
  pendingPreset,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage, viewport } from "../../../../hqptuner/static/store/faceplate/view.js";
import { stagingWire } from "../../support/wire/wire.js";
import { attr, elements } from "../../support/markup.js";
import { TRIGGER, popoverTexts, triggersInSight, wordsAfter, wordsOf } from "../../support/seemore.js";

const FILTER = "fixfilt";
const PROSE = "Prose of the fixture filter.";
const NOTE_LEAD = "Fixture lead";
const NOTE = `${NOTE_LEAD}: the rest of the fixture two stage note.`;

/** The PCM 1x row's values: its two-stage variant and its single-stage twin. */
const TWO_STAGE = "1";
const SINGLE_STAGE = "2";
const FILTERS = [
  { value: TWO_STAGE, label: `${FILTER}-2s` },
  { value: SINGLE_STAGE, label: FILTER },
];

const ROW = "pcm_filter_1x";

/** The plate at the design size, 10.2″ (docs/spec/faceplate-spec.md). */
const DESIGN = { w: 1080, h: 810 };

/** @param {string} key */
const tip = (key) => ({ label: `${key} fixture label`, tooltip: `Whole ${key} fixture paragraph` });

/**
 * Load the /config form with the PCM 1x filter at `pcm1x`.
 *
 * @param {string} pcm1x
 */
function load(pcm1x) {
  config.value = {
    fields: [
      { name: "filter1x", type: "select", value: pcm1x, options: FILTERS },
      { name: "filter", type: "select", value: SINGLE_STAGE, options: FILTERS },
      { name: "oversampling1x", type: "select", value: SINGLE_STAGE, options: FILTERS },
      { name: "oversampling", type: "select", value: SINGLE_STAGE, options: FILTERS },
      { name: "sdm_conversion", type: "select", value: "0", options: [{ value: "0", label: "0" }] },
    ],
    file: {},
    active: "",
  };
}

beforeEach(async () => {
  stagingWire();
  viewport.value = DESIGN;
  load(TWO_STAGE);
  engineState.value = { state: "0", active_chain: "pcm" };
  engineStatus.value = {};
  enums.value = null;
  metadata.value = {
    filters: { filters: { [FILTER]: { description: PROSE } }, aliases: {}, two_stage_note: NOTE },
    shapers: {},
    settings: { dsp: Object.fromEntries(["filter_1x", "filter_nx", "sdm_conversion"].map((k) => [k, tip(k)])) },
  };
  pendingPreset.value = null;
  openPopover.value = null;
  openStage.value = RESAMPLING_DRAWER.id;
  openStage.value = null;
  cancel();
  await discardAll();
});

/** The markup of the PCM 1x filter row, or none when it is not drawn. */
function row() {
  const found = elements(render(html`<${Drawer} schema=${RESAMPLING_DRAWER} />`)).find(
    (e) => attr(e, "data-k") === ROW,
  );
  return found ? found.html : "";
}

test("test_a_two_stage_filter_row_shows_one_more_see_more_trigger_than_its_single_stage_twin", () => {
  load(SINGLE_STAGE);
  const single = triggersInSight(row());
  load(TWO_STAGE);
  assert.equal(triggersInSight(row()), single + 1);
});

test("test_a_two_stage_filter_row_reads_its_prose_then_the_notes_lead_then_the_see_more_trigger", () => {
  assert.deepEqual(wordsAfter(row(), PROSE), [...wordsOf(NOTE_LEAD), TRIGGER]);
});

test("test_a_two_stage_filter_rows_popover_holds_the_two_stage_note_alone", () => {
  assert.deepEqual(popoverTexts(row()).map(wordsOf), [wordsOf(NOTE)]);
});
