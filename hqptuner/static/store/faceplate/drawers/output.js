// The Output drawer's store half: the rate dial's tiers with each band's needle, the hatch on a tier the device cannot
// carry and the lamp on the tier playing now; a pick on a band; the layout a channel count reads as and a pick on the
// layout segment; the device picker's rows over a backend's device list, a pick from it, and the device rescan. The DOM
// half is components/faceplate/drawers/output/RateDial.js and DevicePicker.js.
//
// The dial carries two settings on one glass: the PCM limit `pcm_rate` over 1x to 32x and the SDM limit `sdm_rate` over
// 64x to 2048x, each tier an octave and its menu value the tier's 48k member. Both bands stay settable in either output
// mode, so the dial reads no gray reason. Manual on the layout segment stages nothing: it holds until a layout is
// picked, so the channel count can be set by hand at a count a layout also names.
//
// While Allow pinned rates is on, the dial carries a pin picker: Auto, or a family. Under a family a tap on a tier of
// the running band pins that tier's member of the family, live, and stages nothing, and a key on that band steps the
// pin from the pinned tier, else the playing tier; a tap or key on the other band moves its limit, since the engine's
// rate list is the running mode's. A family pick writes nothing and holds for the drawer's opening; each opening reads
// the pin's family, Auto with no pin. The pin is read off the engine (store/live/pin.js).

import { effect, signal } from "@preact/signals";
import { engineStatus } from "../../signals.js";
import { effective, isDirty } from "../../resolve.js";
import { edit } from "../../actions.js";
import { refreshDevices } from "../../sync.js";
import { DSD_RATES, PCM_RATES, TIER, TWIN_44K } from "../../schema/options.js";
import { grayRatesByDevice } from "../../narrow/devicecaps.js";
import { allowPinnedRates } from "../../ui/faceplate.js";
import { listedRates, pinAuto, pinnedRate, pinRate } from "../../live/pin.js";
import { bandSpan, deviceParts, groupDevices, moveNeedle } from "../../../model/gauges/output.js";
import { rowOptions, rowValue } from "../drawer.js";
import { openStage } from "../view.js";
import { runningChain } from "../path.js";

/**
 * One tier of the dial: its family, its menu value, its multiple of the base rate, both members' frequencies in the
 * band's unit, and whether the device announced it cannot carry it.
 *
 * @typedef {object} DialTier
 * @property {"pcm" | "sdm"} family
 * @property {string} value
 * @property {string} name
 * @property {string} f44
 * @property {string} f48
 * @property {string} unit
 * @property {boolean} unavailable
 */

/** @typedef {import("../../../model/gauges/output.js").TierSpan} TierSpan */
/** @typedef {"f44" | "f48"} Fam */
/** @typedef {"auto" | Fam} PinPick */

/**
 * What the dial draws: its tiers in rate order, each band's needle by tier position (null when the limit names no
 * tier), the playing lamp's tier (null with no running rate on a tier), which bands hold a staged limit, the pin
 * picker's pick (null while pinned rates are not allowed, so no picker), and where the pin sits (null with none shown).
 *
 * @typedef {object} DialView
 * @property {DialTier[]} tiers
 * @property {{ pcm: number | null, sdm: number | null }} limits
 * @property {number | null} playing
 * @property {{ pcm: boolean, sdm: boolean }} dirty
 * @property {PinPick | null} picker
 * @property {{ tier: number, fam: Fam } | null} pin
 */

/** @typedef {{ value: string, main: string, detail: string, cur: boolean }} DeviceRowView */

/**
 * What a device picker draws: the trigger's two lines and the list under its group headers, the effective device
 * current.
 *
 * @typedef {object} DeviceView
 * @property {"network" | "alsa"} kind
 * @property {string} main
 * @property {string} sub
 * @property {{ group: string, rows: DeviceRowView[] }[]} groups
 */

/** Each band's catalog key. */
const RATE_KEYS = { pcm: "pcm_rate", sdm: "sdm_rate" };

/** The layouts the segment names, by channel count. */
const LAYOUT_COUNTS = ["2", "6", "8"];

/** The layout segment's own value for a count no layout names. */
const MANUAL = "manual";

/** The 48k base every tier is a multiple of. */
const BASE = 48000;

/** Below this a tier prints in kHz, at and above it in MHz. */
const MHZ = 1e6;

/**
 * A member's frequency in its band's unit: kHz trimmed of trailing zeros, MHz to two places.
 *
 * @param {number} hz
 */
const freq = (hz) => (hz >= MHZ ? (hz / MHZ).toFixed(2) : String(Number((hz / 1000).toFixed(1))));

/**
 * One family's menu as dial tiers, hatched where the device cannot carry them.
 *
 * @param {{ value: string }[]} menu
 * @param {"pcm" | "sdm"} family
 * @returns {DialTier[]}
 */
function familyTiers(menu, family) {
  return grayRatesByDevice(menu, family).map((o) => {
    const f48 = Number(o.value);
    return {
      family,
      value: o.value,
      name: `${f48 / BASE}x`,
      f44: freq(Number(TWIN_44K[o.value])),
      f48: freq(f48),
      unit: f48 >= MHZ ? "MHz" : "kHz",
      unavailable: "disabled" in o && o.disabled,
    };
  });
}

/**
 * The position of the tier a rate belongs to, by either member; null when it belongs to none.
 *
 * @param {DialTier[]} tiers
 * @param {unknown} rate
 */
function tierOf(tiers, rate) {
  const base = TIER[String(Number(rate))];
  const i = base ? tiers.findIndex((t) => t.value === base) : -1;
  return i < 0 ? null : i;
}

/**
 * The exact rate in Hz of one member of a tier.
 *
 * @param {DialTier} tier
 * @param {Fam} fam
 */
const memberHz = (tier, fam) => Number(fam === "f48" ? tier.value : TWIN_44K[tier.value]);

/**
 * Where a rate sits on the dial: its tier's position and its family; null for a rate on no tier.
 *
 * @param {DialTier[]} tiers
 * @param {number} hz
 * @returns {{ tier: number, fam: Fam } | null}
 */
function placeOf(tiers, hz) {
  const tier = tierOf(tiers, hz);
  return tier === null ? null : { tier, fam: tiers[tier].value === String(Number(hz)) ? "f48" : "f44" };
}

/** The family picked on the picker during this opening of the drawer; null when none is, so the pin's family reads. */
const famPick = signal(/** @type {PinPick | null} */ (null));

// Each opening and closing of a drawer drops the pick, so the next opening reads the pin.
effect(() => {
  void openStage.value;
  famPick.value = null;
});

/**
 * The picker's pick: the family picked during this opening, else the pin's family, else Auto; null while pinned
 * rates are not allowed.
 *
 * @param {DialTier[]} tiers
 * @returns {PinPick | null}
 */
function pinPick(tiers) {
  if (!allowPinnedRates.value) return null;
  const at = placeOf(tiers, pinnedRate.value);
  return famPick.value ?? (at ? at.fam : "auto");
}

/**
 * The dial's tiers with each band's needle, the hatch, the playing lamp, the dirty bands, the pin picker's pick and
 * the pin.
 *
 * @returns {DialView}
 */
export function dialView() {
  const tiers = [...familyTiers(PCM_RATES, "pcm"), ...familyTiers(DSD_RATES, "sdm")];
  const status = (engineStatus.value || {}).status || {};
  const picker = pinPick(tiers);
  return {
    tiers,
    limits: { pcm: tierOf(tiers, effective(RATE_KEYS.pcm)), sdm: tierOf(tiers, effective(RATE_KEYS.sdm)) },
    playing: tierOf(tiers, status.active_rate),
    dirty: { pcm: isDirty(RATE_KEYS.pcm), sdm: isDirty(RATE_KEYS.sdm) },
    picker,
    pin: picker === null ? null : placeOf(tiers, pinnedRate.value),
  };
}

/**
 * A pick on the pin picker: a family holds for this opening and writes nothing, Auto clears a standing pin.
 *
 * @param {PinPick} pick
 * @returns {Promise<void>}
 */
export async function pickPin(pick) {
  famPick.value = pick;
  if (pick === "auto") await pinAuto();
}

/**
 * The family a tap on `band` pins in: the picked family while the band is the one running, else null, so the tap
 * moves the band's limit.
 *
 * @param {DialView} view
 * @param {"pcm" | "sdm"} band
 * @returns {Fam | null}
 */
const pinsIn = (view, band) => (view.picker && view.picker !== "auto" && band === runningChain() ? view.picker : null);

/**
 * Pin the member of family `fam` on tier `index`: only on a tier the device carries, a rate the engine's list holds,
 * and not the rate already pinned.
 *
 * @param {DialView} view
 * @param {number} index
 * @param {Fam} fam
 * @returns {Promise<void>}
 */
async function pinTierRate(view, index, fam) {
  const tier = view.tiers[index];
  if (!tier || tier.unavailable) return;
  const hz = memberHz(tier, fam);
  if (!listedRates().has(hz) || pinnedRate.value === hz) return;
  await pinRate(hz);
}

/**
 * A tap on tier `index` of a band: under a picked family on the running band, a pin on that tier's member of the
 * family; otherwise the band's needle sent there, clamped into the band, its rate staged unless the needle already
 * sits there.
 *
 * @param {"pcm" | "sdm"} band
 * @param {number} index
 * @returns {Promise<void>}
 */
export async function pickTier(band, index) {
  const view = dialView();
  const span = bandSpan(view.tiers, band);
  const fam = pinsIn(view, band);
  if (fam) {
    if (index >= span.lo && index <= span.hi) await pinTierRate(view, index, fam);
    return;
  }
  const cur = view.limits[band] ?? -1;
  const { i, moved } = moveNeedle(span, cur, index);
  if (moved) await edit(RATE_KEYS[band], view.tiers[i].value);
}

/**
 * A drag across tier `index` of a band: the needle follows as a tap sends it, but a band that pins takes its pin from
 * the press alone, so a drag writes no pin per tier crossed.
 *
 * @param {"pcm" | "sdm"} band
 * @param {number} index
 * @returns {Promise<void>}
 */
export async function dragTier(band, index) {
  if (!pinsIn(dialView(), band)) await pickTier(band, index);
}

/**
 * The tier a key on `band` steps from: on a band that pins, the pinned tier, else the playing tier, when it sits in
 * the band; otherwise the band's needle, else the band's first tier.
 *
 * @param {DialView} view
 * @param {"pcm" | "sdm"} band
 * @param {TierSpan} span
 * @returns {number}
 */
function keyOrigin(view, band, span) {
  const inBand = (/** @type {number | null | undefined} */ i) => (i != null && i >= span.lo && i <= span.hi ? i : null);
  const pinned = pinsIn(view, band) ? (inBand(view.pin?.tier) ?? inBand(view.playing)) : null;
  return pinned ?? view.limits[band] ?? span.lo;
}

/**
 * A key on a band: `to` sends the key's origin, within the band's span, to a tier, taken as a tap there.
 *
 * @param {"pcm" | "sdm"} band
 * @param {(from: number, span: TierSpan) => number} to
 * @returns {Promise<void>}
 */
export async function keyTier(band, to) {
  const view = dialView();
  const span = bandSpan(view.tiers, band);
  await pickTier(band, to(keyOrigin(view, band, span), span));
}

/** Manual picked on the layout segment, held until a layout is picked. */
const manualHeld = signal(false);

/**
 * The layout the channel count reads as: the count a layout names, else Manual; Manual while it is held.
 *
 * @returns {string}
 */
export function channelLayout() {
  const count = rowValue("channels");
  return !manualHeld.value && LAYOUT_COUNTS.includes(count) ? count : MANUAL;
}

/**
 * A pick on the layout segment: a layout stages its channel count, Manual holds without staging. Anything else is
 * turned away.
 *
 * @param {string} v
 * @returns {Promise<void>}
 */
export async function pickChannelLayout(v) {
  if (v === MANUAL) {
    manualHeld.value = true;
    return;
  }
  if (!LAYOUT_COUNTS.includes(v)) return;
  manualHeld.value = false;
  if (rowValue("channels") !== v) await edit("channels", v);
}

/**
 * The device kind a picker's key lists.
 *
 * @param {string} key
 * @returns {"network" | "alsa"}
 */
const kindOf = (key) => (key === "net_device" ? "network" : "alsa");

/**
 * A device picker's trigger and rows over the backend's device list, the effective device current. A device the list
 * does not carry is named on the trigger by its value.
 *
 * @param {string} key  net_device | alsa_device
 * @returns {DeviceView}
 */
export function deviceView(key) {
  const kind = kindOf(key);
  const options = rowOptions(key);
  const value = rowValue(key);
  const labels = options.map((o) => String(o.label));
  const groups = groupDevices(kind, labels).map(({ group, rows }) => ({
    group,
    rows: rows.map((r) => {
      const v = String(options[r.i].value);
      return { value: v, main: r.main, detail: r.detail, cur: v === value };
    }),
  }));
  const hit = options.find((o) => String(o.value) === value);
  if (!hit) return { kind, main: value, sub: "", groups };
  const p = deviceParts(kind, String(hit.label));
  const sub = kind === "network" && p.detail ? `${p.group} · ${p.detail}` : p.group;
  return { kind, main: p.main, sub, groups };
}

/**
 * Stage a picked device, unless it is the effective one.
 *
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function pickDevice(key, value) {
  if (rowValue(key) !== value) await edit(key, value);
}

/** A device rescan in flight. */
export const rescanning = signal(false);

/**
 * Ask the daemon to rescan its output devices and re-pull the device lists; its warning, if any, reports through the
 * apply line (store/sync.js).
 *
 * @returns {Promise<void>}
 */
export async function rescanDevices() {
  rescanning.value = true;
  try {
    await refreshDevices();
  } finally {
    rescanning.value = false;
  }
}
