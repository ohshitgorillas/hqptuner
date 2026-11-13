// Contract suite for what a push or a setting costs the page while the meters paint: work counted, never timed. A status
// push re-renders only the components that show a field the push changed, a hidden list renders nothing on any push, and
// a settings change re-renders only the components that show that setting.
//
// The real app is booted once on the fake page (tests/js/support/page.js) and its wire fakes, on a fake clock, with a
// playing track. Preact's render hook counts the components rendered between a change and the page going quiet again, and
// reads where each stands: inside an element the page hides or not. A component whose output the change wrote nothing under
// did work for nothing; the page's own write tracking (page.writes) says what was written. A push that changes a field no
// component shows is the field `unshown_by_any_component`, which the daemon does not send.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/render-cost.test.js

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { options } from "preact";

import { boot } from "../../../hqptuner/static/app.js";
import { setSpectrumOffset } from "../../../hqptuner/static/store/meter/delay.js";
import { engineStatus, health } from "../../../hqptuner/static/store/signals.js";
import { setApodWindow, setMeterRange } from "../../../hqptuner/static/store/ui/prefs.js";
import { newTrack, poll } from "../support/apodpolls.js";
import { fakeClock } from "../support/clock.js";
import { useEventSource } from "../support/eventsource.js";
import { fakePage, hostPage } from "../support/page.js";
import { useStorage } from "../support/storage.js";
import { ok, quiesce, stagingWire } from "../support/wire/wire.js";

const READY = { phase: "Ready", generation: 0, connected_at: null, credentials_ok: true, address_found: true };

const clock = fakeClock();
const page = fakePage({ clock: clock.clock, html: '<div id="app"></div>' });
after(hostPage(page));
/** @type {any} */ (globalThis).document = page.doc;
useStorage();
useEventSource();
const wire = stagingWire({ routes: (path) => (path === "/api/health" ? ok(READY) : undefined) });

/** The components one change rendered: how many, how many stood inside a hidden element, and each one's own DOM node. */
const rendered = { count: 0, hidden: 0, bases: /** @type {any[]} */ ([]) };
/** @type {any} */
const hooks = options;
const previous = hooks.__r;
hooks.__r = (/** @type {any} */ vnode) => {
  const base = vnode.__c?.base ?? null;
  rendered.count++;
  rendered.bases.push(base);
  for (let node = base; node; node = node.parentNode) {
    if (node.hasAttribute?.("hidden")) {
      rendered.hidden++;
      break;
    }
  }
  if (previous) previous(vnode);
};

/** @type {Promise<void> | undefined} */
let started;
/** Boot the app once and play a track, so the page is up with the engine playing. */
const booted = () =>
  (started ??= (async () => {
    boot(page.doc, clock.clock);
    health.value = READY;
    await quiesce(wire);
    newTrack();
    poll();
    await quiesce(wire);
    page.settle();
    await quiesce(wire);
    page.settle();
  })());

/**
 * Make `change` and let the page go quiet; what it rendered and wrote.
 *
 * @param {() => void} change
 * @returns {Promise<{ renders: number, hidden: number, wasted: number }>}
 */
async function costOf(change) {
  await booted();
  rendered.count = 0;
  rendered.hidden = 0;
  rendered.bases = [];
  page.mark();
  change();
  await quiesce(wire);
  page.settle();
  const written = page.writes();
  const wasted = rendered.bases.filter((b) => b && !written.some((w) => page.within(w, b))).length;
  return { renders: rendered.count, hidden: rendered.hidden, wasted };
}

/** A status push that changes only the field no component shows. */
const pushUnshown = () => {
  const now = engineStatus.peek();
  engineStatus.value = {
    ...now,
    status: { ...now?.status, unshown_by_any_component: String(rendered.count + Math.random()) },
  };
};

test("test_a_status_push_that_changes_no_field_any_component_shows_re_renders_no_component", async () => {
  const { renders } = await costOf(pushUnshown);
  assert.equal(renders, 0);
});

test("test_a_hidden_list_renders_nothing_on_a_status_push", async () => {
  const { hidden } = await costOf(() => poll());
  assert.equal(hidden, 0);
});

const SETTINGS = {
  the_spectrum_offset: () => setSpectrumOffset("0.4"),
  the_spectrogram_window: () => setApodWindow("60"),
  the_meter_range: () => setMeterRange("150"),
};

for (const [name, change] of Object.entries(SETTINGS)) {
  test(`test_changing_${name}_re_renders_only_components_whose_output_it_wrote`, async () => {
    const { wasted } = await costOf(change);
    assert.equal(wasted, 0);
  });
}
