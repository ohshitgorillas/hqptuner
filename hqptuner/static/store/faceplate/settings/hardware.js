// The hardware settings' store half: CUDA offload, multicore DSP, E-core use, the block count and the two CUDA devices.
// These engine attributes sit outside the config staging buffer, so they make an engine form of their own on the apply
// area (store/core/forms.js): it holds the engine's values and the user's edits over them, and applies through the
// engine's own POST, which restarts the daemon. An apply the daemon does not confirm is a failed write. The all-stations
// switch says where that write lands and is never an edit.

import { computed, signal } from "@preact/signals";
import { api } from "../../../lib/api.js";
import { UNCONFIRMED, formDraft } from "../../core/forms.js";

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
 * @property {HardwareValues} base  what the daemon last reported
 * @property {boolean} differs  an edit would change what the daemon holds
 * @property {boolean} stale  the base may differ from what the daemon holds: a write has landed and its readback has
 *   not, or the last engine read failed
 */

/** The engine attributes this form holds. @type {HardwareKey[]} */
export const HARDWARE_KEYS = ["cuda", "multicore", "ecores", "nblocks", "cuda_dev", "cuda_cdev"];

/**
 * The daemon's value for an attribute absent from its config (manual §1.2); -1 picks a CUDA device automatically.
 *
 * @type {HardwareValues}
 */
const DEFAULTS = {
  cuda: "0",
  multicore: "auto",
  ecores: "default",
  nblocks: "0",
  cuda_dev: "-1",
  cuda_cdev: "-1",
};

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

const form = formDraft({
  area: "apply",
  eager: false,
  keys: HARDWARE_KEYS,
  load: async () => {
    const r = await api.engine();
    return readEngine((r && r.engine) || {});
  },
  write: async (edits) => {
    const overrides = { ...form.base.value, ...edits };
    const r = await api.applyEngine({ overrides, all_presets: allStations.peek() });
    if (r?.report?.verified?.applied !== true) throw new Error(UNCONFIRMED);
  },
});

/**
 * Read the engine into the base, dropping any edit.
 *
 * @returns {Promise<void>}
 */
export async function loadHardware() {
  form.discard();
  await form.reload();
}

/**
 * The draft, the base, and whether any value differs from the base; until the engine is read, both sit at the
 * daemon's defaults.
 *
 * @returns {HardwareDraft}
 */
export function hardwareDraft() {
  const read = /** @type {HardwareValues | null} */ (form.base.value);
  const was = read ?? DEFAULTS;
  return {
    loaded: read !== null,
    values: /** @type {HardwareValues} */ ({ ...was, ...form.values.value }),
    base: was,
    differs: form.differs.value.length > 0,
    stale: form.stale.value,
  };
}

/**
 * Draft one setting.
 *
 * @param {HardwareKey} key
 * @param {string} value
 */
export function setHardware(key, value) {
  form.set(key, value);
}

/** Whether the draft holds an edit to apply. */
export const staged = computed(() => hardwareDraft().differs);

/**
 * Send the draft through the engine's own POST on the apply area. The base takes the engine's readback only on a
 * confirmed apply; otherwise every edit stays in the draft and the failure shows on the apply alert line.
 *
 * @returns {Promise<boolean>} whether the daemon confirmed the new values
 */
export function applyHardware() {
  return form.apply();
}

/** Drop every edit, so the draft reads the base again. */
export function discardHardware() {
  form.discard();
}
