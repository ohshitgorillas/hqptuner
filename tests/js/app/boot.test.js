// Boot suite for hqptuner/static/app.js: `boot(doc, clock)` starts the app on `doc`, health and the meter feed and
// loop among what it starts, then renders the Faceplate into `doc`'s `#app`; every timer it runs comes from `clock`
// (docs/superpowers/specs/rebuild-integrate-design.md, Modules). The browser's only animation frame is the meter loop's,
// so a started loop asks `clock` for its frames.
//
// The page is the fake page (tests/js/support/page.js) holding an empty `#app`, on a fake clock
// (tests/js/support/clock.js). Boot is handed that clock behind a counter of the frames it is asked for, and the page
// the bare clock, so a frame the page asks for itself (a ResizeObserver's first report) is never counted as the loop's.
// The wire is the fetch fake (tests/js/support/wire/wire.js), whose routes seam logs every path it is asked and answers GET /api/health in the
// daemon's health shape, and the EventSource fake (tests/js/support/eventsource.js) for the meter feed.
// Metering and playback reach the stores through the poll seam
// (tests/js/support/apodpolls.js), the feed's events from the tables in tests/js/support/meterfeed.js.
//
// The stores boot starts live for the life of the process, so the file boots once, on its first case, and every case
// waits on that one boot.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/app/boot.test.js

import test, { after } from "node:test";
import assert from "node:assert/strict";

import { boot } from "../../../hqptuner/static/app.js";
import { health } from "../../../hqptuner/static/store/signals.js";
import { newTrack, poll } from "../support/apodpolls.js";
import { fakeClock } from "../support/clock.js";
import { lastStream, useEventSource } from "../support/eventsource.js";
import { CONTIGUOUS_44K, RATE_44K, geometry, play } from "../support/meterfeed.js";
import { fakePage, hostPage } from "../support/page.js";
import { ok, quiesce, stagingWire } from "../support/wire/wire.js";

/** GET /api/health as a daemon not yet reached serves it. */
const HEALTH = { phase: "Down", generation: 0, connected_at: null, credentials_ok: null, address_found: null };

/** How far the frame case moves the clock, ms: a few of the clock's 16 ms frames. */
const FRAMES_MS = 100;

/** How long the speed case holds the engine below realtime, ms on the clock, and how far apart its Status frames come. */
const SLOW_HOLD_MS = 30000;
const FRAME_MS = 1000;

/** A base to read a stream URL's path against; only the path is compared. */
const BASE = "http://page.invalid";

const fake = fakeClock();
let framesAsked = 0;
/** The clock handed to boot: the fake one, counting each animation frame it is asked for. The page runs on the bare one. */
const clock = {
  ...fake.clock,
  requestAnimationFrame: (/** @type {(now: number) => void} */ fn) => {
    framesAsked += 1;
    return fake.clock.requestAnimationFrame(fn);
  },
};
const page = fakePage({ clock: fake.clock, html: '<div id="app"></div>' });
/** The global `document` this file leaves preact: the page's node factory, and nothing else of the page. @param {any} doc */
const nodeFactory = (doc) => ({
  createElement: (/** @type {string} */ name) => doc.createElement(name),
  createElementNS: (/** @type {string | null} */ ns, /** @type {string} */ name) => doc.createElementNS(ns, name),
  createTextNode: (/** @type {string} */ text) => doc.createTextNode(text),
});
// Preact builds its nodes through the global document. hostPage lends it the page for the file's life and queues its
// re-renders on the page, which `page.settle()` runs before a case reads the page; the global is then cut down to the
// page's node factory, so code that reads past `doc` for the global document finds no `#app`, no Faceplate and no
// query there, and `doc` stays the only way to the page.
after(hostPage(page));
/** @type {any} */ (globalThis).document = nodeFactory(page.doc);
useEventSource();
/** @type {string[]} every path the page asked the wire for */
const asked = [];
const wire = stagingWire({
  routes: (path) => {
    asked.push(path);
    return path === "/api/health" ? ok(HEALTH) : undefined;
  },
});

/** @type {Promise<void> | undefined} */
let started;
/** Boot the page once, on the first case that asks, and let the wire go quiet. */
const booted = () =>
  (started ??= Promise.resolve()
    .then(() => boot(page.doc, clock))
    .then(() => quiesce(wire))
    .then(() => page.settle()));

/** Switch metering on with a new playing track, then play the feed's opening events on the stream opened last. */
const playFeed = () => {
  newTrack();
  poll();
  lastStream()?.emit("geometry", geometry(RATE_44K));
  play(CONTIGUOUS_44K);
};

test("test_boot_renders_the_faceplate_into_the_documents_app_element", async () => {
  await booted();
  const app = page.doc.getElementById("app");
  // The Faceplate's frame: the header's brand knob and the engine row's speed gauge.
  assert.deepEqual(
    { knob: app.querySelectorAll('[data-testid="conn"]').length, gauge: app.querySelectorAll(".gauge").length },
    { knob: 1, gauge: 1 },
  );
});

test("test_once_booted_metering_opens_the_meter_feed", async () => {
  await booted();
  newTrack();
  poll();
  assert.equal(new URL(String(lastStream()?.url), BASE).pathname, "/api/meter/feed");
});

test("test_once_booted_the_meter_loop_asks_the_handed_clock_for_its_frames", async () => {
  await booted();
  playFeed();
  const before = framesAsked;
  fake.advance(FRAMES_MS);
  assert.ok(framesAsked > before);
});

// Break: drawing the DSP speed alert the started engine-health alerts raise reaches past `doc` for the global document,
// which holds only preact's node factory here, no page to query (rebuild-integrate-design.md Modules, Homes).
test("test_once_booted_a_sustained_below_realtime_engine_draws_its_alert_on_the_documents_faceplate_alone", async () => {
  await booted();
  /** @type {string[]} every error the page left unhandled while it drew */
  const thrown = [];
  const keep = (/** @type {unknown} */ e) => thrown.push(String(e));
  process.on("unhandledRejection", keep);
  health.value = { ...HEALTH, phase: "Ready", credentials_ok: true, address_found: true };
  newTrack({ process_speed: "1.5" });
  for (let held = 0; held < SLOW_HOLD_MS; held += FRAME_MS) {
    poll({ process_speed: "0.5" });
    fake.advance(FRAME_MS);
  }
  await quiesce(wire);
  page.settle();
  process.off("unhandledRejection", keep);
  // The DSP speed alert's home is the engine-row speed figure, crit below realtime.
  const gauge = page.doc.getElementById("app").querySelector(".gauge");
  assert.deepEqual({ thrown, alert: gauge?.getAttribute("data-alert") }, { thrown: [], alert: "crit" });
});
