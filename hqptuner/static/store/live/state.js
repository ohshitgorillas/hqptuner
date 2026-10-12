// The live lane's store: what its controls read, and the one path they write by.
//
// This module owns the lane's own mutable state: how many writes are still
// settling, and which writes move the rate limits the running config reports. It
// is separate because both the write path and every reader depend on it, and
// nothing here depends on them: it is the bottom of the lane.

import { signal } from "@preact/signals";
import { liveFailureText } from "../ui/wirelabels.js";

// How many live writes have not settled: up from a write's start until its
// re-mirror is in, so the mirrors are current only while it reads 0.
export const liveUnsettled = signal(0);

// Writes that change what the running config reports for the two rate limits.
export const RATE_MIRRORED = new Set(["mode"]);

/**
 * @typedef {object} LiveReport
 *   The report half of what POST /api/config/live answers with. The lane verifies each setter by
 *   State readback and reports per setting, so a 200 can still carry failures.
 * @property {{ ok: boolean, setting: string, error?: string, code?: string }[]} [live]
 * @property {Record<string, string>} [stored] edits HELD for a chain not loaded
 * @property {boolean} [reenumerated] the server re-read the engine's enumerations for this batch
 *
 * @typedef {object} LiveAnswer
 *   What a live write answers with: the report, and the auto-save fold beside it.
 * @property {LiveReport} report
 * @property {{ name: string }} [autosaved]
 */

// A 200 still carries failures: the backend verifies each setter by State
// readback and reports per setting, so an entry that did not verify is an error
// just as much as a thrown 409 is.
/**
 * The message for the settings in a report that did not verify, each named by its
 * UI label, "" when every one of them did.
 * @param {LiveReport} report
 * @returns {string}
 */
export function reportError(report) {
  const fails = ((report && report.live) || []).filter((e) => !e.ok);
  return fails.length ? liveFailureText(fails) : "";
}
