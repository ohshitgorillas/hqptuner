// Behavioral suite for the stage drawer's Apply & save mode (hqptuner/static/store/faceplate/drawer.js `runApply`)
// and the page's engine-restart dim (`engineRestarting`, the state the plate marks itself with): saving the applied
// set into the loaded station restarts nothing by itself, so only a staged change that restarts the engine dims the
// page.
//
// The store is driven at the wire: a staging fake answers the real REST paths (tests/js/support/wire/wire.js) and
// the apply route answers the report and the save as POST /api/config/apply serves them. The schema keys are catalog
// keys chosen for their lane: volume_max stages for a restart, adaptive_volume is a live-lane setter. Every value the
// dim state takes while the apply runs is recorded, so the observation does not depend on when it is raised or
// lowered.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawer-save-restart.test.js

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
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { engineRestarting } from "../../../../hqptuner/static/store/enginewrite.js";
import { openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { pickApplyMode, runApply } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { ok, stagingWire } from "../../support/wire/wire.js";

const STATION = "Study";

/** A restart-lane field and a live-lane setter, each with the value an edit stages. */
const RESTART_KEY = "volume_max";
const RESTART_VALUE = "-6";
const LIVE_KEY = "adaptive_volume";
const LIVE_VALUE = "1";

/** The /config form fields the rows read their baselines from. */
const FIELDS = [{ name: RESTART_KEY, type: "number", value: -3 }];

/** @type {Record<string, unknown>} */
let report = {};

/** @param {string} path */
function routes(path) {
  if (path !== "/api/config/apply") return undefined;
  return ok({ report, saved: { name: STATION } });
}

beforeEach(async () => {
  report = {};
  stagingWire({ routes });
  config.value = { fields: FIELDS, file: {}, active: STATION, profiles: null };
  matrixConfig.value = { fields: [], rows: [] };
  engineState.value = { adaptive: 0 };
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openPopover.value = null;
  engineRestarting.value = false;
  cancel();
  await discardAll();
  pickApplyMode("save");
});

/**
 * Every value the page's restart dim took while an Apply & save of the staged set ran.
 *
 * @returns {Promise<boolean[]>}
 */
async function dimDuringSave() {
  /** @type {boolean[]} */
  const seen = [];
  const stop = engineRestarting.subscribe((/** @type {unknown} */ v) => seen.push(Boolean(v)));
  await runApply();
  stop();
  return seen;
}

test("test_apply_and_save_of_a_live_only_change_does_not_dim_the_page_for_a_restart", async () => {
  await edit(LIVE_KEY, LIVE_VALUE);
  report = { live: [{ setting: LIVE_KEY, ok: true }], persistent: null, aftermath: { fanout: {} }, switched: null };
  const seen = await dimDuringSave();
  assert.ok(!seen.includes(true), JSON.stringify(seen));
});

test("test_apply_and_save_of_a_change_that_restarts_the_engine_dims_the_page", async () => {
  await edit(RESTART_KEY, RESTART_VALUE);
  report = {
    live: [],
    persistent: { applied: true, attempts: 1, active: STATION },
    aftermath: { fanout: {} },
    switched: null,
  };
  const seen = await dimDuringSave();
  assert.ok(seen.includes(true), JSON.stringify(seen));
});
