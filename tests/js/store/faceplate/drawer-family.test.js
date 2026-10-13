// Behavioral suite for the drawer family of hqptuner/static/store/faceplate/drawer.js: the store knows which stage
// drawers form the matrix family with no component module loaded, so a staged edit to any member's setting lights the
// apply group of a drawer that declares itself a member of that family.
//
// Nothing under hqptuner/static/components/ is imported, on purpose: the family has to be known to the store alone.
// The store is driven at the wire by the staging fake (tests/js/support/wire/wire.js), the source signals assigned the
// shapes their endpoints serve. The member edits are catalog keys of the Matrix engine and DAC correction drawers and
// the pipeline set of the DSP pipelines drawer; the fixture drawer holds only volume_max, which no member holds, so
// its apply group lights through the family or not at all.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawer-family.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  config,
  engineState,
  enums,
  matrixConfig,
  metadata,
  pendingPreset,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit, stagePipelines } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { drawerHead, pickApplyMode } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { stagingWire } from "../../support/wire/wire.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {{ gain: string, gainunit: string, mixdown: string, process: string, source: string }} PipelineRow */

const FAMILY = "matrix";
const TAB = "only";

/**
 * Options as the /matrix form lists them.
 *
 * @param {...string} values
 */
const opts = (...values) => values.map((value) => ({ value, label: value }));

/** A pipeline row from one input to one output with no processing. @param {number} src @param {number} mix @returns {PipelineRow} */
const plain = (src, mix) => ({ gain: "0", gainunit: "dB", mixdown: String(mix), process: "", source: String(src) });

const LOADED_PIPELINES = [plain(0, 0), plain(1, 1)];
const STAGED_PIPELINES = [plain(0, 0), plain(1, 1), plain(0, 1)];

beforeEach(async () => {
  stagingWire();
  config.value = {
    fields: [
      { name: "volume_max", type: "number", value: -3 },
      { name: "channels", type: "number", value: 2 },
    ],
    file: { matrix_pipelines: JSON.stringify(LOADED_PIPELINES) },
    active: "",
  };
  matrixConfig.value = {
    fields: [
      { name: "enabled", type: "checkbox", value: true },
      { name: "engine", value: "1", options: opts("1", "0") },
      { name: "post_correction_enabled", type: "checkbox", value: false },
      { name: "post_correction_dac0", value: "", options: opts("", "m1") },
    ],
    rows: [],
  };
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
  pickApplyMode("apply");
});

/**
 * A drawer of the matrix family holding one row no family member holds.
 *
 * @returns {DrawerSchema}
 */
const member = () => ({
  id: "family-fixture",
  title: "family-fixture",
  aria: "family-fixture",
  family: FAMILY,
  tabs: [{ id: TAB, label: TAB, body: [{ row: { key: "volume_max" } }] }],
});

/** @returns {boolean} whether the fixture member's apply buttons are live. */
const lit = () => drawerHead(member(), TAB).apply.live;

/** One staged edit per member drawer of the matrix family, each to a setting only that member holds. */
const MEMBER_EDITS = [
  { member: "matrix_engine", stage: () => edit("matrix_enabled", "0") },
  { member: "dac_correction", stage: () => edit("dac_correction_enabled", "1") },
  { member: "dsp_pipelines", stage: async () => stagePipelines(STAGED_PIPELINES) },
];

for (const { member: owner, stage } of MEMBER_EDITS) {
  test(`test_a_staged_${owner}_edit_lights_the_apply_group_of_a_matrix_family_drawer_with_no_component_loaded`, async () => {
    await stage();
    assert.equal(lit(), true);
  });
}
