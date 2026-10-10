// The pinned output rate: an exact rate the engine runs at until the next mode
// switch, written through the LIVE lane as the field `rate`, in Hz, "0" clearing
// it (lanes/live/rate.py).
//
// The pin is read off the engine, never held here: State reports the RatesItem
// index and the engine's own rate list turns it into Hz. The engine drops the pin
// on every SetMode, so the reading follows without anything here to forget.
//
// A pin overrides automatic base-rate selection, so it is sent only while the
// Allow pinned rates preference (store/ui/faceplate.js) is on, and turning that
// preference off clears a pin that is standing.

import { computed, effect } from "@preact/signals";

import { engineState, enums } from "../signals.js";
import { allowPinnedRates } from "../ui/faceplate.js";
import { writeLive } from "./write.js";

/** @typedef {{ index: string, rate: string }} RateItem */

/** The rate the engine is pinned to, in Hz; 0 when it runs on auto or the list cannot say. */
export const pinnedRate = computed(() => {
  /** @type {{ rate?: string }} */
  const state = engineState.value || {};
  /** @type {{ rates?: RateItem[] }} */
  const lists = enums.value || {};
  const item = (lists.rates || []).find((r) => String(r.index) === String(state.rate));
  return item ? Number(item.rate) : 0;
});

/**
 * The rates the engine's list carries, in Hz, auto left out. The live lane
 * resolves a pin to the list's index and refuses a rate the list lacks.
 *
 * @returns {Set<number>}
 */
export function listedRates() {
  /** @type {{ rates?: RateItem[] }} */
  const lists = enums.value || {};
  return new Set((lists.rates || []).map((r) => Number(r.rate)).filter((hz) => hz > 0));
}

/**
 * Pin the output rate, or clear the pin with 0. Does nothing while Allow pinned
 * rates is off.
 *
 * @param {number | string} hz
 * @returns {Promise<void>}
 */
export async function pinRate(hz) {
  if (!allowPinnedRates.value) return;
  await writeLive("rate", String(hz));
}

/**
 * Clear a standing pin, handing the rate back to the engine's automatic choice.
 *
 * @returns {Promise<void>}
 */
export async function pinAuto() {
  if (pinnedRate.value === 0) return;
  await pinRate(0);
}

// The preference as last seen, so only a move from on to off clears: a pin made
// by another client while the preference was never on is not this page's to undo.
let allowed = allowPinnedRates.peek();
effect(() => {
  const now = allowPinnedRates.value;
  const turnedOff = allowed && !now;
  allowed = now;
  if (turnedOff && pinnedRate.peek() !== 0) void writeLive("rate", "0");
});
