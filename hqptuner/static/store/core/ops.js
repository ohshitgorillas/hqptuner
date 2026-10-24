// The write lifecycle: busy, error, latest-wins and the alert lines every write reports on.

import { batch, computed, effect, signal } from "@preact/signals";
import { failText } from "../../lib/errtext.js";

/** @typedef {"apply" | "live" | "snapshot" | "description" | "favorite" | "narrowing"} Area */

/** What `run` returns when its function failed. */
export const FAILED = Symbol("FAILED");

/** What a `latest()` call resolves to when a later call started first. */
export const STALE = Symbol("STALE");

/** @type {Record<string, string>} */
export const LEADS = {
  apply: "Apply failed: ",
  live: "Live change failed: ",
  snapshot: "Snapshot failed: ",
  description: "Profile description failed: ",
  favorite: "Favorite failed: ",
  narrowing: "Narrow filters failed: ",
};

/**
 * A writable error sentence whose dismissal clears the operation's error.
 * @param {Op<any>} operation
 * @returns {{ value: string }}
 */
export function opErrorText(operation) {
  const text = signal("");
  effect(() => {
    const error = operation.error.value;
    text.value = error === null ? "" : failText(operation.lead || "", error);
  });
  effect(() => {
    if (!text.value) operation.clear();
  });
  return text;
}

const engineRuns = signal(0);
const areaErrors = signal(/** @type {Map<string, unknown>} */ (new Map()));

/** @param {string | null} area @param {unknown[]} errors */
function updateArea(area, errors) {
  if (area === null) return;
  const next = new Map(areaErrors.peek());
  next.delete(area);
  for (const error of errors) next.set(area, error);
  areaErrors.value = next;
}

/**
 * @template T
 * @typedef {object} Op
 * @property {{ readonly value: boolean }} busy
 * @property {{ readonly value: unknown }} error
 * @property {string | null} lead
 * @property {(fn: () => T | Promise<T>, options?: { engine?: boolean }) => Promise<T | typeof FAILED>} run
 * @property {() => void} clear
 */

/**
 * One write area's lifecycle: busy, error, and the run that sets them.
 *
 * @param {string} kind
 * @param {{ engine?: boolean, alert?: string | null }} [options]
 * @returns {Op<any>}
 */
export function op(kind, { engine = false, alert = kind } = {}) {
  const busy = signal(false);
  const error = signal(/** @type {unknown} */ (null));
  let pending = 0;
  const clear = () =>
    batch(() => {
      error.value = null;
      updateArea(alert, []);
    });
  /** @param {() => any} fn @param {{ engine?: boolean }} [options] */
  const run = async (fn, { engine: runEngine = engine } = {}) => {
    batch(() => {
      pending += 1;
      busy.value = true;
      if (runEngine) engineRuns.value = engineRuns.peek() + 1;
    });
    try {
      const result = await fn();
      clear();
      return result;
    } catch (caught) {
      batch(() => {
        error.value = caught;
        updateArea(alert, [caught]);
      });
      return FAILED;
    } finally {
      batch(() => {
        pending -= 1;
        busy.value = pending > 0;
        if (runEngine) engineRuns.value = engineRuns.peek() - 1;
      });
    }
  };
  const lead = Object.hasOwn(LEADS, kind) ? LEADS[kind] : null;
  return { busy, error, lead, run, clear };
}

/**
 * A wrapper under which only the most recent call's promise resolves to its value.
 *
 * @returns {<T>(promise: Promise<T>) => Promise<T | typeof STALE>}
 */
export function latest() {
  let sequence = 0;
  return async (promise) => {
    const current = ++sequence;
    const result = await promise;
    return current === sequence ? result : STALE;
  };
}

/** True while an engine write runs. */
export const inFlight = computed(() => engineRuns.value > 0);

/** One entry per failing area. @type {{ readonly value: { area: string, error: unknown }[] }} */
export const failures = computed(() => Array.from(areaErrors.value, ([area, error]) => ({ area, error })));
