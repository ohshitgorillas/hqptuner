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
import {
  config,
  engineState,
  engineStatus,
  enums,
  generation,
  metadata,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { pickChannelLayout } from "../../../../hqptuner/static/store/faceplate/drawers/output.js";
import { ok, stagingWire } from "../../support/wire/wire.js";
import { fieldReading, seedReadings } from "../../support/readings.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

const NET = "naa-office/hw:CARD=sndrpihifiberry,DEV=0";
const ALSA = "hw:CARD=NVidia,DEV=3";

/** The values the wire serves, by field name; `load` sets them. @type {Record<string, unknown>} */
let file = {};

/** The Engine's list index of each output mode. */
const MODE_INDEX = { auto: 0, pcm: 1, sdm: 2 };

/** The daemon's limits of each numeric field here. */
const BOUNDS = {
  channels: { min: 2, max: 32, step: 1 },
  net_bits: { min: 0, max: 32, step: 1 },
  alsa_bits: { min: 0, max: 32, step: 1 },
  alsa_offset: { min: 0, max: 31, step: 1 },
  net_period: { min: -1, max: 250, step: 1 },
  alsa_period: { min: -1, max: 250, step: 1 },
};

/**
 * One field's served reading: the output mode from the Engine on the live lane with no restart of its own; every
 * other field here from the File on the restore lane, restarting the engine; each carrying what the staging wire
 * holds for it.
 *
 * @param {string} name
 * @param {unknown} value
 * @param {Record<string, unknown>} staged
 */
function served1(name, value, staged) {
  const held = name in staged && staged[name] !== value ? staged[name] : null;
  if (name === "mode") {
    const index = MODE_INDEX[/** @type {keyof typeof MODE_INDEX} */ (value)];
    return fieldReading(index, {
      name: String(value),
      lane: "live",
      file: { value, generation: generation.value },
      staged: held,
    });
  }
  const bounds = BOUNDS[/** @type {keyof typeof BOUNDS} */ (name)] ?? null;
  return fieldReading(value, { show: "file", lane: "restore", restarts: true, bounds, staged: held });
}

/**
 * The served field readings of every value `load` set.
 *
 * @param {StagingWire | undefined} w
 */
function served(w) {
  const staged = w ? w.staged.http : {};
  return Object.fromEntries(Object.entries(file).map(([name, value]) => [name, served1(name, value, staged)]));
}

/** @type {StagingWire} */
let wire;

/**
 * Load the /config payload with the given backend: the values as served readings, and the form's options as its
 * metadata.
 *
 * @param {string} backend
 */
async function load(backend) {
  file = {
    mode: "pcm",
    backend,
    defaults_samplerate: "192000",
    defaults_bitrate: "12288000",
    channels: 2,
    net_device: NET,
    alsa_device: ALSA,
    net_dop: false,
    alsa_dop: false,
    net_anydsd: true,
    alsa_anydsd: false,
    net_bits: 20,
    alsa_bits: 24,
    net_ipv6: true,
    alsa_offset: 0,
    net_period: 0,
    alsa_period: 100,
  };
  config.value = {
    fields: [
      { name: "mode", type: "select" },
      { name: "backend", type: "select" },
      { name: "defaults_samplerate", type: "select" },
      { name: "defaults_bitrate", type: "select" },
      { name: "channels", type: "number" },
      { name: "net_device", type: "select", options: [{ value: NET, label: "naa-office: card: iface" }] },
      { name: "alsa_device", type: "select", options: [{ value: ALSA, label: "HDA NVidia: HDMI 0" }] },
      { name: "net_dop", type: "checkbox" },
      { name: "alsa_dop", type: "checkbox" },
      { name: "net_anydsd", type: "checkbox" },
      { name: "alsa_anydsd", type: "checkbox" },
      { name: "net_bits", type: "number" },
      { name: "alsa_bits", type: "number" },
      { name: "net_ipv6", type: "checkbox" },
      { name: "alsa_offset", type: "number" },
      { name: "net_period", type: "number" },
      { name: "alsa_period", type: "number" },
    ],
  };
  await seedReadings(served(wire));
}

beforeEach(async () => {
  wire = stagingWire({
    routes: (path, opts, w) =>
      path === "/api/config" && (opts.method ?? "GET") === "GET"
        ? ok({ generation: generation.value, fields: served(w) })
        : undefined,
  });
  await load("network");
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

const shownGroups = async (/** @type {string} */ backend) => {
  await load(backend);
  const groups = markup().filter((e) => attr(e, "data-be") !== undefined && !hasAttr(e, "hidden"));
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
  return markup()
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
