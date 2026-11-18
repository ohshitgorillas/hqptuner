// Rendered suite for the Output drawer's schema (hqptuner/static/components/faceplate/drawers/output.js) drawn by the
// generic drawer: which backend's groups and device picker show for each backend, the rate dial on the Format tab, the
// output modes the mode row offers, the channel number's gray state under the layout segment, and which tab a staged
// rate or device dots.
//
// Renders through preact-render-to-string; a tap is fired through the vnode seam (tests/js/support/vnodeseam.js). The
// store is driven at the wire by the staging fake. Rows and controls are found by their catalog key (`data-k`), backend
// (`data-be`), block name (`data-block`), tab id (`data-tab`) or option value (`data-v`).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { edit } from "../../../../hqptuner/static/store/actions.js";
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import { pickChannelLayout } from "../../../../hqptuner/static/store/faceplate/drawers/output.js";
import { configRoute, fire } from "../../support/rendered/drawer-render.js";
import {
  BOTH_FILE,
  outputMarkup,
  outputTree,
  seedForm,
  servedOutput,
  settleOutput,
} from "../../support/rendered/outputdrawer.js";
import { stagingWire } from "../../support/wire/wire.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

/** The values the wire serves, by field name; `load` sets them. @type {Record<string, unknown>} */
let file = {};

/** @param {StagingWire | undefined} w */
const served = (w) => servedOutput(file, w);

/** @type {StagingWire} */
let wire;

/**
 * Load the /config payload with the given backend: the values as served readings, and the form's options as its
 * metadata.
 *
 * @param {string} backend
 */
async function load(backend) {
  file = { ...BOTH_FILE, backend };
  await seedForm(served(wire));
}

beforeEach(async () => {
  wire = stagingWire({ routes: configRoute(served) });
  await load("network");
  await settleOutput();
});

/**
 * Fire the click handler of the first vnode matching `pred`, or nothing when none matches.
 *
 * @param {(props: Record<string, unknown>) => boolean} pred
 */
const tap = (pred) => fire(outputTree(), pred, "onClick");

/** @param {string} id */
const tabDirty = (id) => {
  const el = outputMarkup().find((e) => attr(e, "role") === "tab" && attr(e, "data-tab") === id);
  return el ? classes(el).includes("dirty") : null;
};

const shownGroups = async (/** @type {string} */ backend) => {
  await load(backend);
  const groups = outputMarkup().filter((e) => attr(e, "data-be") !== undefined && !hasAttr(e, "hidden"));
  return [...new Set(groups.map((e) => attr(e, "data-be")))];
};

test("test_the_network_backend_shows_only_its_own_groups", async () => {
  assert.deepEqual(await shownGroups("network"), ["network"]);
});

test("test_the_alsa_backend_shows_only_its_own_groups", async () => {
  assert.deepEqual(await shownGroups("alsa"), ["alsa"]);
});

test("test_the_combo_backend_shows_every_group", async () => {
  assert.deepEqual(await shownGroups("combo"), ["network", "alsa"]);
});

const shownPickers = async (/** @type {string} */ backend) => {
  await load(backend);
  return outputMarkup()
    .filter((e) => classes(e).includes("devpick"))
    .sort((a, b) => a.start - b.start)
    .map((e) => attr(e, "data-k"));
};

test("test_the_network_backend_shows_only_its_own_device_picker", async () => {
  assert.deepEqual(await shownPickers("network"), ["net_device"]);
});

test("test_the_alsa_backend_shows_only_its_own_device_picker", async () => {
  assert.deepEqual(await shownPickers("alsa"), ["alsa_device"]);
});

test("test_the_combo_backend_shows_both_device_pickers", async () => {
  assert.deepEqual(await shownPickers("combo"), ["net_device", "alsa_device"]);
});

test("test_the_mode_row_offers_pcm_and_sdm_only", () => {
  const row = outputMarkup().find((e) => classes(e).includes("drow") && attr(e, "data-k") === "output_mode");
  const values = elements(row?.html ?? "")
    .filter((e) => e.name === "button")
    .map((e) => attr(e, "data-v"));
  assert.deepEqual(values, ["pcm", "sdm"]);
});

/** Whether the channel number is disabled, or null when the row carries no number box. */
const channelBoxDisabled = () => {
  const row = outputMarkup().find((e) => classes(e).includes("drow") && attr(e, "data-k") === "channels");
  const box = elements(row?.html ?? "").find((e) => e.name === "input");
  return box ? hasAttr(box, "disabled") : null;
};

test("test_the_channel_number_is_grayed_under_the_stereo_layout", () => {
  const atStereo = channelBoxDisabled();
  assert.deepEqual(atStereo, true);
});

test("test_the_channel_number_is_not_grayed_under_the_manual_layout", async () => {
  await pickChannelLayout("manual");
  assert.deepEqual(channelBoxDisabled(), false);
});

test("test_a_layout_tap_stages_its_channel_count", async () => {
  await tap((p) => p["data-v"] === "6");
  assert.equal(effective("channels"), "6");
});

test("test_a_staged_rate_dots_the_format_tab", async () => {
  await edit("sdm_rate", "24576000");
  assert.deepEqual(tabDirty("format"), true);
});

test("test_a_staged_device_dots_the_device_tab", async () => {
  await edit("net_device", "naa-other/hw:CARD=X,DEV=0");
  assert.deepEqual(tabDirty("device"), true);
});

test("test_a_staged_rate_leaves_the_device_tab_undotted", async () => {
  await edit("sdm_rate", "24576000");
  assert.deepEqual(tabDirty("device"), false);
});

test("test_a_staged_device_leaves_the_format_tab_undotted", async () => {
  await edit("net_device", "naa-other/hw:CARD=X,DEV=0");
  assert.deepEqual(tabDirty("format"), false);
});
