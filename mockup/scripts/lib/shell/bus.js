// The mockup's one event bus: main.js creates it and passes it down, so components announce to each other (signal path,
// pinned rates, page fill, option style, DAC type, relayout) without going through the window.
// Dispatch follows the DOM's rules: subscription order, a subscriber added mid-emit waits for the next emit, one removed
// mid-emit before its turn is skipped, and a subscriber that throws is reported without stopping the rest.

/**
 * The detail each of the page's events carries.
 *
 * @typedef {object} BusEvents
 * @property {undefined} relayout  the page refits
 * @property {string} optstyle  the option style: simplified | standard
 * @property {{ p: string, stage: string }} sigpath  the path playing and the source's rate stage
 * @property {import('../narrowing/dactype.js').DacType} dactype  both DAC-type prefs
 * @property {boolean} pinallow  Allow pinned rates
 * @property {string} vfill  the page's top section: auto | profile | spectrum
 */

/**
 * The detail event `K` carries: the page's own events' from BusEvents, every other event's unknown.
 *
 * @template {string} K
 * @typedef {K extends keyof BusEvents ? BusEvents[K] : unknown} Detail
 */

/**
 * @typedef {object} Bus
 * @property {<K extends string>(name: K, fn: (detail: Detail<K>) => void) => () => void} on  subscribe; returns the
 *   unsubscribe
 * @property {<K extends string>(name: K, detail?: Detail<K>) => void} emit  call every subscriber of `name` with `detail`
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
  /** Each event's subscribers; `fn` is a method so one map holds every event's detail type. */
  /** @type {Map<string, { fn(detail: unknown): void, live: boolean }[]>} */
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
