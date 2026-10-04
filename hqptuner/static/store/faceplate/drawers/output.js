// The Output drawer's store half: the rate dial's tiers with each band's needle, the hatch on a tier the device cannot
// carry and the lamp on the tier playing now; a pick on a band; the layout a channel count reads as and a pick on the
// layout segment; the device picker's rows over a backend's device list, a pick from it, and the device rescan. The DOM
// half is components/faceplate/drawers/output/RateDial.js and DevicePicker.js.
//
// The dial carries two settings on one glass: the PCM limit `pcm_rate` over 1x to 32x and the SDM limit `sdm_rate` over
// 64x to 2048x, each tier an octave and its menu value the tier's 48k member. Both bands stay settable in either output
// mode, so the dial reads no gray reason. Manual on the layout segment stages nothing: it holds until a layout is
// picked, so the channel count can be set by hand at a count a layout also names.

import { signal } from "@preact/signals";
import { engineStatus } from "../../signals.js";
import { effective, isDirty } from "../../resolve.js";
import { edit } from "../../actions.js";
import { refreshDevices } from "../../sync.js";
import { DSD_RATES, PCM_RATES, TIER, TWIN_44K } from "../../schema/options.js";
import { grayRatesByDevice } from "../../narrow/devicecaps.js";
import { bandSpan, deviceParts, groupDevices, moveNeedle } from "../../../model/gauges/output.js";
import { rowOptions, rowValue } from "../drawer.js";

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

/**
 * What the dial draws: its tiers in rate order, each band's needle by tier position (null when the limit names no
 * tier), the playing lamp's tier (null with no running rate on a tier), and which bands hold a staged limit.
 *
 * @typedef {object} DialView
 * @property {DialTier[]} tiers
 * @property {{ pcm: number | null, sdm: number | null }} limits
 * @property {number | null} playing
 * @property {{ pcm: boolean, sdm: boolean }} dirty
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
 * The dial's tiers with each band's needle, the hatch, the playing lamp and the dirty bands.
 *
 * @returns {DialView}
 */
export function dialView() {
  const tiers = [...familyTiers(PCM_RATES, "pcm"), ...familyTiers(DSD_RATES, "sdm")];
  const status = (engineStatus.value || {}).status || {};
  return {
    tiers,
    limits: { pcm: tierOf(tiers, effective(RATE_KEYS.pcm)), sdm: tierOf(tiers, effective(RATE_KEYS.sdm)) },
    playing: tierOf(tiers, status.active_rate),
    dirty: { pcm: isDirty(RATE_KEYS.pcm), sdm: isDirty(RATE_KEYS.sdm) },
  };
}

/**
 * Send a band's needle to tier `index`: clamped into the band, its rate staged unless the needle already sits there.
 *
 * @param {"pcm" | "sdm"} band
 * @param {number} index
 * @returns {Promise<void>}
 */
export async function pickTier(band, index) {
  const view = dialView();
  const span = bandSpan(view.tiers, band);
  const cur = view.limits[band] ?? -1;
  const { i, moved } = moveNeedle(span, cur, index);
  if (moved) await edit(RATE_KEYS[band], view.tiers[i].value);
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
