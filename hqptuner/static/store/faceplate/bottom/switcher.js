// The Setting Switcher, the faceplate's bottom bar: one target setting at a time, two remembered choices for it, each
// sent live with a tap or replaced from the target's own list.

import { signal } from "@preact/signals";
import { enumPref, warnStorage } from "../../ui/prefs.js";
import { bottomBar } from "../../ui/faceplate.js";
import { runningValue } from "../../resolve.js";
import { writeLive } from "../../live/write.js";
import { matrixActiveProfile } from "../../matrix/profiles.js";
import { runningChain } from "../path.js";
import { openOptionList } from "../view.js";
import { pickOption } from "../page/conversion.js";
import { profileChoices, switchProfile } from "../page/profile.js";
import { listOptions, rawOptions } from "../lists/options.js";

/**
 * One slot of the bar: the name it sends, the label it shows, the name it is also known by, whether it is the one
 * running, and whether nothing is remembered for it.
 *
 * @typedef {{ name: string, label: string, aka: string, on: boolean, empty: boolean }} Slot
 */

/**
 * What the bar shows: the target, its layout, the catalog key a list target reads, and its two slots.
 *
 * @typedef {{ target: string, layout: "slots" | "mode" | "volume", key: string | null, slots: Slot[] }} SwitcherView
 */

/** The settings the switcher can switch. @type {string[]} */
export const TARGETS = ["1x filter", "Nx filter", "Modulator", "Matrix profile", "Output mode", "Volume"];

const K_TARGET = "hqptuner.switcherTarget";
const K_SLOTS = "hqptuner.switcherSlots";

/** Each list target's catalog key on each chain. @type {Record<string, Record<"pcm" | "sdm", string>>} */
const LIST_KEYS = {
  "1x filter": { pcm: "pcm_filter_1x", sdm: "sdm_filter_1x" },
  "Nx filter": { pcm: "pcm_filter_nx", sdm: "sdm_filter_nx" },
  Modulator: { pcm: "pcm_dither", sdm: "sdm_modulator" },
};

/** The targets that lay out a bar of their own. @type {Record<string, "mode" | "volume">} */
const LAYOUTS = { "Output mode": "mode", Volume: "volume" };

/** The two fixed Output mode slots: the mode each writes, its label and its aka. */
const MODES = [
  { wire: "pcm", label: "Pulse Code Modulation (PCM)", aka: "" },
  { wire: "sdm", label: "Sigma Delta Modulation (SDM)", aka: "aka DIRECT STREAM DIGITAL (DSD)" },
];

const [target, storeTarget] = enumPref(K_TARGET, TARGETS, "Modulator");

/** The target the switcher switches, persisted under `hqptuner.switcherTarget`. @type {{ value: string }} */
export const switcherTarget = target;

/**
 * The stored slot memory, target by target; unset, junk and an unreadable storage read as nothing remembered.
 *
 * @returns {Record<string, unknown>}
 */
function loadSlots() {
  let raw = null;
  try {
    raw = localStorage.getItem(K_SLOTS);
  } catch {
    warnStorage("read");
    return {};
  }
  try {
    const parsed = raw == null ? null : JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The names remembered per target. */
const slots = signal(loadSlots());

/**
 * The two names remembered for a target, "" where nothing is.
 *
 * @param {string} t
 * @returns {string[]}
 */
function remembered(t) {
  const pair = slots.value[t];
  const at = (/** @type {number} */ i) => (Array.isArray(pair) && typeof pair[i] === "string" ? pair[i] : "");
  return [at(0), at(1)];
}

/**
 * Remember a name in one slot of a target and persist the slot memory.
 *
 * @param {string} t
 * @param {number} i
 * @param {string} name
 */
function remember(t, i, name) {
  if (i !== 0 && i !== 1) return;
  const pair = remembered(t);
  pair[i] = name;
  slots.value = { ...slots.value, [t]: pair };
  try {
    localStorage.setItem(K_SLOTS, JSON.stringify(slots.value));
  } catch {
    // storage disabled (private mode) — keep the in-memory value
    warnStorage("written");
  }
}

/**
 * Switch the bar to a target and persist it.
 *
 * @param {string} t
 */
export function setSwitcherTarget(t) {
  storeTarget(t);
}

/**
 * The engine name of the option whose enum ID a key runs, "" where none matches.
 *
 * @param {string} key
 * @returns {string}
 */
function runningName(key) {
  const id = String(runningValue(key) ?? "");
  return rawOptions(key).find((o) => String(o.value) === id)?.label ?? "";
}

/**
 * A list target's slots: each remembered name labeled by its list's leaf, the running name in the first while both
 * are empty.
 *
 * @param {string} key
 * @param {string[]} names
 * @returns {Slot[]}
 */
function listSlots(key, names) {
  const run = runningName(key);
  const shown = names[0] || names[1] ? names : [run, ""];
  const leaves = new Map(listOptions(key).map((o) => [o.v, o.leaf]));
  return shown.map((name, i) => ({
    name,
    label: leaves.get(name) ?? name,
    aka: "",
    on: name !== "" && name === run,
    empty: names[i] === "",
  }));
}

/**
 * Matrix profile's slots: each remembered profile, on while it runs.
 *
 * @param {string[]} names
 * @returns {Slot[]}
 */
function profileSlots(names) {
  const active = matrixActiveProfile.value;
  return names.map((name) => ({ name, label: name, aka: "", on: name !== "" && name === active, empty: name === "" }));
}

/**
 * Output mode's two fixed slots, the running chain's on.
 *
 * @returns {Slot[]}
 */
function modeSlots() {
  const run = runningChain();
  return MODES.map((m) => ({ name: "", label: m.label, aka: m.aka, on: run === m.wire, empty: false }));
}

/**
 * A target's slots.
 *
 * @param {string} t
 * @param {string | null} key
 * @returns {Slot[]}
 */
function slotsOf(t, key) {
  if (key) return listSlots(key, remembered(t));
  if (t === "Matrix profile") return profileSlots(remembered(t));
  if (t === "Output mode") return modeSlots();
  return [];
}

/**
 * The bar for the current target.
 *
 * @returns {SwitcherView}
 */
function view() {
  const t = switcherTarget.value;
  const keys = LIST_KEYS[t];
  const key = keys ? keys[runningChain()] : null;
  return { target: t, layout: LAYOUTS[t] ?? "slots", key, slots: slotsOf(t, key) };
}

/**
 * The bar for the current target.
 *
 * @returns {SwitcherView | null}
 */
export function switcherView() {
  return view();
}

/**
 * Remember a name for one slot of the current target, persisted under `hqptuner.switcherSlots`.
 *
 * @param {number} i
 * @param {string} name
 */
export function setSlot(i, name) {
  remember(switcherTarget.value, i, name);
}

/**
 * A slot's tap: its name sent live to the target. An empty slot sends nothing.
 *
 * @param {number} i
 * @returns {Promise<void> | null}
 */
export function slotLive(i) {
  const v = view();
  const s = v.slots[i];
  if (!s) return null;
  if (v.layout === "mode") return writeLive("mode", MODES[i].wire);
  if (s.empty) return null;
  return v.key ? pickOption(v.key, s.name) : switchProfile(s.name);
}

/**
 * A slot's list: a list target opens its option list over the body, a pick remembered in the slot, and returns null;
 * Matrix profile returns the profile choices; any other target opens nothing and returns null.
 *
 * @param {number} i
 * @returns {{ value: string, label: string, disabled: boolean, reason: string }[] | null}
 */
export function slotList(i) {
  const v = view();
  const t = v.target;
  if (v.key) {
    openOptionList({
      key: v.key,
      stage: t === "Nx filter" ? "nx" : "1x",
      value: v.slots[i]?.name ?? "",
      pick: (name) => remember(t, i, name),
    });
    return null;
  }
  return t === "Matrix profile" ? profileChoices().options : null;
}

/**
 * The plate's bottom: the bar preference, and `"volume"` while the switcher's target is Volume, else `""`.
 *
 * @returns {{ bottom: string, sw: string } | null}
 */
export function plateBottom() {
  return { bottom: bottomBar.value, sw: switcherTarget.value === "Volume" ? "volume" : "" };
}
