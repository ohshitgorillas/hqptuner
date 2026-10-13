// The path the playing source takes through the engine, read off running state alone: what the engine reports it is
// playing and what the daemon is running, never a staged edit. The four source and output combinations run four
// disjoint sets of controls (manual §4.4, §4.5, §4.6), and Direct SDM takes a DSD source to an SDM output with no
// processing at all.

import { engineStatus, PAUSED, PLAYING, ready } from "../signals.js";
import { runningValue } from "../resolve.js";
import { loadedChain } from "../live/rates.js";
import { truthy } from "../../lib/coerce.js";
import { familyOf, isDsdRate } from "../../model/family.js";

/**
 * @typedef {{ active_rate?: string }} Status  the Status-frame attribute read here
 * @typedef {{ samplerate?: string, sdm?: string }} Metadata  the `<metadata>` child's attributes read here
 * @typedef {"idle" | "pcm-pcm" | "pcm-sdm" | "dsd-pcm" | "sdm-sdm" | "direct"} Path
 */

// The metadata child's `sdm` flag is the direct answer, and the source rate is the independent check: a DSD bitstream
// reports its bitstream rate, always at or above DSD64. Either alone suffices.
/** Whether the source is a DSD bitstream, by its sdm flag or its rate. */
export const sourceIsDsd = (/** @type {Metadata} */ md) => truthy(md.sdm) || isDsdRate(md.samplerate);

/** Whether the output is an SDM bitstream, by its rate. */
export const outputIsSdm = (/** @type {Status} */ st) => isDsdRate(st.active_rate);

/**
 * The path playing now: `idle` with nothing playing, else source family to output family, with `sdm-sdm` a DSD
 * source remodulated and `direct` a DSD source passed through under a running Direct SDM.
 *
 * @returns {Path}
 */
export function playbackPath() {
  const s = engineStatus.value || {};
  if (Number((s.status || {}).state) !== PLAYING) return "idle";
  const sdmOut = outputIsSdm(s.status || {});
  if (!sourceIsDsd(s.metadata || {})) return sdmOut ? "pcm-sdm" : "pcm-pcm";
  if (!sdmOut) return "dsd-pcm";
  return truthy(runningValue("direct_sdm")) ? "direct" : "sdm-sdm";
}

/**
 * The chain whose filters and shaper run: the output's family while a source plays, else the one the engine has
 * loaded.
 *
 * @returns {"pcm" | "sdm"}
 */
export function runningChain() {
  const path = playbackPath();
  if (path === "idle") return familyOf(loadedChain());
  return path === "pcm-pcm" || path === "dsd-pcm" ? "pcm" : "sdm";
}

/** @typedef {"playing" | "paused" | "off"} Transport */

/**
 * The transport as the rail's lamps follow it: `off` while the daemon is not ready, stopped or stopping.
 *
 * @returns {Transport}
 */
export function transportNow() {
  if (!ready.value) return "off";
  const state = Number(((engineStatus.value || {}).status || {}).state);
  if (state === PLAYING) return "playing";
  return state === PAUSED ? "paused" : "off";
}
