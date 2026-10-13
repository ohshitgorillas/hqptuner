// Behavioral suite for the Fixed volume mode as its staged readers see it: Auto headroom (`optimal_iso`, 0 off,
// 1 = -3 dB, 2 = -6 dB, or a bare bool from the /config form) wins over Manual (`fixed_volume_enabled`), else Off
// (faceplate spec, Volume: "Fixed volume as one choice, Off / Manual (level) / Auto"; the Range tab "grays whole while
// Fixed volume isn't Off"). The Volume drawer's line picked and the Range tab's gray both read the edit being staged,
// and both must read it by the same rule: an unchecked Auto headroom box is Auto headroom off, whatever spelling it
// arrives in, so Manual running under it is what is left in effect.
//
// The store is driven at the wire: a staging fake answers the real REST paths (tests/js/support/wire/wire.js), the
// daemon's /config form fields and the config file's values are assigned into `config`, the engine's reported level
// and VolumeRange into `volume` and `volumeRange`, and the edit is staged through the real `edit`. Every source signal
// is reset on every case.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/fixed-volume-readings.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config, matrixConfig, volume, volumeDrag, volumeRange } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { fixedMode } from "../../../hqptuner/static/store/faceplate/drawers/volume.js";
import { quiesce, stagingWire } from "../support/wire/wire.js";

/** @typedef {import("../support/wire/wire.js").StagingWire} StagingWire */

/** The /config form's answer for an unchecked Auto headroom box: a bare bool, not the XML domain's "0". */
const UNCHECKED = false;

/** Auto headroom at -3 dB running in the config file, its form box checked. */
const AUTO_HEADROOM = "1";

/** @type {StagingWire} */
let wire;

/**
 * Loads a running state with Auto headroom on at -3 dB and Manual as given.
 *
 * @param {boolean} manual  running fixed_volume_enabled, as the form's checkbox
 */
function load(manual) {
  config.value = {
    fields: [
      { name: "fixed_volume_enabled", value: manual },
      { name: "fixed_volume", value: "-10" },
      { name: "volume_fixed", value: true },
      { name: "direct_sdm", value: false },
      { name: "volume_min", value: "-60" },
      { name: "volume_max", value: "0" },
      { name: "defaults_volume", value: "-20" },
    ],
    file: { volume_fixed: AUTO_HEADROOM, fixed_volume: "-10" },
  };
  matrixConfig.value = { fields: [] };
  volume.value = "-12.5";
  volumeDrag.value = null;
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
}

beforeEach(async () => {
  wire = stagingWire();
  load(false);
  await discardAll();
});

/**
 * Stages Auto headroom unchecked over a running Auto headroom with Manual as given.
 *
 * @param {boolean} manual
 */
async function uncheckAutoHeadroom(manual) {
  await discardAll();
  load(manual);
  await edit("optimal_iso", UNCHECKED);
  await quiesce(wire);
}

test("test_unchecking_auto_headroom_over_a_running_manual_moves_the_drawers_line_to_manual", async () => {
  load(true);
  fixedMode(); // read under Auto headroom, so the uncheck has to reach a line already read
  await uncheckAutoHeadroom(true);
  assert.equal(fixedMode(), "manual");
});
