// Rendered suite for hqptuner/static/components/faceplate/drawers/speakers-drawer.js: the Speakers drawer's schema drawn by
// the generic drawer. The draft is store/faceplate/drawers/speakers.js's and the block's drawing
// components/faceplate/drawers/Speakers.js's, each pinned in its own suite under drawers/; this suite pins the wiring:
// the switch row lights the drafted switch and drafts a tap, the block mounts under it, and the apply group goes live
// on an edit and runs the drawer's own form, its apply sending the form's POST and its discard dropping the draft. The
// catalog's own `spken` row, drawn alone in a drawer of one tab this suite declares, writes through the speakers form,
// never through the staged /config edit path: a change on it stages nothing in the config staging buffer and the
// speakers form's own apply is what carries it to the daemon.
//
// The wire is the seam: each case writes the daemon's /speakers form into `speakers`; an apply rides the real
// `POST /api/speakers`, answered by a fake recording the body, and the staging fake records every
// `POST /api/config/stage` body. Buttons are reached through preact's own `options.vnode` hook
// (tests/js/support/vnodeseam.js).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import {
  SPEAKERS_BLOCKS,
  SPEAKERS_DRAWER,
} from "../../../../hqptuner/static/components/faceplate/drawers/speakers-drawer.js";
import { config, engineState, enums, metadata, pendingPreset } from "../../../../hqptuner/static/store/signals.js";
import { speakers, speakersBusy, speakersError } from "../../../../hqptuner/static/store/matrix/speakers.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import {
  applyDraft,
  discardDraft,
  setChannelDistance,
  setSpeakersGate,
  speakerDraft,
} from "../../../../hqptuner/static/store/faceplate/drawers/speakers.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";

/** @typedef {import("../../support/wheel.js").VNode} VNode */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

/** The catalog id of the Speakers drawer's switch. */
const SPKEN = "spken";

const LABELS = ["Left", "Right", "Center", "LFE", "Left rear", "Right rear", "Left side", "Right side"];

/** @param {boolean} enabled */
const form = (enabled) => ({
  enabled,
  channels: LABELS.map((label, index) => ({ index, label, level: 0, distance: 250 + index })),
});

/**
 * A wire answering the speakers POST as confirmed; returns the bodies it was handed.
 *
 * @param {boolean} enabled  the daemon's switch
 */
async function reset(enabled = true) {
  const w = stagingWire({
    routes: (path, opts, wire) => {
      if (path !== "/api/speakers" || opts.method !== "POST") return undefined;
      wire.posts.push(JSON.parse(String(opts.body)));
      return ok({ report: { applied: true, speakers: form(enabled) } });
    },
  });
  speakers.value = form(enabled);
  speakersBusy.value = false;
  speakersError.value = "";
  config.value = { fields: [{ name: "direct_sdm", value: false }], file: {} };
  await discardAll();
  discardDraft();
  return w;
}

const draw = () => renderTree(html`<${Drawer} schema=${SPEAKERS_DRAWER} blocks=${SPEAKERS_BLOCKS} />`);
const all = () => elements(draw().out);

/** The lit option of the switch's catalog row, `spken`, by the value it writes. */
const litGate = () =>
  all()
    .filter((e) => classes(e).includes("drow") && attr(e, "data-k") === "spken")
    .map((row) => elements(row.html).find((b) => b.name === "button" && classes(b).includes("on")))
    .map((b) => (b ? attr(b, "data-v") : undefined));

/**
 * The vnode of a button, found by an attribute and its value.
 *
 * @param {string} name
 * @param {string} value
 * @returns {VNode | undefined}
 */
const button = (name, value) => draw().seen.find((v) => v.type === "button" && v.props[name] === value);

/** @param {string} id */
const disabledOf = (id) =>
  all()
    .filter((e) => attr(e, "data-testid") === id)
    .map((e) => hasAttr(e, "disabled"));

// --- the switch --------------------------------------------------------------------------------------------------

/**
 * Call a vnode prop when it is a handler.
 *
 * @param {unknown} fn
 * @param {...unknown} args
 */
const call = (fn, ...args) => (typeof fn === "function" ? fn(...args) : undefined);

test("test_the_switch_row_lights_the_drafted_switch", async () => {
  await reset(true);
  const daemon = litGate();
  setSpeakersGate(false);
  assert.deepEqual([daemon, litGate()], [["1"], ["0"]]);
});

test("test_a_tap_on_the_switch_drafts_it", async () => {
  await reset(false);
  call(button("data-v", "1")?.props.onClick);
  assert.equal(speakerDraft().enabled, true);
});

// --- the block ---------------------------------------------------------------------------------------------------

test("test_the_block_mounts_the_speakers_body", async () => {
  await reset();
  const block = all().find((e) => attr(e, "data-block") === "speakers");
  const rows = block ? elements(block.html).filter((e) => classes(e).includes("sprow")) : [];
  assert.equal(rows.length, speakerDraft().shown.length);
});

// --- the apply group ---------------------------------------------------------------------------------------------

test("test_an_edit_makes_the_apply_button_live", async () => {
  await reset();
  const before = disabledOf("apply");
  setChannelDistance(1, "400");
  assert.deepEqual([before, disabledOf("apply")], [[true], [false]]);
});

test("test_an_edit_makes_the_discard_button_live", async () => {
  await reset();
  const before = disabledOf("discard");
  setSpeakersGate(false);
  assert.deepEqual([before, disabledOf("discard")], [[true], [false]]);
});

test("test_the_apply_button_sends_the_drafted_form", async () => {
  const w = await reset();
  setChannelDistance(1, "400");
  await call(button("data-testid", "apply")?.props.onClick);
  await quiesce(w);
  assert.deepEqual(w.posts, [{ enabled: true, channels: { 1: { distance: "400" } } }]);
});

test("test_the_discard_button_drops_the_draft", async () => {
  await reset();
  setChannelDistance(1, "400");
  const edited = speakerDraft().differs;
  await call(button("data-testid", "discard")?.props.onClick);
  assert.deepEqual([edited, speakerDraft().differs], [true, false]);
});

// --- the catalog row in a drawer of its own ----------------------------------------------------------------------

/** A drawer of one tab holding the catalog's spken row and nothing else. @type {DrawerSchema} */
const ROW_DRAWER = {
  id: "spkenrow",
  title: "spkenrow",
  aria: "spkenrow",
  tabs: [{ id: "only", label: "only", body: [{ row: { key: SPKEN } }] }],
};

/**
 * Reset every source signal the drawer reads, with the daemon's switch off; returns a wire answering the speakers POST
 * as confirmed and recording each body it was handed.
 */
async function resetForTheRow() {
  const w = stagingWire({
    routes: (path, opts, wire) => {
      if (path !== "/api/speakers" || opts.method !== "POST") return undefined;
      wire.posts.push(JSON.parse(String(opts.body)));
      return ok({ report: { applied: true, speakers: form(true) } });
    },
  });
  speakers.value = form(false);
  speakersBusy.value = false;
  speakersError.value = "";
  config.value = { fields: [{ name: "direct_sdm", value: false }], file: {}, active: "", profiles: null };
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
  discardDraft();
  await quiesce(w);
  return w;
}

/** Tap the option of the spken row that the row does not light, flipping the switch from the daemon's. */
async function tapUnlitOption() {
  const { out, seen } = renderTree(html`<${Drawer} schema=${ROW_DRAWER} />`);
  const row = elements(out).find((e) => attr(e, "data-k") === SPKEN);
  const unlit = (row ? elements(row.html) : []).find(
    (e) => e.name === "button" && attr(e, "data-v") !== undefined && !classes(e).includes("on"),
  );
  const value = unlit ? attr(unlit, "data-v") : undefined;
  const hit = seen.find((v) => v.type === "button" && value !== undefined && v.props["data-v"] === value);
  await call(hit?.props.onClick);
}

test("test_a_change_on_the_spken_row_reaches_the_daemon_by_the_speakers_apply_and_stages_nothing", async () => {
  const w = await resetForTheRow();
  const before = w.stages.length;
  await tapUnlitOption();
  await quiesce(w);
  const stagedByTheChange = w.stages.length - before;
  await applyDraft();
  await quiesce(w);
  assert.deepEqual(
    { speakersPosts: w.posts.map((p) => /** @type {{ enabled?: unknown }} */ (p).enabled), stagedByTheChange },
    { speakersPosts: [true], stagedByTheChange: 0 },
  );
});
