// The Setting Switcher's state — which setting the switcher is aimed at, the two
// values it holds for it, and which of them the engine is running right now.
//
// Its own module rather than part of the card, for the reason every other store
// module here is: the card renders it and nothing else reads it, but what it
// answers is a question about the engine's state, and answering that inside a
// component would put a poll-driven computation behind a render.
//
// The pair is stored per FIELD, not per row: `dither` and `modulator` are
// different keys, so the PCM pair and the SDM pair cannot reach each other and a
// chain change swaps the whole pair rather than reinterpreting stored IDs
// against a list they were never picked from. A stored ID carries the name it
// had when it was picked, which is the rule stored enum IDs already follow
// (docs/architecture.md, live snapshots): the value applies, the name renders,
// because engine-built enumerations shift under anything stored.
//
// Storage is this module's own, the way store/matrix/mode.js keeps its snapshot:
// prefs.js's persist/loadBool are private to it and hold booleans, and neither
// this pair nor the target is one.
import { signal, computed } from "@preact/signals";
import { engineState } from "../signals.js";
import { CHAINS } from "./derive.js";
import { liveModel } from "./model.js";
import { writeLive } from "./write.js";

const TARGET_KEY = "hqptuner.abTarget";
const SLOTS_KEY = "hqptuner.abSlots";

// The same field on the other chain. A chain change carries the user's pick
// across by this table and never by the row's position: CHAINS is documented as
// signal order mirroring routing.ROUTABLE, which is not an identity, so a
// reorder there would silently retarget every stored pair.
const TWIN = {
  filter1x: "oversampling1x",
  filter: "oversampling",
  dither: "modulator",
  oversampling1x: "filter1x",
  oversampling: "filter",
  modulator: "dither",
};

// The words the rows wear. The live snapshot card already names these six
// fields (components/live/Presets.js) and says the same thing about them.
const LABELS = {
  filter1x: "1x filter",
  filter: "Nx filter",
  dither: "Dither",
  oversampling1x: "1x filter",
  oversampling: "Nx filter",
  modulator: "Modulator",
};

/**
 * @typedef {{ id: string, name: string }} AbSlot
 *   One side's stored value: the enum ID that gets written, and the name it
 *   carried when it was picked.
 * @typedef {{ a: AbSlot | null, b: AbSlot | null }} AbPair
 * @typedef {{ field: string, label: string }} AbRow
 *   One row of the target picker: the live form field it aims at, and its label.
 */

/** @returns {string} */
function loadTarget() {
  try {
    return localStorage.getItem(TARGET_KEY) || "";
  } catch {
    return ""; // storage disabled — the session still switches
  }
}

/** @returns {Record<string, AbPair>} */
function loadSlots() {
  try {
    const v = JSON.parse(localStorage.getItem(SLOTS_KEY) || "null");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} key
 * @param {string} value
 * @returns {void}
 */
function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage disabled — the in-memory value drives the session */
  }
}

/** The live form field the user picked, "" when none. May name either chain. */
export const abTarget = signal(loadTarget());

/** Every stored pair, by the field it belongs to. */
const slotsByField = signal(loadSlots());

/**
 * Aim the switcher at one setting.
 *
 * @param {string} field a live form field the switcher can target
 * @returns {void}
 */
export function setAbTarget(field) {
  abTarget.value = field;
  store(TARGET_KEY, field);
}

// The chain the card resolves. `active_chain` is the configured mode outright in
// pcm and sdm, and the family of the playing rate in auto; it is absent when auto
// has nothing playing, and PCM is the answer there — the owner's rule, and the
// one that keeps the card usable before playback starts.
export const abChain = computed(() => ((engineState.value || {}).active_chain === "sdm" ? "sdm" : "pcm"));

/**
 * The three settings the switcher can aim at on one chain.
 *
 * @param {string} chain
 * @returns {AbRow[]}
 */
function rowsFor(chain) {
  return CHAINS[chain].map((c) => ({
    field: c.field,
    label: /** @type {Record<string, string>} */ (LABELS)[c.field],
  }));
}

/** The three settings the switcher can aim at on the resolved chain. */
export const abRows = computed(() => rowsFor(abChain.value));

// The picked target as the LOADED chain names it. A pick made on one chain
// stays aimed at the same setting when the other chain loads — 1x filter stays
// 1x filter, dither becomes modulator — because that is what the user aimed at.
export const abField = computed(() => {
  const picked = abTarget.value;
  if (!picked) return "";
  const rows = rowsFor(abChain.value);
  if (rows.some((r) => r.field === picked)) return picked;
  const twin = /** @type {Record<string, string>} */ (TWIN)[picked] || "";
  return rows.some((r) => r.field === twin) ? twin : "";
});

/** The two values held for the current target. */
export const abSlots = computed(
  () => slotsByField.value[abField.value] || /** @type {AbPair} */ ({ a: null, b: null }),
);

/**
 * Put a value in one side of the switch. Writes nothing to the engine: the
 * slots are the pick, the switch is the write.
 *
 * @param {"a" | "b"} side
 * @param {string} id the enum ID to write when that side is picked
 * @param {string} name the name it carries now
 * @returns {void}
 */
export function setAbSlot(side, id, name) {
  const field = abField.value;
  if (!field) return;
  const pair = { ...(slotsByField.value[field] || { a: null, b: null }), [side]: { id: String(id), name } };
  const next = { ...slotsByField.value, [field]: pair };
  slotsByField.value = next;
  store(SLOTS_KEY, JSON.stringify(next));
}

// The target's control as the page reads it, whichever chain it belongs to: the
// value comes from the enumerations when that chain is loaded and from the
// running config's live overlay when it is not (store/live/chains.js), so a
// held edit is reflected here the same way it is on the dormant chain card.
const targetControl = computed(() => {
  const field = abField.value;
  if (!field) return null;
  const { pcmChain, sdmChain } = liveModel.value;
  return [...pcmChain, ...sdmChain].find((c) => c.field === field) || null;
});

// Which side the engine is on. Neither, whenever the running value is something
// else: the setting is reachable from its chain card too, and a third value
// there is an ordinary thing to do, not a state to hide.
export const abLit = computed(() => {
  const control = targetControl.value;
  const { a, b } = abSlots.value;
  if (!control) return "";
  const now = String(control.value);
  if (a && String(a.id) === now) return "a";
  return b && String(b.id) === now ? "b" : "";
});

/**
 * Switch the engine to one side's value, now. One live write on the ordinary
 * path, so it is readback-verified and reported like every other LIVE control.
 *
 * @param {"a" | "b"} side
 * @returns {Promise<void>}
 */
export async function flipAb(side) {
  const field = abField.value;
  const slot = abSlots.value[side];
  if (!field || !slot) return;
  await writeLive(field, slot.id);
}
