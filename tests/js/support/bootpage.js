// The page the boot suites start the app on. No test() and no assert lives here.
//
// `bootPage()` hands back the one page of the process: a fake page built with tests/js/support/page.js, its `#app` in
// the body, which `start()` hands with a clock to `boot(doc, clock)` (hqptuner/static/app.js). The stores boot starts
// live for the life of the process, so the app boots once, on the first `start()`, and every later case runs on that
// boot. Nothing is installed on `globalThis` here: the timers are the clock's, and the clock's animation frames run
// only when a case hands them out with `runFrame(ms)`, each at that wall time, ms on the page. `fetch` and
// `EventSource` are the wire fakes (tests/js/support/wire/wire.js, tests/js/support/eventsource.js).
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { boot } from "../../../hqptuner/static/app.js";
import { fakeClock } from "./clock.js";
import { useEventSource } from "./eventsource.js";
import { fakePage } from "./page.js";
import { stagingWire, quiesce } from "./wire/wire.js";

/** @typedef {{ start: () => void, runFrame: (ms: number) => void, cleanup: () => Promise<void> }} BootPage */

/** @type {BootPage | undefined} */
let only;

/** The page for the boot cases; a case registers `cleanup` before `start`, so it runs even when booting fails. */
export function bootPage() {
  only ??= buildPage();
  return only;
}

/** @returns {BootPage} */
function buildPage() {
  const fake = fakeClock();
  /** @type {Array<(now: number) => void>} */
  let frames = [];
  const clock = {
    ...fake.clock,
    requestAnimationFrame: (/** @type {(now: number) => void} */ fn) => frames.push(fn),
  };
  const { doc } = fakePage({ clock, html: '<div id="app"></div>' });
  useEventSource();
  const wire = stagingWire();
  let booted = false;
  return {
    start() {
      if (booted) return;
      booted = true;
      boot(doc, /** @type {any} */ (clock));
    },
    runFrame(ms) {
      fake.advance(ms - fake.clock.now());
      const pending = frames;
      frames = [];
      for (const fn of pending) fn(fake.clock.now());
    },
    async cleanup() {
      try {
        await quiesce(wire);
      } finally {
        frames = [];
      }
    },
  };
}
