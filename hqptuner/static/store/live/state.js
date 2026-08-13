// The LIVE view's store: what its controls read, and the one path they write by.
//
// This module owns the lane's own mutable state — which control is mid-write,
// what the last error on each control was, and the rules that say which writes
// invalidate what. It is separate because both the write path and every reader
// depend on it, and nothing here depends on them: it is the bottom of the lane.

import { signal, computed, effect } from "@preact/signals";
import { health } from "../signals.js";

// The control currently mid-write ("" = none), and the last error per control.
// One error per control and latest wins: the page has no toast stack, and a
// failed write is about the control the user just touched.
export const liveBusy = signal("");
export const liveErrors = signal({});

// Writes whose own success invalidates an enumeration, in config-form terms.
// Mirrors livelane._REENUMERATES, which names the same three by setter key.
export const REENUMERATES = new Set(["mode", "filter1x", "filter", "oversampling1x", "oversampling", "rate"]);
// True while a write that invalidates the lists is in flight. Every control
// whose options come from an enumeration is unsafe for that whole window: its
// list is the pre-write one, and the IDs in it stop meaning what they meant the
// moment the engine re-enumerates. Disabling them is the surfacing — an in-row
// text note would reflow the row for the seconds a mode write takes.
export const liveEnumBusy = computed(() => REENUMERATES.has(liveBusy.value));
// Writes that change what the running config reports for the two rate limits.
export const RATE_MIRRORED = new Set(["mode", "rate"]);

// A live error is about one write and the connection that write died on. The
// engine goes down briefly under SetFilter and SetMode, and the poll loop brings
// a new connection up within seconds (manager._connect_and_load) — at which point
// the message describes a moment that is over, and the control it sits on is
// working again. So it goes when the connection does.
//
// Keyed on the connection's own timestamp, not on `reachable`: the drop can be
// shorter than the health poll's interval, so the false that a reachable-edge
// would need is never observed and the error would sit there forever.
// The FIRST connection is not a reconnect: nothing on the page predates it, so
// there is nothing of an older connection's to drop. Only a move from one
// connection to another clears.
/**
 * @typedef {object} LiveReport
 *   What POST /api/config/live answers with. The lane verifies each setter by
 *   State readback and reports per setting, so a 200 can still carry failures.
 * @property {{ ok: boolean, setting: string, error?: string }[]} [live]
 * @property {Record<string, string>} [stored] edits HELD for a chain not loaded
 */

/** @type {string | number | undefined} */
let seenConnection;
effect(() => {
  const now = health.value && health.value.connected_at;
  if (!now || now === seenConnection) return;
  const first = seenConnection === undefined;
  seenConnection = now;
  if (!first) liveErrors.value = {};
});

/**
 * Set or clear one control's error, leaving every other control's alone.
 * @param {string} field
 * @param {string} message "" clears
 * @returns {void}
 */
export function setError(field, message) {
  const next = { ...liveErrors.value };
  if (message) next[field] = message;
  else delete next[field];
  liveErrors.value = next;
}

// A 200 still carries failures: the backend verifies each setter by State
// readback and reports per setting, so an entry that did not verify is this
// control's error just as much as a thrown 409 is.
/**
 * The message for the first setting in a report that did not verify, "" when every one
 * of them did.
 * @param {LiveReport} report
 * @returns {string}
 */
export function reportError(report) {
  const failed = ((report && report.live) || []).find((e) => !e.ok);
  if (!failed) return "";
  return failed.error || `${failed.setting} did not take`;
}
