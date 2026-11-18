// Shared rig of the Output drawer suites (tests/js/components/faceplate-drawers-output/ and
// tests/js/store/faceplate/drawers-output.test.js): the form the daemon serves and the readings loaded over it, the
// idle engine and the closed drawer a suite starts from, the config route and the served field readings of a staging
// wire, the drawer's markup, and the rate dial's row and its controls. Not a *.test.js file on purpose: the runner glob
// would execute it.

import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { RateDial } from "../../../../hqptuner/static/components/faceplate/drawers/output/RateDial.js";
import { OUTPUT_BLOCKS, OUTPUT_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/output.js";
import {
  config,
  engineState,
  engineStatus,
  enums,
  generation,
  metadata,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { pickChannelLayout } from "../../../../hqptuner/static/store/faceplate/drawers/output.js";
import { attr, classes, elements } from "../markup.js";
import { fieldReading, seedReadings } from "../readings.js";
import { ok, quiesce, stagingWire } from "../wire/wire.js";
import { fire, rowHolding } from "./drawer-render.js";

/** @typedef {import("../markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../wire/wire.js").StagingWire} StagingWire */

const NET = "naa-office/hw:CARD=sndrpihifiberry,DEV=0";
const ALSA = "hw:CARD=NVidia,DEV=3";

/** The values a daemon serves with both backends' fields, the Network backend picked. */
export const BOTH_FILE = {
  mode: "pcm",
  backend: "network",
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

/** The values the daemon serves with only the network backend's fields. */
export const NETWORK_FILE = Object.fromEntries(Object.entries(BOTH_FILE).filter(([name]) => !name.startsWith("alsa_")));

/** The options each device field's form lists, as option value and the label the daemon gives it. */
const DEVICE_OPTIONS = {
  net_device: [{ value: NET, label: "naa-office: card: iface" }],
  alsa_device: [{ value: ALSA, label: "HDA NVidia: HDMI 0" }],
};

/** The type of each form field here. */
const FIELD_TYPE = {
  mode: "select",
  backend: "select",
  defaults_samplerate: "select",
  defaults_bitrate: "select",
  net_device: "select",
  alsa_device: "select",
  net_dop: "checkbox",
  alsa_dop: "checkbox",
  net_anydsd: "checkbox",
  alsa_anydsd: "checkbox",
  net_ipv6: "checkbox",
  channels: "number",
  net_bits: "number",
  alsa_bits: "number",
  alsa_offset: "number",
  net_period: "number",
  alsa_period: "number",
};

/**
 * Load the form and the readings the daemon serves over it: one /config field for each reading that is a form field,
 * of the type its name carries here and the options the form lists for it, `options` over the device fields' own; a
 * reading that is no form field, a read-only one, is served with them.
 *
 * @param {Record<string, unknown>} readings
 * @param {Record<string, { value: string, label: string }[]>} [options]
 */
export async function seedForm(readings, options = {}) {
  /** @type {Record<string, { value: string, label: string }[]>} */
  const listed = { ...DEVICE_OPTIONS, ...options };
  config.value = {
    fields: Object.keys(readings)
      .filter((name) => name in FIELD_TYPE)
      .map((name) => ({
        name,
        type: FIELD_TYPE[/** @type {keyof typeof FIELD_TYPE} */ (name)],
        ...(name in listed ? { options: listed[name] } : {}),
      })),
  };
  await seedReadings(readings);
}

/**
 * Put the engine idle and the drawer closed with nothing staged, the settings metadata `meta`, and the channel layout
 * on stereo.
 *
 * @param {typeof metadata.value} [meta]
 */
export async function settleOutput(meta = null) {
  engineState.value = { state: "0" };
  engineStatus.value = { status: {}, metadata: {} };
  enums.value = null;
  metadata.value = meta;
  openStage.value = null;
  openPopover.value = null;
  await pickChannelLayout("2");
  await discardAll();
}

/**
 * Drive the store at the wire with the form of `file` served as plain readings, then settle the drawer.
 *
 * @param {Record<string, unknown>} file
 * @param {{ options?: Record<string, { value: string, label: string }[]>, meta?: Parameters<typeof settleOutput>[0] }} [over]
 * @returns {Promise<StagingWire>}
 */
export async function loadOutput(file, { options, meta } = {}) {
  const wire = stagingWire();
  await seedForm(file, options);
  await settleOutput(meta);
  return wire;
}

/**
 * The route of a staging wire that answers the engine's state and rate list from the signals the suite assigns, and
 * nothing else.
 *
 * @param {string} path
 */
export const engineRoute = (path) =>
  path === "/api/state"
    ? ok({ data: engineState.value })
    : path === "/api/enumerations"
      ? ok({ data: enums.value })
      : undefined;

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
 * The served field readings of every value in `file`.
 *
 * @param {Record<string, unknown>} file
 * @param {StagingWire | undefined} w
 */
export function servedOutput(file, w) {
  const staged = w ? w.staged.http : {};
  return Object.fromEntries(Object.entries(file).map(([name, value]) => [name, served1(name, value, staged)]));
}

/** The Output drawer, drawn from its schema and blocks. */
export const outputTree = () => html`<${Drawer} schema=${OUTPUT_DRAWER} blocks=${OUTPUT_BLOCKS} />`;

/** Every element of the Output drawer's markup, in document order. */
export const outputMarkup = () => elements(render(outputTree()));

/**
 * The rate dial among `all`.
 *
 * @param {MarkupElement[]} all
 */
export const rateDial = (all) => all.find((e) => classes(e).includes("dial") && attr(e, "role") === "group");

/**
 * The smallest drawer row enclosing the rate dial among `all`.
 *
 * @param {MarkupElement[]} all
 */
export const rateRow = (all) => rowHolding(all, [rateDial(all)]);

/**
 * The props of a rate dial's slider of `band`.
 *
 * @param {string} band
 */
export const slider = (band) => (/** @type {Record<string, unknown>} */ p) =>
  p.role === "slider" && p["data-band"] === band;

/**
 * A key press as the slider reads it.
 *
 * @param {string} key
 */
export const keyEvent = (key) => ({ key, preventDefault: () => undefined });

/**
 * Tap the rate dial's picker option `pin`, or nothing when the dial carries none, and let the wire go quiet.
 *
 * @param {StagingWire} wire
 * @param {string} pin
 */
export async function pickPin(wire, pin) {
  await fire(html`<${RateDial} />`, (p) => p["data-pin"] === pin, "onClick");
  await quiesce(wire);
}

/**
 * Press `key` on the rate dial's slider of `band`, or nothing when the dial carries none, and let the wire go quiet.
 *
 * @param {StagingWire} wire
 * @param {string} band
 * @param {string} key
 */
export async function pressKey(wire, band, key) {
  await fire(html`<${RateDial} />`, slider(band), "onKeyDown", keyEvent(key));
  await quiesce(wire);
}
