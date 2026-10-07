// Rendered suite for hqptuner/static/components/faceplate/Header.js, the faceplate's header row: the brand knob shows
// the connection state, the Station · Snapshot tree loads stations and applies the loaded station's snapshots, and
// the builders and the gear swap the body, each pressed while its body shows.
//
// A fetch fake answers the real REST paths with their real shapes and records every request; no store function is
// stubbed. Taps are fired through the renderer's vnode seam, since render-to-string fires no events. Preset and
// snapshot names are the fixture's own wire data; everything located by a word carries a `data-testid` instead.
//
// Not reachable here: the tree panel parking itself against its trigger, which runs in a layout effect that server
// rendering never runs. A browser run closes that gap.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/header.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Header, noteId } from "../../../../hqptuner/static/components/faceplate/Header.js";
import { health, config, pendingPreset, engineState, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { applying, lastApply, discardAll } from "../../../../hqptuner/static/store/actions.js";
import { engineBusy } from "../../../../hqptuner/static/store/enginewrite.js";
import { liveMode } from "../../../../hqptuner/static/store/ui/prefs.js";
import {
  liveBook,
  livePresets,
  livePresetStation,
  livePresetsBusy,
  livePresetError,
} from "../../../../hqptuner/static/store/live/presets.js";
import { unfolded } from "../../../../hqptuner/static/store/faceplate/stations.js";
import { snapshotTip } from "../../../../hqptuner/static/store/faceplate/builders/rows.js";
import { body, openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { setupOpen } from "../../../../hqptuner/static/store/setup.js";
import { elements, attr, text, hasAttr } from "../../support/markup.js";
import { renderTree, textOf } from "../../support/vnodeseam.js";
import { ok } from "../../support/wire/wire.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** @type {{ path: string, method: string, body: Record<string, unknown> | null }[]} */
const CALLS = [];

/**
 * The answer to one request: the preset read, both applies, and the reads around them in their real shapes.
 *
 * @param {string} path
 */
function answer(path) {
  if (path === "/api/preset/Night") return ok({ name: "Night", config: { volume_max: "-9" } });
  if (path === "/api/config") return ok({ data: config.value });
  if (path === "/api/config/pending" || path === "/api/config/stage") return ok({ live: {}, http: {} });
  if (path === "/api/config/apply") return ok({ report: {} });
  if (path === "/api/livepresets") return ok({ presets: [], stations: {} });
  if (path === "/api/state") return ok({ stale: false, loaded_at: 1, data: {} });
  if (path === "/api/connection") return ok({ host: "", username: "", remember: true, has_password: false });
  if (path === "/api/discover") return ok([]);
  return ok({ report: {} });
}

/** A live snapshot record as the book holds it. */
const snap = () => ({ chain: "pcm", fields: { mode: "pcm" }, names: {} });

beforeEach(async () => {
  CALLS.length = 0;
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string, body?: string }} */ opts = {}) => {
    CALLS.push({ path, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
    return answer(path);
  };
  engineState.value = {};
  matrixConfig.value = { fields: [] };
  config.value = {
    fields: [],
    file: {},
    active: "Day",
    profiles: { value: "Day", options: ["", "Day", "Night"].map((n) => ({ value: n, label: n })) },
  };
  liveBook.value = { Day: { Warm: snap() }, Night: { Quiet: snap() } };
  livePresets.value = null;
  livePresetStation.value = null;
  livePresetsBusy.value = "";
  livePresetError.value = "";
  lastApply.value = null;
  pendingPreset.value = null;
  liveMode.value = false;
  await discardAll();
  health.value = { reachable: true, ready: true, info: {} };
  applying.value = false;
  engineBusy.value = false;
  unfolded.value = null;
  body.value = "chain";
  openPopover.value = null;
  CALLS.length = 0;
});

afterEach(() => {
  env.fetch = REAL_FETCH;
  setupOpen.value = false;
});

const refuse = () => {
  health.value = { reachable: true, ready: true, connected: true, credentials_ok: false, info: {} };
};

/** Every element of the rendered header carrying a test id, optionally for one station. */
const marked = (/** @type {string} */ testid, /** @type {string} */ station = "") =>
  elements(render(html`<${Header} />`)).filter(
    (e) => attr(e, "data-testid") === testid && (station === "" || attr(e, "data-station") === station),
  );

/** One attribute of the one element carrying a test id, or undefined when there is none. */
const attrOf = (/** @type {string} */ testid, /** @type {string} */ name) => {
  const [el] = marked(testid);
  return el && attr(el, name);
};

/** Whether a station's snapshot group is hidden, or undefined when the header draws none. */
const groupHidden = (/** @type {string} */ station) => {
  const [el] = marked("snapshots", station);
  return el && hasAttr(el, "hidden");
};

/**
 * Tap the control carrying a test id; a name narrows it to the one whose text is that wire name. Taps nothing when
 * the header draws no such control.
 *
 * @param {string} testid
 * @param {string} [name]
 */
async function tap(testid, name) {
  const { seen } = renderTree(html`<${Header} />`);
  const hit = seen.find((v) => v.props["data-testid"] === testid && (name === undefined || textOf(v) === name));
  const onClick = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (typeof onClick === "function") await onClick();
}

/** The requests the wire saw for a method and a path prefix. */
const sent = (/** @type {string} */ method, /** @type {string} */ prefix) =>
  CALLS.filter((c) => c.method === method && c.path.startsWith(prefix));

test("test_the_knob_reads_lost_while_the_engine_is_not_ready", () => {
  health.value = { reachable: false, ready: false, info: {} };
  assert.equal(attrOf("conn", "data-state"), "lost");
});

test("test_the_knob_reads_busy_while_an_apply_is_in_flight", () => {
  applying.value = true;
  assert.equal(attrOf("conn", "data-state"), "busy");
});

test("test_tapping_the_knob_with_no_alert_opens_the_connection_settings", async () => {
  await tap("conn");
  assert.equal(setupOpen.value, true);
});

test("test_tapping_the_knob_with_an_alert_opens_the_connection_settings_and_its_note", async () => {
  refuse();
  await tap("conn");
  assert.deepEqual({ setup: setupOpen.value, note: openPopover.value }, { setup: true, note: noteId("conn") });
});

test("test_the_tree_trigger_names_the_loaded_station_alone", () => {
  config.value = { ...config.value, active: "Night" };
  const [trigger] = marked("stations");
  assert.deepEqual(
    ["Day", "Night"].filter((n) => trigger !== undefined && text(trigger).includes(n)),
    ["Night"],
  );
});

test("test_only_the_loaded_station_row_is_lit", () => {
  assert.deepEqual(
    marked("station-row")
      .filter((r) => String(attr(r, "class")).split(/\s+/).includes("cur"))
      .map((r) => attr(r, "data-station")),
    ["Day"],
  );
});

test("test_tapping_a_station_name_loads_that_station", async () => {
  await tap("station-name", "Night");
  assert.deepEqual(
    sent("POST", "/api/config/apply").map((c) => c.body?.switch_to),
    ["Night"],
  );
});

test("test_tapping_a_snapshot_under_the_loaded_station_applies_it", async () => {
  await tap("snapshot", "Warm");
  assert.deepEqual(
    sent("POST", "/api/livepresets/").map((c) => c.path),
    ["/api/livepresets/Warm/apply"],
  );
});

test("test_tapping_a_snapshot_under_another_station_applies_nothing", async () => {
  await tap("snapshot", "Quiet");
  assert.equal(sent("POST", "/api/livepresets/").length, 0);
});

test("test_a_snapshot_button_under_the_loaded_station_applies_that_snapshot", async () => {
  const { seen } = renderTree(html`<${Header} />`);
  const hit = seen.find((v) => v.type === "button" && v.props["data-testid"] === "snapshot" && textOf(v) === "Warm");
  const onClick = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (typeof onClick === "function") await onClick();
  assert.deepEqual(
    sent("POST", "/api/livepresets/").map((c) => c.path),
    ["/api/livepresets/Warm/apply"],
  );
});

test("test_only_the_loaded_station_snapshots_are_buttons", () => {
  const rows = marked("snapshot");
  assert.deepEqual(
    ["Warm", "Quiet"].map((n) => rows.filter((e) => text(e) === n).map((e) => e.name === "button")),
    [[true], [false]],
  );
});

test("test_each_snapshot_row_is_titled_with_its_own_records_tip", () => {
  const warm = { chain: "pcm", fields: { mode: "pcm" }, names: {} };
  const quiet = { chain: "sdm", fields: { mode: "sdm" }, names: {} };
  liveBook.value = { Day: { Warm: warm }, Night: { Quiet: quiet } };
  const { seen } = renderTree(html`<${Header} />`);
  const titles = seen
    .filter((v) => v.props["data-testid"] === "snapshot")
    .map((v) => [textOf(v), v.props.title])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  assert.deepEqual(titles, [
    ["Quiet", snapshotTip(quiet)],
    ["Warm", snapshotTip(warm)],
  ]);
});

test("test_every_station_name_is_a_button", () => {
  assert.deepEqual([...new Set(marked("station-name").map((e) => e.name))], ["button"]);
});

test("test_a_folded_station_hides_its_snapshots", () => {
  assert.equal(groupHidden("Night"), true);
});

test("test_tapping_a_station_chevron_unfolds_its_snapshots", async () => {
  const { seen } = renderTree(html`<${Header} />`);
  const chev = seen.find((v) => v.props["data-testid"] === "unfold" && v.props["data-station"] === "Night");
  const onClick = /** @type {(() => unknown) | undefined} */ (chev?.props.onClick);
  if (typeof onClick === "function") onClick();
  assert.equal(groupHidden("Night"), false);
});

test("test_the_station_builder_shows_the_station_body", async () => {
  await tap("station-builder");
  assert.equal(body.value, "station");
});

test("test_the_snapshot_builder_shows_the_snapshots_body", async () => {
  await tap("snapshot-builder");
  assert.equal(body.value, "snapshots");
});

test("test_the_gear_shows_the_settings_body", async () => {
  await tap("settings");
  assert.equal(body.value, "settings");
});

test("test_the_station_builder_is_pressed_while_the_station_body_shows", () => {
  body.value = "station";
  assert.equal(attrOf("station-builder", "aria-pressed"), "true");
});

test("test_the_snapshot_builder_is_pressed_while_the_snapshots_body_shows", () => {
  body.value = "snapshots";
  assert.equal(attrOf("snapshot-builder", "aria-pressed"), "true");
});

test("test_the_gear_is_pressed_while_the_settings_body_shows", () => {
  body.value = "settings";
  assert.equal(attrOf("settings", "aria-pressed"), "true");
});

test("test_the_gear_label_differs_while_the_settings_body_shows", () => {
  body.value = "settings";
  const open = attrOf("settings", "aria-label");
  body.value = "chain";
  assert.notEqual(open, attrOf("settings", "aria-label"));
});

test("test_the_gear_is_not_pressed_while_the_chain_shows", () => {
  assert.equal(attrOf("settings", "aria-pressed"), "false");
});
