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
import { effective, runningValue } from "./resolve.js";
import { askWarn } from "./ask.js";

// A warning whose two answers are a plain yes/no about a documented consequence,
// as opposed to the buffer warnings' "are you sure you know better" (ask.js).
const YES_NO = { confirm: "Yes", decline: "No" };

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
 * The engine NAME of a flagged modulator, or "" when the id names an unflagged
 * one (or the overlay has not loaded). The name is what the apply-time warning
 * puts in front of the user, so the lookup answers the label rather than a bare
 * boolean and the predicate below reads it as one.
 *
 * @param {string | number | boolean | undefined} value a `sdm_modulator` enum id
 * @returns {string}
 */
function thirstyLabel(value) {
  const db = ((metadata.value && metadata.value.shapers) || {}).sdm_modulators;
  if (!db) return "";
  const hit = optionsFor("config", schema.sdm_modulator.field || "").find((o) => String(o.value) === String(value));
  return hit && (db[hit.label] || {}).needs_external_volume ? hit.label : "";
}

/**
 * @param {string | number | boolean | undefined} value a `sdm_modulator` enum id
 * @returns {boolean}
 */
const needsExternalVolume = (value) => thirstyLabel(value) !== "";

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
// A hazard the user has already said yes to, by id, while it stays continuously
// staged. The same hazard is asked at edit time and again over the whole staged
// configuration at apply time (below), and asking twice for one decision is a
// nag: confirming the modulator and then being asked about the same pairing on
// Apply is the app doubting an answer it already has. An acknowledgement is
// dropped the moment its hazard leaves the staged picture (pruneAcknowledged),
// so backing out and walking into it again asks afresh.
// The two hazards that exist at BOTH gates, and so are the two an edit-time yes
// can settle for the apply. The buffer warnings have no apply-time counterpart
// and take no id.
const SNR_PAIRING = "snr-pairing";
const SDM_PIN = "sdm-pin";

/** @type {Set<string>} */
const acknowledged = new Set();

/**
 * Remember a confirmed hazard once the question it asked resolves yes.
 *
 * @param {string} id
 * @param {Promise<unknown>} asked
 * @returns {Promise<unknown>}
 */
const ackOn = (id, asked) =>
  asked.then((ok) => {
    if (ok) acknowledged.add(id);
    return ok;
  });

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
    return ackOn(
      SDM_PIN,
      askWarn(
        key,
        "Enabling this setting will force a -3dB fixed volume on the PCM chain as well. Are you sure you want to proceed?",
        YES_NO,
      ),
    );
  if (picksThirstyModulator(key, value))
    return ackOn(
      SNR_PAIRING,
      askWarn(
        key,
        "This modulator is best suited to systems where volume is externally controlled. Are you sure you want to proceed?",
        YES_NO,
      ),
    );
  if (freesVolumeControl(key, value))
    return ackOn(
      SNR_PAIRING,
      askWarn(
        key,
        "The current modulator is best suited to systems using external volume control. Are you sure you want to proceed?",
        YES_NO,
      ),
    );
  return null;
}

// ---- apply-time guards ------------------------------------------------------
//
// The edit-time guards above only ever see ONE key moving against an otherwise
// settled configuration, so every route that assembles several fields at once
// walks straight past them: stageHttp() writes wire field names without going
// through edit(), and previewPreset() drops a whole saved config in as the
// baseline. Both arrive as a finished configuration with no edit to guard.
//
// applyAll() is the choke point every one of those routes crosses, so the same
// hazards are asked a second time there — about the CONFIGURATION rather than
// about an edit. A hazard earns its question only when the staged picture has it
// and the running configuration does not: applying into a pairing that is
// already live and unchanged must stay silent, or every Apply nags forever.

// The pending bar renders apply-time questions — it is where the Apply button
// the user just pressed lives (components/PendingBar.js OWNER).
const APPLY_OWNER = "pending";

/**
 * @param {(key: string) => string | number | boolean | undefined} get
 * @returns {boolean}
 */
const snrPairing = (get) => needsExternalVolume(get("sdm_modulator")) && volumeLive(get);

/**
 * @param {(key: string) => string | number | boolean | undefined} get
 * @returns {boolean}
 */
const sdmForcesFixedVolume = (get) => truthy(get("direct_sdm")) && !atFixedMinusThree(get);

/**
 * @typedef {object} ApplyHazard
 * @property {string} id
 * @property {(get: (key: string) => string | number | boolean | undefined) => boolean} hit
 * @property {(get: (key: string) => string | number | boolean | undefined) => string} message
 */

/** @type {ApplyHazard[]} */
const APPLY_HAZARDS = [
  {
    id: SNR_PAIRING,
    hit: snrPairing,
    message: (get) =>
      `The staged settings are suboptimal: modulator ${thirstyLabel(get("sdm_modulator"))} is recommended for ` +
      `external volume control only, but this change enables it and internal volume control. ` +
      `Are you sure you want to proceed?`,
  },
  {
    id: SDM_PIN,
    hit: sdmForcesFixedVolume,
    message: () =>
      "Applying these settings will force a -3dB fixed volume on the PCM chain. Are you sure you want to proceed?",
  },
];

// Asked in sequence, not in parallel: ask.js holds ONE open question at a time
// and a second call supersedes the first, so two hazards could not be opened at
// once. The two hazards here are in fact mutually exclusive — the SNR pairing
// needs a live volume control, which `volumeLive` defines as Direct SDM being
// off, and the other hazard needs it on — so today the loop asks at most one
// question. It is written as a loop rather than a pair of ifs because a third
// hazard would otherwise have to reintroduce the sequencing by hand.
//
// Declining abandons the apply with the staging untouched.
/**
 * Settle every apply-time hazard the staged configuration newly introduces.
 *
 * @returns {Promise<boolean>} false when the user declined and the apply must not go out
 */
export async function applyGuard() {
  pruneAcknowledged();
  for (const h of APPLY_HAZARDS) {
    if (!h.hit(effective) || h.hit(runningValue) || acknowledged.has(h.id)) continue;
    if (!(await askWarn(APPLY_OWNER, h.message(effective), YES_NO))) return false;
    acknowledged.add(h.id);
  }
  return true;
}

// Drop the acknowledgement of any hazard that has left the staged picture, so a
// yes never carries over to a hazard the user walked back out of and into again.
// Called by the write paths as they settle (store/actions.js): an edit that
// clears the pairing forgets the yes that was about it.
/** Forget acknowledgements whose hazard the staged configuration no longer has. */
export function pruneAcknowledged() {
  for (const h of APPLY_HAZARDS) if (!h.hit(effective)) acknowledged.delete(h.id);
}
