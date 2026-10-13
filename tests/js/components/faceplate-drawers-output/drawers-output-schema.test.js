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
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { OUTPUT_BLOCKS, OUTPUT_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/output.js";
import { config, engineState, engineStatus, enums, metadata } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { pickChannelLayout } from "../../../../hqptuner/static/store/faceplate/drawers/output.js";
import { stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const NET = "naa-office/hw:CARD=sndrpihifiberry,DEV=0";
const ALSA = "hw:CARD=NVidia,DEV=3";

/**
 * Load the /config payload with the given backend.
 *
 * @param {string} backend
 */
function load(backend) {
  config.value = {
    fields: [
      { name: "mode", type: "select", value: "pcm" },
      { name: "backend", type: "select", value: backend },
      { name: "defaults_samplerate", type: "select", value: "192000" },
      { name: "defaults_bitrate", type: "select", value: "12288000" },
      { name: "channels", type: "number", value: 2 },
      { name: "net_device", type: "select", value: NET, options: [{ value: NET, label: "naa-office: card: iface" }] },
      { name: "alsa_device", type: "select", value: ALSA, options: [{ value: ALSA, label: "HDA NVidia: HDMI 0" }] },
      { name: "net_dop", type: "checkbox", value: false },
      { name: "alsa_dop", type: "checkbox", value: false },
      { name: "net_anydsd", type: "checkbox", value: true },
      { name: "alsa_anydsd", type: "checkbox", value: false },
      { name: "net_bits", type: "number", value: 20 },
      { name: "alsa_bits", type: "number", value: 24 },
      { name: "net_ipv6", type: "checkbox", value: true },
      { name: "alsa_offset", type: "number", value: 0 },
      { name: "net_period", type: "number", value: 0 },
      { name: "alsa_period", type: "number", value: 100 },
    ],
    file: {},
    active: "",
    profiles: null,
    device_caps: null,
  };
}

beforeEach(async () => {
  stagingWire();
  load("network");
  engineState.value = { state: "0" };
  engineStatus.value = { status: {}, metadata: {} };
  enums.value = null;
  metadata.value = null;
  openStage.value = null;
  openPopover.value = null;
  await pickChannelLayout("2");
  await discardAll();
});

const markup = () => elements(render(html`<${Drawer} schema=${OUTPUT_DRAWER} blocks=${OUTPUT_BLOCKS} />`));

/**
 * Fire the click handler of the first vnode matching `pred`, or nothing when none matches.
 *
 * @param {(props: Record<string, unknown>) => boolean} pred
 */
async function tap(pred) {
  const { seen } = renderTree(html`<${Drawer} schema=${OUTPUT_DRAWER} blocks=${OUTPUT_BLOCKS} />`);
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}));
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
}

/** @param {string} id */
const tabDirty = (id) => {
  const el = markup().find((e) => attr(e, "role") === "tab" && attr(e, "data-tab") === id);
  return el ? classes(el).includes("dirty") : null;
};

const shownGroups = (/** @type {string} */ backend) => {
  load(backend);
  const groups = markup().filter((e) => attr(e, "data-be") !== undefined && !hasAttr(e, "hidden"));
  return [...new Set(groups.map((e) => attr(e, "data-be")))];
};

test("test_the_network_backend_shows_only_its_own_groups", () => {
  assert.deepEqual(shownGroups("network"), ["network"]);
});

test("test_the_alsa_backend_shows_only_its_own_groups", () => {
  assert.deepEqual(shownGroups("alsa"), ["alsa"]);
});

test("test_the_combo_backend_shows_every_group", () => {
  assert.deepEqual(shownGroups("combo"), ["network", "alsa"]);
});

const shownPickers = (/** @type {string} */ backend) => {
  load(backend);
  return markup()
    .filter((e) => classes(e).includes("devpick"))
    .sort((a, b) => a.start - b.start)
    .map((e) => attr(e, "data-k"));
};

test("test_the_network_backend_shows_only_its_own_device_picker", () => {
  assert.deepEqual(shownPickers("network"), ["net_device"]);
});

test("test_the_alsa_backend_shows_only_its_own_device_picker", () => {
  assert.deepEqual(shownPickers("alsa"), ["alsa_device"]);
});

test("test_the_combo_backend_shows_both_device_pickers", () => {
  assert.deepEqual(shownPickers("combo"), ["net_device", "alsa_device"]);
});

test("test_the_mode_row_offers_pcm_and_sdm_only", () => {
  const row = markup().find((e) => classes(e).includes("drow") && attr(e, "data-k") === "output_mode");
  const values = elements(row?.html ?? "")
    .filter((e) => e.name === "button")
    .map((e) => attr(e, "data-v"));
  assert.deepEqual(values, ["pcm", "sdm"]);
});

test("test_the_channel_number_is_grayed_under_the_stereo_layout", () => {
  const disabled = () => {
    const row = markup().find((e) => classes(e).includes("drow") && attr(e, "data-k") === "channels");
    const box = elements(row?.html ?? "").find((e) => e.name === "input");
    return box ? hasAttr(box, "disabled") : null;
  };
  const atStereo = disabled();
  assert.deepEqual(atStereo, true);
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
