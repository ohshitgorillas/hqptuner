// The brand knob's connection state, the three v1's status pill tells apart: a write in flight, an engine that is not
// ready, and a ready idle engine. A write started on any page restarts the same daemon, so it reads busy whatever the
// readiness reads under it.

import { ready } from "../signals.js";
import { applying } from "../actions.js";
import { engineBusy } from "../enginewrite.js";

/** @typedef {"ok" | "busy" | "lost"} ConnState */

/**
 * The connection state the knob shows.
 *
 * @returns {ConnState}
 */
export function connState() {
  if (applying.value || engineBusy.value) return "busy";
  return ready.value ? "ok" : "lost";
}
