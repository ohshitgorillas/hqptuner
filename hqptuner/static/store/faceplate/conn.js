// The faceplate's two readings of the connection. The brand knob's state is one of three: a write in flight, an
// engine that is not ready, and a ready idle engine. A write started on any page restarts the same daemon, so it reads
// busy whatever the readiness reads under it. The away answer is the page dim's: whether HQPlayer has no control
// connection to HQPTuner, read from the phase alone and never from a write in flight.

import { computed } from "@preact/signals";
import { phase } from "../signals.js";
import { inFlight } from "../core/ops.js";

/** @typedef {"ok" | "busy" | "lost"} ConnState */

/**
 * The connection state the knob shows.
 *
 * @returns {ConnState}
 */
export function connState() {
  if (inFlight.value) return "busy";
  return phase.value === "Ready" ? "ok" : "lost";
}

/** Whether HQPlayer has no connection to HQPTuner: the phase reads Down or Alarm. No reading yet is not away. */
export const hqplayerAway = computed(() => phase.value === "Down" || phase.value === "Alarm");
