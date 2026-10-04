// The hardware settings' store half: CUDA offload, multicore DSP, E-core use, the block count and the two CUDA devices.
// These are engine attributes outside the config staging buffer, so the store holds its own form: a base, what the
// daemon last reported or last verified, and a draft of edits over it. The write is the engine's own POST, which
// restarts the daemon, so it rides the engine-write lifecycle; only a verified apply moves the base. The all-stations
// switch says where that write lands and is never an edit.

import { computed, signal } from "@preact/signals";
import { api } from "../../../lib/api.js";
import { duringEngineWrite } from "../../enginewrite.js";

/**
 * @typedef {"cuda" | "multicore" | "ecores" | "nblocks" | "cuda_dev" | "cuda_cdev"} HardwareKey
 * @typedef {Record<HardwareKey, string>} HardwareValues  one value per engine attribute, as the daemon spells it
 */

/**
 * The draft over the base and whether it differs.
 *
 * @typedef {object} HardwareDraft
 * @property {boolean} loaded  the engine has been read
 * @property {HardwareValues} values  the draft
 * @property {HardwareValues} base  what the daemon last reported or verified
 * @property {boolean} differs  an edit would change what the daemon holds
 */

/** The engine attributes this form holds. @type {HardwareKey[]} */
export const HARDWARE_KEYS = ["cuda", "multicore", "ecores", "nblocks", "cuda_dev", "cuda_cdev"];

/**
 * The daemon's value for an attribute absent from its config (manual §1.2); -1 picks a CUDA device automatically.
 *
 * @type {HardwareValues}
 */
export const DEFAULTS = {
  cuda: "0",
  multicore: "auto",
  ecores: "default",
  nblocks: "0",
  cuda_dev: "-1",
  cuda_cdev: "-1",
};

const base = signal(/** @type {HardwareValues} */ ({ ...DEFAULTS }));
const values = signal(/** @type {HardwareValues} */ ({ ...DEFAULTS }));
const loaded = signal(false);

/** Whether an apply writes every station rather than the loaded one. */
export const allStations = signal(false);

/**
 * Set where an apply lands: every station, or the loaded one.
 *
 * @param {boolean} on
 */
export function setAllStations(on) {
  allStations.value = on;
}

/**
 * The engine's attributes, each one it omits at the daemon's default.
 *
 * @param {Record<string, unknown>} engine
 * @returns {HardwareValues}
 */
function readEngine(engine) {
  const out = { ...DEFAULTS };
  for (const k of HARDWARE_KEYS) {
    const v = engine[k];
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  return out;
}

/**
 * Read the engine into the base and the draft, dropping any edit.
 *
 * @returns {Promise<void>}
 */
export async function loadHardware() {
  const r = await api.engine();
  const read = readEngine((r && r.engine) || {});
  base.value = read;
  values.value = { ...read };
  loaded.value = true;
}

/**
 * The draft, the base, and whether any value differs from the base as a string.
 *
 * @returns {HardwareDraft}
 */
export function hardwareDraft() {
  const now = values.value;
  const was = base.value;
  return {
    loaded: loaded.value,
    values: now,
    base: was,
    differs: HARDWARE_KEYS.some((k) => String(now[k]) !== String(was[k])),
  };
}

/**
 * Draft one setting.
 *
 * @param {HardwareKey} key
 * @param {string} value
 */
export function setHardware(key, value) {
  values.value = { ...values.value, [key]: value };
}

/** Whether the draft holds an edit to apply. */
export const staged = computed(() => hardwareDraft().differs);

/**
 * Send the draft through the engine's own POST. A verified apply re-bases onto the values sent; an unverified one
 * leaves the draft staged.
 *
 * @returns {Promise<boolean>} whether the daemon verified the new values
 */
export async function applyHardware() {
  const overrides = { ...values.value };
  const r = await duringEngineWrite(() => api.applyEngine({ overrides, all_presets: allStations.value }));
  const applied = r?.report?.verified?.applied === true;
  if (applied) base.value = overrides;
  return applied;
}

/** Put every drafted value back to the base. */
export function discardHardware() {
  values.value = { ...base.value };
}
