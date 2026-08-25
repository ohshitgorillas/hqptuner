// The questions a staged edit has to settle before it stages. Every rule here
// answers one shape: the (key, value) the user just picked would leave the
// configuration somewhere Signalyst's own documentation warns against, and the
// user is the only one who can decide that trade. Declining stages nothing, so
// the control snaps back to its baseline (store/actions.js edit()).
//
// This is deliberately NOT an idle gate: HQPTuner honors every user action
// whether the daemon is playing or not. A guard asks about the CONFIGURATION it
// would produce, never about the engine's state.

import { schema, atFixedMinusThree, volumePinned } from "./schema.js";
import { optionsFor } from "./options.js";
import { truthy } from "../lib/coerce.js";
import { metadata } from "./signals.js";
import { effective } from "./resolve.js";
import { askWarn } from "./ask.js";

// Minimum-buffer values break real setups — per Signalyst's own guidance, the
// minimum device buffer time mostly yields packet-underflow drop-outs or no
// output at all, and the minimum short-buffer FIFO is a realtime-processing
// setting with system-design prerequisites. Staging one asks first; declining
// stages nothing, so the control snaps back to its baseline.
/**
 * The warn phrase a hazardous (key, value) pair earns, or "" for a safe one.
 *
 * @param {string} key
 * @param {string | number | boolean} value
 * @returns {string}
 */
function bufferHazard(key, value) {
  if (key === "short_buffer" && String(value) === "2") return "minimum short buffer";
  if ((key === "alsa_period" || key === "net_period") && Number(value) < 0) return "minimum buffer time";
  return "";
}

// Enabling Direct SDM makes the daemon disable the volume control and pin PCM
// volume at a fixed −3 dBFS (manual §4.5), so warn when Direct SDM turns on
// from any volume state other than a fixed −3 dB, by either fixed-volume mode.
// The daemon applies the pin; direct_sdm stages alone.
/**
 * @param {string} key
 * @param {string | number | boolean} value
 * @returns {boolean}
 */
const forcesFixedVolume = (key, value) => key === "direct_sdm" && truthy(value) && !atFixedMinusThree(effective);

// Some modulators trade SNR for other qualities and assume the volume control
// sits outside HQPlayer (data/shapers.json `needs_external_volume`, from the
// manual's own note on AHM5EC5L / AHM7EC5L). Attenuating such a chain with
// HQPlayer's own volume control spends the headroom the modulator does not have,
// so both ways INTO that pairing ask first: picking the modulator against a live
// volume control, and freeing the volume control while one is already selected.
//
// Whether the volume control is the operative one is `volumePinned` plus Direct
// SDM, which the predicate does not cover: it pins the volume in the daemon
// rather than in the config (manual §4.5), so a config that reads unpinned still
// has no live volume control behind it.
/**
 * @param {(key: string) => string | number | boolean | undefined} get
 * @returns {boolean}
 */
const volumeLive = (get) => !volumePinned(get) && !truthy(get("direct_sdm"));

// The modulator overlay joins by engine NAME (architecture §2) while the staged
// value is the /config form's enum id, so the form's own option list is what
// turns one into the other — the same join store/alerts/shaperfit.js makes.
/**
 * @param {string | number | boolean | undefined} value a `sdm_modulator` enum id
 * @returns {boolean}
 */
function needsExternalVolume(value) {
  const db = ((metadata.value && metadata.value.shapers) || {}).sdm_modulators;
  if (!db) return false;
  const hit = optionsFor("config", schema.sdm_modulator.field || "").find((o) => String(o.value) === String(value));
  return Boolean(hit && (db[hit.label] || {}).needs_external_volume);
}

// The config this edit would leave behind, for the one key it changes. Staging
// is the point of decision, so the question has to be asked about the PENDING
// picture rather than the present one.
/**
 * @param {string} key
 * @param {string | number | boolean} value
 * @returns {(k: string) => string | number | boolean | undefined}
 */
const afterEdit = (key, value) => (k) => (k === key ? value : effective(k));

// Keys that can move the volume control between pinned and live. volume_min /
// volume_max are here for the 0/0 spelling of pinned, which either one escapes.
const VOLUME_KEYS = ["fixed_volume_enabled", "optimal_iso", "direct_sdm", "volume_min", "volume_max"];

/**
 * @param {string} key
 * @param {string | number | boolean} value
 * @returns {boolean}
 */
const picksThirstyModulator = (key, value) =>
  key === "sdm_modulator" && needsExternalVolume(value) && volumeLive(effective);

// The reverse edit: the modulator is already chosen and the volume control is
// what moves. Only a transition earns the question — an edit that leaves the
// volume pinned by another mechanism (swapping fixed volume for Auto headroom)
// changes nothing about the pairing.
/**
 * @param {string} key
 * @param {string | number | boolean} value
 * @returns {boolean}
 */
const freesVolumeControl = (key, value) =>
  VOLUME_KEYS.includes(key) &&
  !volumeLive(effective) &&
  volumeLive(afterEdit(key, value)) &&
  needsExternalVolume(effective("sdm_modulator"));

// Returns a question to settle before staging, or null for a safe edit — and
// stays synchronous so a safe edit reaches its optimistic merge in the caller's
// own tick. An `await` on the safe path defers that merge by a microtask, which
// is long enough for a caller that fires an edit without awaiting it (setXfMode)
// to read the pre-edit value back out of effective().
/**
 * The guard question a hazardous (key, value) pair earns, or null for a safe one.
 *
 * @param {string} key
 * @param {string | number | boolean} value
 * @returns {Promise<unknown> | null}
 */
export function guard(key, value) {
  const hazard = bufferHazard(key, value);
  if (hazard)
    return askWarn(
      key,
      `It is strongly recommended NOT to use this setting (${hazard}) except under guidance from Jussi himself. ` +
        `Otherwise, this is probably going to break your setup or fail to produce music. ` +
        `Are you certain you actually know what you're doing?`,
    );
  if (forcesFixedVolume(key, value))
    return askWarn(
      key,
      "Enabling this setting will force a -3dB fixed volume on the PCM chain as well. Are you sure you want to proceed?",
      { confirm: "Yes", decline: "No" },
    );
  if (picksThirstyModulator(key, value))
    return askWarn(
      key,
      "This modulator is best suited to systems where volume is externally controlled. Are you sure you want to proceed?",
      { confirm: "Yes", decline: "No" },
    );
  if (freesVolumeControl(key, value))
    return askWarn(
      key,
      "The current modulator is best suited to systems using external volume control. Are you sure you want to proceed?",
      { confirm: "Yes", decline: "No" },
    );
  return null;
}
