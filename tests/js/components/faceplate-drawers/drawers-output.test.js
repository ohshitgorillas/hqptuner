// Rendered suite for the Output drawer's two blocks: the rate dial (components/faceplate/drawers/output/RateDial.js) and the
// device picker (components/faceplate/drawers/output/DevicePicker.js), each over the v1 store. The dial: which tier each
// band's needle prints selected, which tiers are hatched, where the playing lamp sits, that the output mode never takes
// a band away, and the write a key makes. The picker: the list opening from its trigger, a tap
// staging a device and closing the list, the current and dirty marks, and the rescan.
//
// Renders through preact-render-to-string. A handler is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events. Controls are found by wire identifiers: a band (`data-band`), a tier's position (`data-i`), a
// device's value (`data-v`) or a `data-testid`.
//
// Not reachable here: the needle's glide and the drag class, which a stylesheet and a live element own. A browser run
// closes both.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-output.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { RateDial } from "../../../../hqptuner/static/components/faceplate/drawers/output/RateDial.js";
import { DevicePicker } from "../../../../hqptuner/static/components/faceplate/drawers/output/DevicePicker.js";
import { config, engineState, engineStatus, enums, metadata } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import { openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { ok, stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const STANDA = "naa-7bdbb6cb/hw:CARD=Standa,DEV=0";
const OFFICE = "naa-office/hw:CARD=sndrpihifiberry,DEV=0";
const NET_OPTIONS = [
  { value: "S26/hw:CARD=Output,DEV=0", label: "S26: Gustard Digital Output: USB Audio" },
  { value: STANDA, label: "naa-7bdbb6cb: Holo Audio UAC2.0 Gen2.1 Standa: USB Audio" },
  { value: OFFICE, label: "naa-office: snd_rpi_hifiberry_digi: HiFiBerry Digi+ Pro HiFi wm8804-spdif-0" },
];

/** The device announces 1x to 1024x, both members of each: only 2048x is out of its reach. */
const CAPS = {
  device: STANDA,
  pcm_rates: [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000, 1411200, 1536000],
  dsd_rates: [2822400, 3072000, 5644800, 6144000, 11289600, 12288000, 22579200, 24576000, 45158400, 49152000],
};

/** @type {string[]} */
let refreshes = [];

/**
 * Load the /config payload.
 *
 * @param {{ mode?: string, caps?: object | null, autosave?: boolean }} [over]
 */
function load({ mode = "pcm", caps = null, autosave = true } = {}) {
  config.value = {
    fields: [
      { name: "defaults_samplerate", type: "select", value: "192000" },
      { name: "defaults_bitrate", type: "select", value: "12288000" },
      { name: "mode", type: "select", value: mode },
      { name: "backend", type: "select", value: "network" },
      { name: "net_dop", type: "checkbox", value: false },
      { name: "net_device", type: "select", value: STANDA, options: NET_OPTIONS },
    ],
    file: {},
    active: "",
    profiles: null,
    device_caps: caps,
    autosave,
  };
}

/** @param {string} path @param {{ method?: string }} opts */
function routes(path, opts) {
  if (path !== "/api/config/refresh") return undefined;
  refreshes.push(String(opts.method));
  return ok({ restored: {} });
}

beforeEach(async () => {
  refreshes = [];
  stagingWire({ routes });
  load();
  engineState.value = { state: "0" };
  engineStatus.value = { status: {}, metadata: {} };
  enums.value = null;
  metadata.value = null;
  openPopover.value = null;
  await discardAll();
});

const dial = () => elements(render(html`<${RateDial} />`));
const picker = () => elements(render(html`<${DevicePicker} k="net_device" />`));

/**
 * The positions of the tier printings carrying `cls`, inside the band group named `band` or across the dial.
 *
 * @param {string} cls
 * @param {string} [band]
 */
function tiersWith(cls, band) {
  const all = dial();
  const scope = band ? elements(all.find((e) => e.name === "g" && attr(e, "data-band") === band)?.html ?? "") : all;
  return scope
    .filter((e) => e.name === "g" && attr(e, "data-i") !== undefined && classes(e).includes(cls))
    .map((e) => attr(e, "data-i"));
}

/**
 * Fire the handler of the first vnode matching `pred` in one render of `tree`, or nothing when none matches.
 *
 * @param {unknown} tree
 * @param {(props: Record<string, unknown>) => boolean} pred
 * @param {string} handler
 * @param {unknown} [event]
 */
async function fire(tree, pred, handler, event = undefined) {
  const { seen } = renderTree(/** @type {Parameters<typeof renderTree>[0]} */ (tree));
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}));
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props[handler]);
  if (fn) await fn(event);
}

/** @param {string} band */
const slider = (band) => (/** @type {Record<string, unknown>} */ p) => p.role === "slider" && p["data-band"] === band;

/** A key press as the slider reads it. @param {string} key */
const keyEvent = (key) => ({ key, preventDefault: () => undefined });

/** The x the dial prints tier `i` at, and the width of its viewBox. @param {number} i */
function tierX(i) {
  const all = dial();
  const svg = all.find((e) => e.name === "svg");
  const width = Number((attr(svg ?? { name: "", attrs: "", start: 0, html: "" }, "viewBox") ?? "").split(" ")[2]);
  const g = all.find((e) => e.name === "g" && attr(e, "data-i") === String(i));
  const label = elements(g?.html ?? "").find((e) => e.name === "text");
  return { x: Number(label ? attr(label, "x") : NaN), width };
}

test("test_each_band_prints_its_needles_tier_selected", () => {
  assert.deepEqual([tiersWith("sel", "pcm"), tiersWith("sel", "sdm")], [["2"], ["8"]]);
});

test("test_a_tier_the_device_cannot_carry_prints_unavailable", () => {
  load({ caps: CAPS });
  assert.deepEqual(tiersWith("unav"), ["11"]);
});

test("test_the_playing_lamp_stands_over_the_running_tier", () => {
  engineStatus.value = { status: { active_rate: "352800" }, metadata: {} };
  const lamp = dial().find((e) => e.name === "circle" && classes(e).includes("playing"));
  const tier = tierX(3).x;
  assert.equal(lamp ? Number(attr(lamp, "cx")) : null, Number.isNaN(tier) ? undefined : tier);
});

test("test_the_playing_lamp_is_out_with_no_running_rate", () => {
  const lamps = () => dial().filter((e) => e.name === "circle" && classes(e).includes("playing")).length;
  engineStatus.value = { status: { active_rate: "352800" }, metadata: {} };
  const lit = lamps();
  engineStatus.value = { status: { active_rate: "0" }, metadata: {} };
  assert.deepEqual([lit, lamps()], [1, 0]);
});

test("test_the_output_mode_never_takes_a_band_away", () => {
  load({ mode: "sdm" });
  const pcm = dial().find((e) => attr(e, "role") === "slider" && attr(e, "data-band") === "pcm");
  assert.deepEqual([pcm !== undefined, pcm ? hasAttr(pcm, "aria-disabled") : null], [true, false]);
});

test("test_a_band_slider_reports_its_needles_tier", () => {
  const now = (/** @type {string} */ band) => {
    const el = dial().find((e) => attr(e, "role") === "slider" && attr(e, "data-band") === band);
    return el ? attr(el, "aria-valuenow") : undefined;
  };
  assert.deepEqual([now("pcm"), now("sdm")], ["2", "8"]);
});

test("test_an_arrow_key_steps_its_band_one_tier", async () => {
  await fire(html`<${RateDial} />`, slider("pcm"), "onKeyDown", keyEvent("ArrowRight"));
  assert.equal(effective("pcm_rate"), "384000");
});

test("test_end_sends_a_needle_to_its_bands_last_tier", async () => {
  await fire(html`<${RateDial} />`, slider("sdm"), "onKeyDown", keyEvent("End"));
  assert.equal(effective("sdm_rate"), "98304000");
});

test("test_the_trigger_opens_the_device_list", async () => {
  const hidden = () => {
    const list = picker().find((e) => attr(e, "role") === "listbox");
    return list ? hasAttr(list, "hidden") : null;
  };
  const before = hidden();
  await fire(html`<${DevicePicker} k="net_device" />`, (p) => p["aria-haspopup"] === "listbox", "onClick");
  assert.deepEqual([before, hidden()], [true, false]);
});

test("test_tapping_a_device_stages_it", async () => {
  await fire(html`<${DevicePicker} k="net_device" />`, (p) => p["data-v"] === OFFICE, "onClick");
  assert.equal(effective("net_device"), OFFICE);
});

test("test_tapping_a_device_closes_the_list", async () => {
  await fire(html`<${DevicePicker} k="net_device" />`, (p) => p["aria-haspopup"] === "listbox", "onClick");
  const open = openPopover.value;
  await fire(html`<${DevicePicker} k="net_device" />`, (p) => p["data-v"] === OFFICE, "onClick");
  assert.deepEqual([open !== null, openPopover.value], [true, null]);
});

test("test_the_effective_device_is_the_selected_option", () => {
  const selected = picker()
    .filter((e) => attr(e, "role") === "option" && attr(e, "aria-selected") === "true")
    .map((e) => attr(e, "data-v"));
  assert.deepEqual(selected, [STANDA]);
});

test("test_a_staged_device_marks_the_picker_dirty", async () => {
  const dirty = () => {
    const root = picker()[picker().length - 1];
    return root ? hasAttr(root, "data-dirty") : null;
  };
  const before = dirty();
  await edit("net_device", OFFICE);
  assert.deepEqual([before, dirty()], [false, true]);
});

test("test_the_rescan_button_asks_the_daemon_to_rescan", async () => {
  await fire(html`<${DevicePicker} k="net_device" />`, (p) => p["data-testid"] === "rescan", "onClick");
  assert.deepEqual(refreshes, ["POST"]);
});

test("test_the_rescan_cost_shows_only_while_auto_save_puts_live_settings_back", () => {
  const shown = () => picker().filter((e) => attr(e, "data-testid") === "rescan-cost").length;
  const on = shown();
  load({ autosave: false });
  assert.deepEqual([on, shown()], [1, 0]);
});
