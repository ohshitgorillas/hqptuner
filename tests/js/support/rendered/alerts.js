// The rig the alert suites share: the /api/health readings and the /api/status poll they drive the alert store with,
// the plate's signals put back to a stated start, the served profile list the plate reads, the tap event a vnode handler
// takes, and the stage buttons of a rendered rail.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { render } from "preact-render-to-string";

import {
  config,
  engineState,
  engineStatus,
  enums,
  health,
  lastApply,
  matrixConfig,
  pendingPreset,
} from "../../../../hqptuner/static/store/signals.js";
import { applying } from "../../../../hqptuner/static/store/actions.js";
import { engineBusy } from "../../../../hqptuner/static/store/enginewrite.js";
import {
  liveBook,
  livePresetError,
  livePresets,
  livePresetsBusy,
  livePresetStation,
} from "../../../../hqptuner/static/store/live/presets.js";
import { unfolded } from "../../../../hqptuner/static/store/faceplate/stations.js";
import { body, openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { elements, attr } from "../markup.js";
import { seedReadings } from "../readings.js";

/** @typedef {import("../markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../vnodeseam.js").VNode} VNode */

/** A /api/health reading as served: the connection Ready and the credentials the daemon accepted. */
export const HEALTHY = { phase: "Ready", generation: 1, credentials_ok: true };

/** A /api/health reading whose credentials the daemon accepted, in the shape the plate reads. */
export const ACCEPTED = { reachable: true, ready: true, connected: true, credentials_ok: true, info: {} };

/** The junk advisor's object as /api/status carries it. */
export const ADVICE = { filter: "30k", reason: "reason-fixture", ceiling_khz: 30 };

/** A tap event: the members a tap handler may call. */
export const TAP = { preventDefault() {}, stopPropagation() {}, target: {}, currentTarget: {} };

let serial = 0;

/**
 * One /api/status poll on the current track: playing at a healthy speed on a non-apodizing filter the enumeration
 * carries, with the fields a case names laid over it.
 *
 * @param {Record<string, string>} [fields]  Status frame attributes
 * @param {Record<string, unknown>} [extra]  the payload's other keys: `metadata`, `junk`
 */
export function poll(fields = {}, extra = {}) {
  engineStatus.value = {
    status: {
      state: "2",
      track_serial: String(serial),
      process_speed: "1.5",
      output_fill: "0.9",
      clips: "0",
      apod: "0",
      active_filter: "sinc-M",
      ...fields,
    },
    ...extra,
  };
}

/** Start a fresh track and poll it at a healthy speed. */
export function newTrack() {
  serial += 1;
  poll();
}

/**
 * Put the engine, config, live-preset and apply signals back to a stated start, the engine state and the live book
 * as given and everything else empty.
 *
 * @param {{ state?: Record<string, unknown>, enumerations?: object, book?: Record<string, unknown> }} [start]
 */
export function resetPlateSignals({ state = {}, enumerations, book = {} } = {}) {
  engineState.value = state;
  engineStatus.value = null;
  if (enumerations) enums.value = enumerations;
  matrixConfig.value = { fields: [] };
  config.value = { fields: [] };
  liveBook.value = book;
  livePresets.value = null;
  livePresetStation.value = null;
  livePresetsBusy.value = "";
  livePresetError.value = "";
  lastApply.value = null;
  pendingPreset.value = null;
}

/** Seed the readings with the Day preset active and the profile list holding it. */
export async function seedDay() {
  await seedReadings({
    active_preset: { value: "Day", readonly: true },
    profiles: {
      value: { options: ["", "Day"].map((n) => ({ value: n, label: n })) },
      readonly: true,
    },
  });
}

/** Nothing applying, no stage unfolded, the chain body and no popover. */
export function clearPlateView() {
  applying.value = false;
  engineBusy.value = false;
  unfolded.value = null;
  body.value = "chain";
  openPopover.value = null;
}

/** Settle the plate on a healthy reading and a clear view. */
export function settlePlate() {
  health.value = { ...ACCEPTED };
  clearPlateView();
}

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** Put the real `fetch` back, for an `afterEach` of a suite whose wire replaced it. */
export function restoreFetch() {
  env.fetch = REAL_FETCH;
}

/**
 * The stage buttons of a rendered rail.
 *
 * @param {VNode} tree
 * @returns {MarkupElement[]}
 */
export const railButtons = (tree) => elements(render(tree)).filter((e) => e.name === "button");

/**
 * The button of one stage among `list`, or an empty element when there is none.
 *
 * @param {MarkupElement[]} list
 * @param {string} id
 * @returns {MarkupElement}
 */
export const stageButton = (list, id) =>
  list.find((b) => attr(b, "data-stage") === id) || { name: "", attrs: "", start: -1, html: "" };
