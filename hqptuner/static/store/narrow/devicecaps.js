// Output-device capability narrowing. The daemon announces what the device it
// opened accepts, HQPTuner reads that out of the log (engine/devicecaps.py) and
// serves it on /api/config as `device_caps`; this module turns it into grayed
// menu entries. Nothing here ever hides an option or blocks a write — it grays,
// with the reason, exactly like the rest of the store's narrowing.
//
// The governing rule, everywhere below: when the capability cannot speak for the
// control, it narrows NOTHING. No announcement, a staged device the daemon has
// not opened yet, the combo backend (two devices, one announcement, unknown
// which limits bind) — all fall through to the full menu. Graying on a guess
// makes a reachable setting unreachable, which is the worse failure.

import { computed, effect } from "@preact/signals";
import { config } from "../signals.js";
import { effective } from "../resolve.js";
import { edit } from "../actions.js";
import { schema, TWIN_44K, DSD_RATES } from "../schema.js";
import { truthy } from "../../lib/coerce.js";

// The form field naming the device each backend drives. Combo drives both at
// once and is deliberately absent: the log announces one device, so which one's
// limits apply is unknown and combo narrows nothing.
/**
 * @typedef {object} DeviceCaps
 *   One output device's announcement, as engine/devicecaps.py serves it under
 *   /api/config `device_caps`. Both rate lists are integer Hz.
 * @property {string} device
 * @property {number[]} pcm_rates
 * @property {number[]} dsd_rates
 *
 * @typedef {object} DeviceOption
 *   The one member of a menu option this module tests. Deliberately looser than
 *   OptionItem: the lists reaching here are the schema's own bare {value, label}
 *   rate tables as well as OptionItem lists from the option stores.
 * @property {string | number | undefined} value
 */

/** @type {Record<string, string>} */
const DEVICE_FIELD = { network: "net_device", alsa: "alsa_device" };
// DoP is a per-backend switch, on the same map for the same reason.
/** @type {Record<string, string>} */
const DOP_FIELD = { network: "net_dop", alsa: "alsa_dop" };

// DoP carries DSD inside an ordinary PCM stream, one DSD bit per carrier bit at
// 16 carrier bits per sample (DoP v1.1) — so a DSD rate needs a PCM carrier a
// sixteenth of it. DSD64 rides 176.4 kHz, DSD128 rides 352.8, and a device that
// announces neither DSD nor a fast enough carrier cannot reach that tier at all.
const DOP_DIVISOR = 16;

const backend = () => String(effective("backend") || "");

// Both members of a tier — the menu's own 48k value and its 44.1k twin. A device
// announcing either can play that tier, so both are asked about.
const members = (/** @type {string | number | undefined} */ tier) => {
  const t = String(tier);
  return [t, TWIN_44K[t]].filter(Boolean);
};

// The capability, but only when it is about the device the user is looking at.
// The backend compares its announcement against the APPLIED device; the staged
// one may already be different, and narrowing a freshly picked device to the old
// one's limits is exactly the stale gray this guards against.
const deviceCaps = computed(() => {
  const caps = (config.value && config.value.device_caps) || null;
  if (!caps) return null;
  const field = DEVICE_FIELD[backend()];
  if (!field) return null;
  return String(effective(field) || "") === caps.device ? caps : null;
});

const dopOn = () => {
  const field = DOP_FIELD[backend()];
  return !!field && truthy(effective(field));
};

// One word for every grayed rate tier, whatever made it unreachable. A dropdown
// reason rides on the option's own label — "DSD1024 — needs a 705.6 kHz carrier
// for DoP" is a paragraph in a third-width box — and the same word is what the
// LIVE columns already use for a tier the engine is not offering (live.js
// UNOFFERED). The detail belongs on the mode segment, which has room for it.
const UNAVAILABLE = "unavailable";

// Which DSD tiers the device can reach: the ones it announced outright, plus —
// when DoP is on — the ones whose carrier it announced as a PCM rate.
/**
 * @param {DeviceCaps} caps
 * @param {string | number | undefined} tier
 * @returns {boolean}
 */
function dsdReachable(caps, tier) {
  const native = new Set((caps.dsd_rates || []).map(String));
  if (members(tier).some((r) => native.has(r))) return true;
  if (!dopOn()) return false;
  const pcm = new Set((caps.pcm_rates || []).map(String));
  return members(tier).some((r) => pcm.has(String(Number(r) / DOP_DIVISOR)));
}

/**
 * @param {DeviceCaps} caps
 * @param {string | number | undefined} tier
 * @returns {boolean}
 */
function pcmReachable(caps, tier) {
  const announced = new Set((caps.pcm_rates || []).map(String));
  return members(tier).some((r) => announced.has(r));
}

// Gray the rate tiers the selected device cannot carry. `family` is 'pcm' or
// 'sdm' — the menu being narrowed, not the running chain.
/**
 * Disable the rate tiers the selected output device did not announce, natively or
 * through a DoP carrier. Narrows nothing when the announcement cannot speak for it.
 * @template {DeviceOption} T
 * @param {T[]} options
 * @param {string} family
 * @returns {(T | (T & { disabled: boolean, reason: string }))[]}
 */
export function grayRatesByDevice(options, family) {
  const caps = deviceCaps.value;
  if (!caps) return options;
  const reaches = family === "sdm" ? dsdReachable : pcmReachable;
  return (options || []).map((o) => (reaches(caps, o.value) ? o : { ...o, disabled: true, reason: UNAVAILABLE }));
}

// Whether SDM is reachable at all, and why not when it isn't. Selecting a mode
// the device cannot do is symptom 2 of this feature: the daemon accepted it and
// silently played PCM, with nothing anywhere saying why.
function sdmReason() {
  const caps = deviceCaps.value;
  if (!caps) return "";
  const reachable = DSD_RATES.some((o) => dsdReachable(caps, o.value));
  if (reachable) return "";
  return dopOn()
    ? "This device cannot carry any DSD rate."
    : "This device has no DSD path — turn on DSD over PCM (DoP) to reach one.";
}

// --- falling back off an unreachable selection -------------------------------
// Graying an option the user cannot pick is only half the job: the setting may
// already BE on one, carried in from a preset, from a previous device, or from
// unticking DoP on a device whose only DSD path was DoP. Left alone it shows a
// rate the hardware refuses and applies it on the next Apply.
//
// So the store corrects it — as an ordinary STAGED edit, visible in the pending
// bar, marked dirty on its control, discardable — never as a silent display
// substitution. architecture.md §5: the editor shows what WOULD apply, and a
// control disagreeing with the config it writes is the two-views-disagree
// failure this store keeps refusing. That the correction costs a daemon restart
// at Apply is not a reason to withhold it (CLAUDE.md, "user actions always
// proceed"): the restart is the user's to spend, at the moment they click.

/** @type {Record<string, string>} */
const RATE_KEY = { pcm: "pcm_rate", sdm: "sdm_rate" };
/** @type {Record<string, (caps: DeviceCaps, tier: string | number | undefined) => boolean>} */
const REACHES = { pcm: pcmReachable, sdm: dsdReachable };
// One correction per key per value, so a stage the backend refuses cannot spin
// the effect into re-POSTing it forever.
const corrected = new Map();

/**
 * @param {string} key
 * @param {string | number} value
 * @returns {void}
 */
function correct(key, value) {
  if (corrected.get(key) === value) return;
  corrected.set(key, value);
  edit(key, value);
}

// The highest tier the device can carry, '' when it can carry none. The menus
// run low to high, so the last survivor is the highest.
/**
 * @param {DeviceCaps} caps
 * @param {string} family
 * @returns {string | number}
 */
function highestReachable(caps, family) {
  const options = schema[RATE_KEY[family]].options || [];
  const reachable = options.filter((o) => REACHES[family](caps, o.value));
  const highest = reachable[reachable.length - 1];
  return highest ? highest.value : "";
}

/**
 * @param {DeviceCaps} caps
 * @param {string} family
 * @returns {void}
 */
function correctRate(caps, family) {
  const key = RATE_KEY[family];
  const current = String(effective(key) || "");
  if (!current || REACHES[family](caps, current)) return;
  const top = highestReachable(caps, family);
  if (top && top !== current) correct(key, top);
}

// SDM selected on a device that cannot reach any DSD rate falls back to PCM —
// the case the user meets by unticking DoP, where the mode that was reachable a
// moment ago no longer is.
function correctMode() {
  if (String(effective("output_mode")) !== "sdm" || !sdmReason()) return;
  correct("output_mode", "pcm");
}

effect(() => {
  const caps = deviceCaps.value;
  if (!caps) return;
  correctRate(caps, "pcm");
  correctRate(caps, "sdm");
  correctMode();
});

// --- asking about one saved value ---------------------------------------------
// The menus above narrow a list they are handed. A saved live preset is not a
// list: it carries one rate and one output mode, decided when it was saved, and
// the picker needs to know whether the device can play them. Same two questions,
// asked one value at a time — and the same answer to an unknown announcement,
// which is yes.

/**
 * Whether the selected output device can carry `rate` (Hz) on `family`'s chain.
 * @param {string | number | undefined} rate
 * @param {string} family "pcm" | "sdm"
 * @returns {boolean}
 */
export function rateReachableByDevice(rate, family) {
  const caps = deviceCaps.value;
  const reaches = REACHES[family];
  if (!caps || !reaches) return true;
  return reaches(caps, rate);
}

/**
 * Whether the selected output device can reach any DSD rate at all, natively or over DoP.
 * @returns {boolean}
 */
export function sdmReachableByDevice() {
  return !sdmReason();
}

// Gray the SDM button on a mode segment when the device cannot do DSD. Auto is
// left alone: in auto the engine picks the family per track and will settle on
// PCM by itself, so there is nothing unreachable to warn about.
/**
 * Disable the SDM option when the selected device can reach no DSD rate, with the
 * reason on it. Auto and PCM are left alone.
 * @template {DeviceOption} T
 * @param {T[]} options
 * @returns {(T | (T & { disabled: boolean, reason: string }))[]}
 */
export function grayModesByDevice(options) {
  const reason = sdmReason();
  if (!reason) return options;
  return (options || []).map((o) => (o.value === "sdm" ? { ...o, disabled: true, reason } : o));
}
