// The questions a staged edit has to settle before it stages. Every rule here
// answers one shape: the (key, value) the user just picked would leave the
// configuration somewhere Signalyst's own documentation warns against, and the
// user is the only one who can decide that trade. Declining stages nothing, so
// the control snaps back to its baseline (store/actions.js edit()).
//
// This is deliberately NOT an idle gate: HQPTuner honors every user action
// whether the daemon is playing or not. A guard asks about the CONFIGURATION it
// would produce, never about the engine's state.

import { atFixedMinusThree } from "./schema/gray.js";
import { truthy } from "../lib/coerce.js";
import { effective, runningValue } from "./resolve.js";
import { askWarn } from "./ask.js";
import { fieldOf } from "./ui/backends.js";

// A warning whose two answers are a plain yes/no about a documented consequence,
// as opposed to the buffer warnings' "are you sure you know better" (ask.js).
const YES_NO = { confirm: "Yes", decline: "No" };

// Every backend's own buffer-time control.
const PERIOD_KEYS = new Set(["alsa", "asio", "wasapi", "network"].map((backend) => fieldOf(backend, "period")));

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
  if (PERIOD_KEYS.has(key) && Number(value) < 0) return "minimum buffer time";
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

// Returns a question to settle before staging, or null for a safe edit — and
// stays synchronous so a safe edit reaches its optimistic merge in the caller's
// own tick. An `await` on the safe path defers that merge by a microtask, which
// is long enough for a caller that fires an edit without awaiting it (setXfMode)
// to read the pre-edit value back out of effective().
// A hazard the user has already said yes to, by id, while it stays continuously
// staged. The same hazard is asked at edit time and again over the whole staged
// configuration at apply time (below), and asking twice for one decision is a
// nag: confirming Direct SDM and then being asked about it again on Apply is the
// app doubting an answer it already has. An acknowledgement is dropped the
// moment its hazard leaves the staged picture (pruneAcknowledged), so backing
// out and walking into it again asks afresh.
// The hazard that exists at BOTH gates, and so is the one an edit-time yes can
// settle for the apply. The buffer warnings have no apply-time counterpart and
// take no id.
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
  return null;
}

// ---- apply-time guards ------------------------------------------------------
//
// The edit-time guards above only ever see ONE key moving against an otherwise
// settled configuration, so a route that assembles a whole configuration at once
// walks straight past them: previewPreset() drops a saved config in as the
// baseline, which arrives with no edit to guard.
//
// The other edit()-free staging route, stageHttp(), cannot reach this hazard
// and is not why this exists: it is module-private, its one entry is
// stagePipelines(rows, extra), and that `extra` is a saved matrix profile's
// post-process map — matrix_pipelines and post_bauer_* — which does not carry
// Direct SDM.
//
// applyAll() is the choke point every one of those routes crosses, so the same
// hazard is asked a second time there — about the CONFIGURATION rather than
// about an edit. A hazard earns its question only when the staged picture has it
// and the running configuration does not: applying into a state that is already
// live and unchanged must stay silent, or every Apply nags forever.

// The pending bar renders apply-time questions — it is where the Apply button
// the user just pressed lives (components/PendingBar.js OWNER).
const APPLY_OWNER = "pending";

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
    id: SDM_PIN,
    hit: sdmForcesFixedVolume,
    message: () =>
      "Applying these settings will force a -3dB fixed volume on the PCM chain. Are you sure you want to proceed?",
  },
];

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
// clears the hazard forgets the yes that was about it.
/** Forget acknowledgements whose hazard the staged configuration no longer has. */
export function pruneAcknowledged() {
  for (const h of APPLY_HAZARDS) if (!h.hit(effective)) acknowledged.delete(h.id);
}
