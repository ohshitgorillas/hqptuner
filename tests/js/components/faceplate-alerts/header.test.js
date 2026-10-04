// Rendered suite for the alert homes on hqptuner/static/components/faceplate/Header.js: refused credentials blink the
// knob and Roon at default idle time blinks the gear, each in its colour, and the knob's tap opens a popover of the
// lines homed on it, one per alert, each carrying its severity.
//
// The wire is the seam, as tests/js/store/faceplate/alerts.test.js drives it: the /api/health reading goes into
// `health`, the /api/status frame with its metadata child into `engineStatus`. The rest of the header's state is set as
// tests/js/components/faceplate/header.test.js sets it, with its fetch fake answering the staging reads. The tap is
// fired through the renderer's vnode seam, since render-to-string fires no events. The lines' sentences are owner copy
// and are nowhere in this file: a line is found by the severity it carries.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/header.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Header } from "../../../../hqptuner/static/components/faceplate/Header.js";
import {
  health,
  config,
  pendingPreset,
  engineState,
  engineStatus,
  matrixConfig,
} from "../../../../hqptuner/static/store/signals.js";
import { applying, lastApply, discardAll } from "../../../../hqptuner/static/store/actions.js";
import { engineBusy } from "../../../../hqptuner/static/store/enginewrite.js";
import { liveBook, livePresets } from "../../../../hqptuner/static/store/live/presets.js";
import { unfolded } from "../../../../hqptuner/static/store/faceplate/stations.js";
import { body, openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { elements, attr, hasAttr } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";
import { staticWire } from "../../support/wire/wire.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** A /api/health reading whose credentials the daemon accepted. */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true, info: {} };

beforeEach(async () => {
  staticWire();
  engineState.value = {};
  engineStatus.value = null;
  matrixConfig.value = { fields: [] };
  config.value = {
    fields: [],
    file: {},
    active: "Day",
    profiles: { value: "Day", options: ["", "Day"].map((n) => ({ value: n, label: n })) },
  };
  liveBook.value = {};
  livePresets.value = null;
  lastApply.value = null;
  pendingPreset.value = null;
  await discardAll();
  health.value = { ...HEALTHY };
  applying.value = false;
  engineBusy.value = false;
  unfolded.value = null;
  body.value = "chain";
  openPopover.value = null;
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

const refuse = () => {
  health.value = { ...HEALTHY, credentials_ok: false };
};

/** A Roon track playing, the engine idle time at its default. */
const roon = () => {
  engineStatus.value = { status: { state: "2", process_speed: "1.5" }, metadata: { song: "Roon" } };
};

/** Every element of the rendered header. */
const all = () => elements(render(html`<${Header} />`));

/** One attribute of the element carrying a test id, or undefined when there is none. */
const attrOf = (/** @type {string} */ testid, /** @type {string} */ name) => {
  const el = all().find((e) => attr(e, "data-testid") === testid);
  return el && attr(el, name);
};

/** Tap the knob; taps nothing when it takes no tap. */
function tapKnob() {
  const { seen } = renderTree(html`<${Header} />`);
  const hit = seen.find((v) => v.props["data-testid"] === "conn");
  const onClick = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (typeof onClick === "function") onClick();
}

/** The lines inside the header's shown popover panels: the elements carrying a severity. */
const shownLines = () =>
  all()
    .filter((e) => e.name !== "button" && hasAttr(e, "data-pop") && !hasAttr(e, "hidden"))
    .flatMap((p) => elements(p.html).filter((e) => hasAttr(e, "data-sev")));

test("test_refused_credentials_blink_the_knob_red", () => {
  refuse();
  assert.equal(attrOf("conn", "data-alert"), "crit");
});

test("test_roon_at_default_idle_time_blinks_the_gear_amber", () => {
  roon();
  assert.equal(attrOf("settings", "data-alert"), "warn");
});

test("test_tapping_the_knob_opens_one_line_per_alert_homed_on_it", () => {
  refuse();
  roon();
  tapKnob();
  assert.equal(shownLines().length, 1);
});

test("test_the_knobs_first_line_carries_its_alerts_severity", () => {
  refuse();
  tapKnob();
  const [first] = shownLines().map((e) => attr(e, "data-sev"));
  assert.equal(first, "crit");
});
