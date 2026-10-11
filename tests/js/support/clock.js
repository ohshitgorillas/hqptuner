// A fake Clock for the suites that drive a unit through its Clock seam. No test() and no assert lives here: every
// assertion stays at its call site in the suite that owns it.

/** @typedef {import("../../../hqptuner/static/lib/clock.js").Clock} Clock */

/**
 * A clock that moves only on `advance`. Every scheduled callback is a row holding its deadline and, for an interval,
 * its period; clearing a handle drops its row. `advance(ms)` runs the rows that fall due, earliest first and in
 * scheduling order on a tie, with `now()` reading each row's deadline while it runs, then lands on `now + ms`. An
 * interval's row re-arms one period on before it runs; a timeout, frame or microtask row is dropped before it runs. A
 * frame is due 16 ms on and is handed the clock's `now`; a microtask is due at once, so it runs on the next advance.
 *
 * @returns {{ clock: Clock, advance: (ms: number) => void }}
 */
export function fakeClock() {
  let now = 0;
  let next = 0;
  /** @type {Map<number, { fn: () => void, at: number, every: number }>} */
  const rows = new Map();
  const arm = (/** @type {() => void} */ fn, /** @type {number} */ ms, /** @type {number} */ every) => {
    next += 1;
    rows.set(next, { fn, at: now + ms, every });
    return next;
  };
  const drop = (/** @type {unknown} */ handle) => void rows.delete(Number(handle));
  /** @type {Clock} */
  const clock = {
    setTimeout: (fn, ms) => arm(fn, ms, 0),
    clearTimeout: drop,
    setInterval: (fn, ms) => arm(fn, ms, ms),
    clearInterval: drop,
    requestAnimationFrame: (fn) => arm(() => fn(now), 16, 0),
    queueMicrotask: (fn) => void arm(fn, 0, 0),
    now: () => now,
  };
  /** @param {number} ms */
  const advance = (ms) => {
    const end = now + ms;
    const due = () => [...rows].filter(([, r]) => r.at <= end).sort(([, a], [, b]) => a.at - b.at)[0];
    for (let hit = due(); hit; hit = due()) {
      const [handle, row] = hit;
      now = row.at;
      if (row.every) row.at += row.every;
      else rows.delete(handle);
      row.fn();
    }
    now = end;
  };
  return { clock, advance };
}
