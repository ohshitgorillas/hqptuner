// The Setting Switcher, the faceplate's bottom bar: one target setting at a time, two remembered choices for it, each
// sent live with a tap unless it already runs and no write to it is still settling, or replaced from the target's own
// list.

import { signal } from "@preact/signals";
import { schema } from "../../schema.js";
import { enumPref, warnStorage } from "../../ui/prefs.js";
import { bottomBar } from "../../ui/faceplate.js";
import { chainControlOf } from "../../live/chains.js";
import { liveUnsettled } from "../../live/state.js";
import { writeLive } from "../../live/write.js";
import { matrixActiveProfile } from "../../matrix/profiles.js";
import { runningChain } from "../path.js";
import { openOptionList } from "../view.js";
import { fieldRunsNow, pickOption, plainOf } from "../page/conversion.js";
import { profileChoices, profileUnsettled, switchProfile } from "../page/profile.js";

/**
 * One slot of the bar: the name it sends, what it shows (a list target's plain family, variant and leaf, any other
 * target's label), the name it is also known by, whether it is the one running, whether it is lit (running, and on
 * this track's path), and whether nothing is remembered for it.
 *
 * @typedef {object} Slot
 * @property {string} name
 * @property {string} [label]
 * @property {string} [fam]
 * @property {string | null} [variant]
 * @property {string} [leaf]
 * @property {string} [tier]
 * @property {string} aka
 * @property {boolean} on
 * @property {boolean} lit
 * @property {boolean} empty
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

/**
 * Each list target's catalog key on each chain, and the chain field it is.
 *
 * @type {Record<string, { pcm: string, sdm: string, field: import("../page/conversion.js").FieldId }>}
 */
const LIST_KEYS = {
  "1x filter": { pcm: "pcm_filter_1x", sdm: "sdm_filter_1x", field: "1x" },
  "Nx filter": { pcm: "pcm_filter_nx", sdm: "sdm_filter_nx", field: "nx" },
  Modulator: { pcm: "pcm_dither", sdm: "sdm_modulator", field: "sh" },
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
 * Remember a name in one slot of a target, the other slot keeping its name from a pair, and persist the slot memory.
 *
 * @param {string} t
 * @param {number} i
 * @param {string} name
 * @param {string[]} [from]  the pair the other slot keeps its name from, the remembered one when omitted
 */
function remember(t, i, name, from = remembered(t)) {
  if (i !== 0 && i !== 1) return;
  const pair = [...from];
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
  const c = chainControlOf(key);
  const id = String(c?.value ?? "");
  return c?.optionsRaw.find((o) => String(o.value) === id)?.label ?? "";
}

/**
 * A list target's slots: each remembered name broken down as the nameplate breaks it, its plain family, variant and
 * leaf, the running name in the first while both are empty, the running one lit while this track's path runs its
 * field.
 *
 * @param {string} t
 * @param {string} key
 * @param {string[]} names
 * @returns {Slot[]}
 */
function listSlots(t, key, names) {
  const run = runningName(key);
  const runs = fieldRunsNow(LIST_KEYS[t].field);
  const shown = names[0] || names[1] ? names : [run, ""];
  const kind = schema[key].plainNames ?? "";
  return shown.map((name, i) => {
    const on = name !== "" && name === run;
    return {
      name,
      ...(name === "" ? { fam: "", variant: null, leaf: "" } : plainOf(kind, name)),
      aka: "",
      on,
      lit: on && runs,
      empty: names[i] === "",
    };
  });
}

/**
 * The two names a list target's slots show.
 *
 * @param {string} key
 * @param {string} t
 * @returns {string[]}
 */
const shownNames = (key, t) => listSlots(t, key, remembered(t)).map((s) => s.name);

/**
 * Matrix profile's slots: each remembered profile, on and lit while it runs.
 *
 * @param {string[]} names
 * @returns {Slot[]}
 */
function profileSlots(names) {
  const active = matrixActiveProfile.value;
  return names.map((name) => {
    const on = name !== "" && name === active;
    return { name, label: name, aka: "", on, lit: on, empty: name === "" };
  });
}

/**
 * Output mode's two fixed slots, the running chain's on and lit.
 *
 * @returns {Slot[]}
 */
function modeSlots() {
  const run = runningChain();
  return MODES.map((m) => {
    const on = run === m.wire;
    return { name: "", label: m.label, aka: m.aka, on, lit: on, empty: false };
  });
}

/**
 * A target's slots.
 *
 * @param {string} t
 * @param {string | null} key
 * @returns {Slot[]}
 */
function slotsOf(t, key) {
  if (key) return listSlots(t, key, remembered(t));
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
 * Whether a write on a target's own path has not settled: Matrix profile's switch, any other target's live write.
 *
 * @param {string} t
 * @returns {boolean}
 */
const unsettled = (t) => (t === "Matrix profile" ? profileUnsettled() : liveUnsettled.value) > 0;

/**
 * A slot's tap: its name sent live to the target. An empty slot sends nothing, nor does the one running while no write
 * on its path is unsettled.
 *
 * @param {number} i
 * @returns {Promise<void> | null}
 */
export function slotLive(i) {
  const v = view();
  const s = v.slots[i];
  if (!s || (s.on && !unsettled(v.target))) return null;
  if (v.layout === "mode") return writeLive("mode", MODES[i].wire);
  if (s.empty) return null;
  return v.key ? pickOption(v.key, s.name) : switchProfile(s.name);
}

/**
 * The element id of a slot's ▾, where its list parks.
 *
 * @param {number} i
 */
export const pickId = (i) => `swlist-${i}`;

/**
 * A slot's list: a list target opens its option list over the body, parked at the slot's ▾, without the name the
 * other slot shows, a pick remembered in the slot beside that name, and returns null; Matrix profile returns the
 * profile choices without the profile the other slot remembers; any other target opens nothing and returns null.
 *
 * @param {number} i
 * @returns {{ value: string, label: string, disabled: boolean, reason: string }[] | null}
 */
export function slotList(i) {
  const v = view();
  const t = v.target;
  const key = v.key;
  if (key) {
    openOptionList({
      key,
      stage: t === "Nx filter" ? "nx" : "1x",
      value: v.slots[i]?.name ?? "",
      pick: (name) => remember(t, i, name, shownNames(key, t)),
      anchor: pickId(i),
      omit: shownNames(key, t)[1 - i],
    });
    return null;
  }
  if (t !== "Matrix profile") return null;
  const other = remembered(t)[1 - i];
  return profileChoices().options.filter((o) => other === "" || o.value !== other);
}

/**
 * The plate's bottom: the bar preference, and `"volume"` while the switcher's target is Volume, else `""`.
 *
 * @returns {{ bottom: string, sw: string } | null}
 */
export function plateBottom() {
  return { bottom: bottomBar.value, sw: switcherTarget.value === "Volume" ? "volume" : "" };
}
