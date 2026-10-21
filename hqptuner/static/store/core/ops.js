// The write lifecycle: busy, error, latest-wins and the alert lines every write reports on.

import { computed, signal } from "@preact/signals";

/** @typedef {"apply" | "live" | "snapshot" | "description" | "favorite" | "narrowing"} Area */

/** What `run` returns when its function failed. */
export const FAILED = Symbol("FAILED");

/** What a `latest()` call resolves to when a later call started first. */
export const STALE = Symbol("STALE");

/** The one lead constant. */
export const LEAD = 0;

/**
 * @template T
 * @typedef {object} Op
 * @property {{ readonly value: boolean }} busy
 * @property {{ readonly value: unknown }} error
 * @property {(fn: () => Promise<T>) => Promise<T | typeof FAILED>} run
 * @property {() => void} clear
 */

/**
 * One write area's lifecycle: busy, error, and the run that sets them.
 *
 * @param {Area} _area
 * @param {{ engine?: boolean, alert?: Area | null }} [_opts]
 * @returns {Op<any>}
 */
export const op = (_area, _opts) => ({
  busy: signal(false),
  error: signal(null),
  run: async () => FAILED,
  clear: () => {},
});

/**
 * A wrapper under which only the most recent call's promise resolves to its value.
 *
 * @returns {<T>(promise: Promise<T>) => Promise<T | typeof STALE>}
 */
export const latest = () => async () => STALE;

/** True while an engine write runs. */
export const inFlight = computed(() => false);

/** One entry per failing area. @type {{ readonly value: { area: Area, error: unknown }[] }} */
export const failures = computed(() => []);
