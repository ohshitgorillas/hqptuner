// The mockup's one event bus: main.js creates it and passes it down, so components announce to each other (signal path,
// pinned rates, page fill, option style, DAC type, relayout) without going through the window.
// Dispatch follows the DOM's rules: subscription order, a subscriber added mid-emit waits for the next emit, one removed
// mid-emit before its turn is skipped, and a subscriber that throws is reported without stopping the rest.

/**
 * @typedef {object} Bus
 * @property {(name: string, fn: (detail: any) => void) => () => void} on  subscribe; returns the unsubscribe
 * @property {(name: string, detail?: unknown) => void} emit  call every subscriber of `name` with `detail`
 */

/**
 * Where a throwing subscriber's error goes: the platform's error report where there is one, the console otherwise.
 *
 * @param {unknown} err
 */
const platformReport = (err) => {
  const g = /** @type {{ reportError?: (e: unknown) => void, console: Console }} */ (globalThis);
  if (g.reportError) g.reportError(err);
  else g.console.error(err);
};

/**
 * A fresh bus with no subscribers.
 *
 * @param {(err: unknown) => void} [report]  receives each error a subscriber throws
 * @returns {Bus}
 */
export function createBus(report = platformReport) {
  /** @type {Map<string, { fn: (detail: any) => void, live: boolean }[]>} */
  const subs = new Map();
  return {
    on(name, fn) {
      const entry = { fn, live: true };
      subs.set(name, [...(subs.get(name) ?? []), entry]);
      return () => {
        entry.live = false;
        subs.set(
          name,
          (subs.get(name) ?? []).filter((x) => x !== entry),
        );
      };
    },
    emit(name, detail) {
      for (const entry of subs.get(name) ?? []) {
        if (!entry.live) continue;
        try {
          entry.fn(detail);
        } catch (err) {
          report(err);
        }
      }
    },
  };
}
