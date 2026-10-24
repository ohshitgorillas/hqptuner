// The brand knob's connection state, one of three: a write in flight, an engine that is not
// ready, and a ready idle engine. A write started on any page restarts the same daemon, so it reads busy whatever the
// readiness reads under it.

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
