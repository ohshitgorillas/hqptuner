// Shared harness for the store/narrow/devicecaps.js suites — devicecaps.test.js
// (graying the rate menus and the mode segment against the selected device's
// announced capability) and devicecaps-fallback.test.js (correcting a setting
// that already sits on something the device cannot reach).
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// The daemon does not report device capability; HQPTuner learns it from the log
// and serves it on /api/config as `device_caps`:
//
//   { device: "naa-office/hw:CARD=…,DEV=0", pcm_rates: [...], dsd_rates: [...] }
//
// `null` when nothing is known. Rates on the wire are INTEGERS while option
// values are STRINGS, so the fixtures leave them in their real types and every
// menu lookup here compares STRICTLY — a helper that coerced with String()
// would read the same whether the menu carried "192000" or 192000, and so
// would pin nothing about the join.
//
// State is driven through the store's exported source signals plus a faked wire
// for the staging round-trip (docs/testing.md rule 4 — no store function is
// ever stubbed). `reset()` reassigns the whole /api/config payload on every
// call rather than only the part a case cares about: module-level signals
// persist for the life of the process, so a partial reset makes tests pass
// alone and fail in sequence. `staged` is not exported, so it is cleared via
// discardAll().

import { config } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { stagingWire } from "./wire.js";

// --- the menus ---------------------------------------------------------------

/**
 * A menu entry as these helpers read it: the value naming the tier, plus the
 * two marks a graying pass adds — absent on a menu no pass has touched.
 *
 * @typedef {{ value: string | number, label?: string, disabled?: boolean, reason?: string }} MenuOption
 */

// Both entries carry an option list in the catalog; `options` is optional on a
// schema entry in general, which is what the assertions state past.
export const PCM_OPTIONS = /** @type {MenuOption[]} */ (schema.pcm_rate.options);
export const MODE_OPTIONS = /** @type {MenuOption[]} */ (schema.output_mode.options);

// Tier menu members, 48k side — the numbers the options carry, as strings.
// Every tier has a 44.1k member and a 48k member and the option's value carries
// the 48k one, so 192000 is the 4x tier and also means 176400, and a device
// that announced EITHER member can play the tier.
export const PCM_2X = "96000";
export const PCM_4X = "192000";
export const PCM_8X = "384000";
export const PCM_16X = "768000";
export const PCM_32X = "1536000";
export const DSD64 = "3072000";
export const DSD128 = "6144000";
export const DSD256 = "12288000";
export const DSD512 = "24576000";

// The tiers each menu is required to offer, named here rather than counted off
// the menu itself: an expectation built from the array under test degenerates
// to a tautology the moment that array changes or empties.
export const PCM_TIERS = ["48000", PCM_2X, PCM_4X, PCM_8X, PCM_16X, PCM_32X];
export const DSD_TIERS = [DSD64, DSD128, DSD256, DSD512, "49152000", "98304000"];

// --- the devices --------------------------------------------------------------

// A net_device is an `endpoint/device` pair as one string; an alsa_device is a
// bare ALSA name. The capability's `device` carries the same joined form the
// corresponding config field does, so the two are deliberately unalike here: a
// store matching against the wrong field finds no match and grays nothing.
export const NET_DEVICE = "naa-office/hw:CARD=sndrpihifiberry,DEV=0";
export const OTHER_NET_DEVICE = "S26/hw:CARD=Output,DEV=0";
export const ALSA_DEVICE = "hw:CARD=NVidia,DEV=3";

// What the log-derived capability looks like on the wire: integers, both
// families, the device it was observed on.
/**
 * @param {string} device
 * @param {number[]} pcmRates
 * @param {number[]} dsdRates
 */
export const caps = (device, pcmRates, dsdRates) => ({
  device,
  pcm_rates: pcmRates,
  dsd_rates: dsdRates,
});

// A device topping out at 192 kHz. 88200/176400 are announced but 96000 is too,
// so the 2x tier is answered by its own 48k member and only the 4x tier rests
// on its 44.1k twin.
export const PCM_TO_192 = [44100, 48000, 88200, 96000, 176400, 192000];

// The same device announcing 176400 but NOT 192000: the 4x tier is then
// reachable only through the 44.1k member the option's value does not carry.
export const PCM_TO_176 = [44100, 48000, 88200, 96000, 176400];

// --- the fixture --------------------------------------------------------------

// A yield long enough for the fall-back effect to run and for the staged edit
// it makes to complete its round trip over the wire. Not a wall-clock wait:
// zero-delay turns of the loop, so the suites pin what the effect concludes,
// never how long it takes.
/** @returns {Promise<void>} */
export const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

// The whole /api/config payload, plus an empty staged buffer. The returned
// staging wire holds the pending buffer the way the backend does, so `edit()`
// and the store's own corrective edit both ride the real REST path and both
// read back through `w.staged`.
//
// Every field the graying reads is present in every fixture, so a case never
// passes because the field it should have consulted was simply absent. Checkbox
// fields carry the daemon's own shape — real booleans — except where a case
// names the staged "1"/"0" strings. The three CONTROL values are seeded only
// when a case names one, and are mirrored into `file` as well as `fields`: the
// running-config layer is the truth for controls whose edits go out live, and
// liverate.test.js seeds the rate pair the same way.
//
// The buffer is cleared BEFORE the fixture payload lands, never after: the
// fall-back correction is an effect on the capability and the current values,
// so a discard afterwards would wipe the very thing those cases measure.
/**
 * The DoP switches take a string as well as a boolean: the daemon's form serves
 * a boolean, but a staged edit of one arrives as `"1"` or `"0"`, and the store
 * reads both shapes back.
 *
 * @param {{
 *   backend?: string,
 *   netDevice?: string,
 *   alsaDevice?: string,
 *   netDop?: boolean | string,
 *   alsaDop?: boolean | string,
 *   deviceCaps?: ReturnType<typeof caps> | null,
 *   pcmRate?: string,
 *   sdmRate?: string,
 *   mode?: string,
 * }} [fixture]
 * @returns {Promise<import("./wire.js").StagingWire>}
 */
export async function reset({
  backend = "network",
  netDevice = NET_DEVICE,
  alsaDevice = ALSA_DEVICE,
  netDop = false,
  alsaDop = false,
  deviceCaps = null,
  pcmRate,
  sdmRate,
  mode,
} = {}) {
  const w = stagingWire();
  config.value = { fields: [], file: {}, active: "", profiles: null, device_caps: null };
  await discardAll();

  const fields = [
    { name: "backend", value: backend },
    { name: "net_device", value: netDevice },
    { name: "alsa_device", value: alsaDevice },
    { name: "net_dop", value: netDop },
    { name: "alsa_dop", value: alsaDop },
  ];
  /** @type {Record<string, string>} */
  const file = {};
  const control = (/** @type {string} */ name, /** @type {string | undefined} */ value) => {
    if (value === undefined) return;
    fields.push({ name, value });
    file[name] = value;
  };
  control("defaults_samplerate", pcmRate);
  control("defaults_bitrate", sdmRate);
  control("mode", mode);

  config.value = { fields, file, active: "", profiles: null, device_caps: deviceCaps };
  await tick();
  return w;
}

// --- reading the narrowed menus -----------------------------------------------

// An entry by the tier it names, matched strictly against the string the menu
// is required to carry. A miss throws rather than quietly measuring nothing: an
// option list that has LOST an entry — or drifted to numeric values — must fail
// loudly, since dropping what the device cannot reach is exactly the behavior
// house policy forbids.
/**
 * @param {MenuOption[]} options
 * @param {string} value
 * @returns {MenuOption}
 */
export function optionFor(options, value) {
  const hit = options.find((o) => o.value === value);
  if (!hit) throw new Error(`the menu offers no ${value} entry`);
  return hit;
}

// The two marks an entry can carry, read as a pair: whether it can be picked
// and what it says about itself. An entry disabled without a reason leaves the
// user guessing; a reason on a selectable entry grays nothing.
/**
 * @param {MenuOption} o
 * @returns {[boolean, boolean]}
 */
export const marks = (o) => [o.disabled === true, typeof o.reason === "string" && o.reason.length > 0];
export const GRAYED = [true, true];
export const UNTOUCHED = [false, false];

/**
 * @param {MenuOption[]} options
 * @returns {number}
 */
export const markedCount = (options) => options.filter((o) => o.disabled || o.reason).length;

// The named tiers that came back grayed / untouched, in the order named. Read
// against the full tier list, a short or reordered answer names which tier went
// the wrong way.
/**
 * @param {MenuOption[]} options
 * @param {string[]} tiers
 * @returns {string[]}
 */
export const grayedAmong = (options, tiers) => tiers.filter((v) => optionFor(options, v).disabled === true);

/**
 * @param {MenuOption[]} options
 * @param {string[]} tiers
 * @returns {string[]}
 */
export const untouchedAmong = (options, tiers) =>
  tiers.filter((v) => !optionFor(options, v).disabled && !optionFor(options, v).reason);
