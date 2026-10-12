// Rendered suite for clearing the dropped-settings report from the brand knob's popover on
// hqptuner/static/components/faceplate/Header.js: tapping the engine alert's line asks the server to clear the report
// (DELETE /api/health/dropped-settings, answered 204 with no body) and then reads /api/health again, and once that
// reading lists nothing the alert is gone from the knob and from the popover. A tap on the knob only opens the popover,
// a refused clear leaves the line up to be tapped again, and the credentials line beside it clears nothing.
//
// The wire is the seam, as tests/js/components/faceplate-alerts/header-dropped.test.js drives it: the /api/health
// reading carrying `dropped_settings` goes into `health`, the rest of the header's state is set the way that file sets
// it, and a fetch fake answers the staging reads, the clear and the health read from this file's own table. The clear's
// 204 is the platform's own empty Response. Taps are fired through the renderer's vnode seam, since render-to-string
// fires no events; a line is the element carrying a severity, and tapping it fires the first tap handler on that
// element or inside it. The sentences are owner copy and are nowhere in this file: a line is found by its severity.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/header-dropped-clear.test.js

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
  lastApply,
} from "../../../../hqptuner/static/store/signals.js";
import { applying, discardAll } from "../../../../hqptuner/static/store/actions.js";
import { engineBusy } from "../../../../hqptuner/static/store/enginewrite.js";
import { liveBook, livePresets } from "../../../../hqptuner/static/store/live/presets.js";
import { unfolded } from "../../../../hqptuner/static/store/faceplate/stations.js";
import { body, openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { elements, attr, hasAttr } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";
import { stagingWire, quiesce, bad } from "../../support/wire/wire.js";

/** @typedef {{ field: string, value: string, name: string | null }} WrittenSetting */
/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** The clear's path. */
const CLEAR_PATH = "/api/health/dropped-settings";

/** The health read's path. */
const HEALTH_PATH = "/api/health";

/** The knob's test id. */
const KNOB = "conn";

/** The credentials alert's severity, and the dropped-settings alert's, as the knob's popover carries them. */
const CRED_SEV = "crit";
const DROPPED_SEV = "warn";

/** A refusal in the server's own shape. */
const REFUSAL_STATUS = 503;
const REFUSAL_DETAIL = "hqplayerd is not answering";

/** A /api/health reading whose credentials the daemon accepted and which lists no dropped setting. */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true, info: {}, dropped_settings: [] };

/**
 * Two settings a daemon restart dropped.
 *
 * @type {WrittenSetting[]}
 */
const DROPPED = [
  { field: "filter", value: "42", name: "poly-sinc-gauss-xla" },
  { field: "rate", value: "352800", name: null },
];

/** A tap event: the members a tap handler may call. */
const TAP = { preventDefault() {}, stopPropagation() {}, target: {}, currentTarget: {} };

/**
 * The fake server's table: whether it accepts a clear, and the health reading it serves.
 *
 * @type {{ clearRefused: boolean, served: Record<string, unknown> }}
 */
const table = { clearRefused: false, served: { ...HEALTHY } };

/** Every request the fake answered beyond the staging reads: method and path, in arrival order. */
/** @type {[string, string][]} */
const calls = [];

/** @type {StagingWire} */
let wire;

beforeEach(async () => {
  calls.length = 0;
  table.clearRefused = false;
  table.served = { ...HEALTHY };
  wire = stagingWire({
    routes: (path, opts) => {
      const bare = path.split("?")[0];
      calls.push([opts.method || "GET", bare]);
      if (bare === CLEAR_PATH && opts.method === "DELETE") {
        return table.clearRefused ? bad(REFUSAL_STATUS, REFUSAL_DETAIL) : new Response(null, { status: 204 });
      }
      if (bare === HEALTH_PATH) {
        const served = { ...table.served };
        return { ok: true, status: 200, json: async () => served };
      }
      return undefined;
    },
  });
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
  await quiesce(wire);
  health.value = { ...HEALTHY };
  applying.value = false;
  engineBusy.value = false;
  unfolded.value = null;
  body.value = "chain";
  openPopover.value = null;
  calls.length = 0;
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

/**
 * A fresh health reading listing `dropped`, credentials accepted unless `refused`.
 *
 * @param {WrittenSetting[]} dropped
 * @param {boolean} [refused]
 */
const report = (dropped, refused = false) => {
  health.value = { ...HEALTHY, credentials_ok: !refused, dropped_settings: dropped.map((d) => ({ ...d })) };
};

/** Every element of the rendered header. */
const all = () => elements(render(html`<${Header} />`));

/** One attribute of the knob, or undefined when it carries none. */
const knobAttr = (/** @type {string} */ name) => {
  const el = all().find((e) => attr(e, "data-testid") === KNOB);
  return el && attr(el, name);
};

/** The severities of the lines inside the header's shown popover panels, in order. */
const shownSevs = () =>
  all()
    .filter((e) => e.name !== "button" && hasAttr(e, "data-pop") && !hasAttr(e, "hidden"))
    .flatMap((p) => elements(p.html).filter((e) => hasAttr(e, "data-sev")))
    .map((e) => attr(e, "data-sev"));

/**
 * The first tap handler on a vnode or anywhere inside it, or undefined when there is none.
 *
 * @param {unknown} node
 * @returns {((e?: unknown) => unknown) | undefined}
 */
function handlerIn(node) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = handlerIn(child);
      if (hit) return hit;
    }
    return undefined;
  }
  if (node === null || typeof node !== "object") return undefined;
  const props = /** @type {VNode} */ (node).props;
  if (!props) return undefined;
  const onClick = props.onClick;
  if (typeof onClick === "function") return /** @type {(e?: unknown) => unknown} */ (onClick);
  return handlerIn(props.children);
}

/** Open the knob's popover from closed, by tapping the knob. */
async function openKnob() {
  openPopover.value = null;
  const { seen } = renderTree(html`<${Header} />`);
  const hit = seen.find((v) => v.props["data-testid"] === KNOB);
  const onClick = /** @type {((e?: unknown) => unknown) | undefined} */ (hit?.props.onClick);
  if (typeof onClick === "function") await Promise.resolve(onClick(TAP)).catch(() => undefined);
  await quiesce(wire);
}

/**
 * Tap the first line of a severity in the rendered header, and wait for the wire to go quiet. Taps nothing when no
 * such line takes a tap. How the handler itself settles is not this suite's question: the wire and the render are.
 *
 * @param {string} sev
 */
async function tapLine(sev) {
  const { seen } = renderTree(html`<${Header} />`);
  const line = seen.find((v) => typeof v.type === "string" && v.props["data-sev"] === sev);
  const onTap = handlerIn(line);
  if (onTap) await Promise.resolve(onTap(TAP)).catch(() => undefined);
  await quiesce(wire);
}

/** How many clears the fake has been asked for. */
const clears = () => calls.filter(([method, path]) => method === "DELETE" && path === CLEAR_PATH).length;

test("test_tapping_the_dropped_settings_line_clears_the_report_and_then_reads_health_again", async () => {
  report(DROPPED);
  await openKnob();
  await tapLine(DROPPED_SEV);
  assert.deepEqual(
    calls.filter(([, path]) => path === CLEAR_PATH || path === HEALTH_PATH),
    [
      ["DELETE", CLEAR_PATH],
      ["GET", HEALTH_PATH],
    ],
  );
});

test("test_a_cleared_report_takes_the_alert_off_the_knob", async () => {
  const unalerted = knobAttr("data-alert");
  report(DROPPED);
  await openKnob();
  await tapLine(DROPPED_SEV);
  assert.equal(knobAttr("data-alert"), unalerted);
});

test("test_a_cleared_report_leaves_only_the_credentials_line_in_the_knobs_popover", async () => {
  table.served = { ...HEALTHY, credentials_ok: false };
  report(DROPPED, true);
  await openKnob();
  await tapLine(DROPPED_SEV);
  await openKnob();
  assert.deepEqual(shownSevs(), [CRED_SEV]);
});

test("test_tapping_the_knob_sends_no_clear_until_the_line_is_tapped", async () => {
  report(DROPPED);
  await openKnob();
  const afterKnob = clears();
  await tapLine(DROPPED_SEV);
  assert.deepEqual([afterKnob, clears()], [0, 1]);
});

test("test_after_a_refused_clear_the_line_can_be_tapped_again", async () => {
  table.clearRefused = true;
  table.served = { ...HEALTHY, dropped_settings: DROPPED.map((d) => ({ ...d })) };
  report(DROPPED);
  await openKnob();
  await tapLine(DROPPED_SEV);
  await openKnob();
  await tapLine(DROPPED_SEV);
  assert.equal(clears(), 2);
});

test("test_tapping_the_credentials_line_clears_nothing", async () => {
  report(DROPPED, true);
  await openKnob();
  await tapLine(CRED_SEV);
  const afterCredentials = clears();
  await tapLine(DROPPED_SEV);
  assert.deepEqual([afterCredentials, clears()], [0, 1]);
});
