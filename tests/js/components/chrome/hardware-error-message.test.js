// Behavioral suite for how the System tab's hardware surfaces report a caught
// error (components/system/SystemHardware.js): the status line shows the error's
// own message, never the error object's string form (`Error: ...`).
//
// The failure is a real wire failure: the action's REST path answers with a
// refusal in the daemon's own shape, a FastAPI `detail` string, and that detail
// is this suite's own sentence. A refusal that carries a usable detail rejects
// with that detail as the error's message, so the message is a value the test
// put on the wire (docs/testing.md rule 9). The error object itself is built by
// the client, so its name is not the suite's; its string form is read by shape,
// `<Name>Error: <message>`, the form every Error subclass prints. The sentence
// the card wraps around the message is owner copy and is neither selected on nor
// asserted.
//
// Each action is fired through the renderer's vnode seam (support/vnodeseam.js),
// since SSR renders the control but cannot click it, and the wire is let go
// quiet before the surface is rendered again and its status line read.
//
// NOT covered here: the card's LOAD failure. The load runs in a `useEffect`,
// which `preact-render-to-string` never runs, so under SSR the load never
// happens and cannot fail. Reaching it needs a renderer that runs effects
// against a DOM, which the JS suite does not have and docs/testing.md does not
// provide for ("Components render through preact-render-to-string"); a browser
// case under tests/e2e/ would close the gap.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/chrome/hardware-error-message.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { HardwareCard, BackupRestoreRow } from "../../../../hqptuner/static/components/system/SystemHardware.js";
import { config, matrixConfig, metadata, engineState, enums } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../../hqptuner/static/store/ui/prefs.js";
import { api } from "../../../../hqptuner/static/lib/api.js";
import { bad, stagingWire, quiesce } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { classes, elements, text } from "../../support/markup.js";

/** @typedef {import("../../support/wheel.js").VNode} VNode */

//: The REST path the card's apply posts to, and the one an uploaded backup is
//: restored through: wire identity.
const ENGINE = "/api/engine";
const RESTORE = "/api/restore";

//: The refusal status both paths document (docs/openapi.json).
const REFUSED = 422;

//: The status line, by its own class: machine identity (rule 9).
const STATUS = "hw-status";

//: The detail the refusal carries. The sentence is this suite's own, so it may
//: be asserted back.
const DETAIL = "the daemon turned the archive away at line nine";

//: How a status line carries a caught error.
const STRING_FORM = "string form";
const MESSAGE = "message";
const ABSENT = "absent";

// Module-level signals outlive a case (docs/testing.md, harness facts), so every
// source the card could read is put back before each render.
async function reset() {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  matrixConfig.value = { fields: [] };
  config.value = { fields: [], file: {}, active: "", profiles: null };
  await discardAll();
}

/**
 * A wire on which every request to `path` is refused with `detail`; every other
 * path is answered.
 *
 * @param {string} path
 * @param {string} detail
 */
const refusedAt = (path, detail) =>
  stagingWire({
    routes: (asked) => (asked === path ? bad(REFUSED, detail) : undefined),
  });

/**
 * The text of the status line in a rendered fragment, or null when it renders none.
 *
 * @param {string} out
 * @returns {string | null}
 */
function statusText(out) {
  const hit = elements(out).find((el) => classes(el).includes(STATUS));
  return hit ? text(hit) : null;
}

/**
 * How a status text carries an error whose message is `message`: by the error
 * object's string form (`<Name>Error: <message>`), by its message alone, or not
 * at all.
 *
 * @param {string | null} said
 * @param {string} message
 * @returns {string}
 */
function carries(said, message) {
  if (said === null) return ABSENT;
  const escaped = message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\w*Error: ${escaped}`).test(said)) return STRING_FORM;
  return said.includes(message) ? MESSAGE : ABSENT;
}

/**
 * The vnode a render built for the element carrying `data-testid="<id>"`.
 *
 * @param {VNode[]} seen
 * @param {string} id
 * @returns {VNode}
 */
function marked(seen, id) {
  const hit = seen.find((v) => v.props && v.props["data-testid"] === id);
  if (!hit) throw new Error(`the render built no element marked "${id}"`);
  return hit;
}

/**
 * The vnode a render built for the backup file picker.
 *
 * @param {VNode[]} seen
 * @returns {VNode}
 */
function filePicker(seen) {
  const hit = seen.find((v) => v.type === "input" && v.props && v.props.type === "file");
  if (!hit) throw new Error("the row renders no file picker");
  return hit;
}

test("a refused hardware apply shows the error's message, not its string form", async () => {
  await reset();
  const w = refusedAt(ENGINE, DETAIL);
  const { seen } = renderTree(html`<${HardwareCard} />`);
  const click = /** @type {() => unknown} */ (marked(seen, "hw-apply").props.onClick);
  await click();
  await quiesce(w);
  assert.equal(carries(statusText(renderTree(html`<${HardwareCard} />`).out), DETAIL), MESSAGE);
});

test("a refused backup restore shows the error's message, not its string form", async () => {
  await reset();
  const w = refusedAt(RESTORE, DETAIL);
  const { seen } = renderTree(html`<${BackupRestoreRow} />`);
  const target = { files: [new File(["<config/>"], "backup.xml", { type: "text/xml" })], value: "backup.xml" };
  const change = /** @type {(e: unknown) => unknown} */ (filePicker(seen).props.onChange);
  await change({ target, currentTarget: target });
  await quiesce(w);
  assert.equal(carries(statusText(renderTree(html`<${BackupRestoreRow} />`).out), DETAIL), MESSAGE);
});

// --- A failure from HQPTuner's own side wears the operation's prefix --------------
//
// A failure that carries no backend sentence, HQPTuner not reachable at all or a
// failed response with no usable detail, is shown behind a prefix naming the
// operation that failed. The prefix is owner copy and is never spelled here
// (docs/testing.md rule 9). What follows it is the client's own description of
// the failure, read off the client's public surface over the same wire: an
// unreachable backend and an unexplained status each read the same from any
// endpoint (tests/js/lib/api.test.js), so `api.status()` gives the message the
// card's own call rejects with. These cases pin that the card puts something in
// front of that message.

//: The browser's wording for a fetch that never reached HQPTuner.
const NETWORK_ERROR = "Failed to fetch";

//: A server error whose body is not JSON at all, so it has no usable detail.
const UNEXPLAINED = 503;

/** @typedef {() => import("../../support/wire/wire.js").FakeResponse | Promise<never>} Failure */

//: HQPTuner not reachable: the request rejects before any response.
/** @type {Failure} */
const unreachable = () => Promise.reject(new TypeError(NETWORK_ERROR));

//: A failed response with no usable detail.
/** @type {Failure} */
const unexplained = () => bad(UNEXPLAINED);

/**
 * A wire on which every request to `path` fails as `failure` does; every other
 * path is answered.
 *
 * @param {string} path
 * @param {Failure} failure
 */
const failingAt = (path, failure) =>
  stagingWire({
    routes: (asked) => (asked === path ? failure() : undefined),
  });

/**
 * The message the client rejects with when a request fails as `failure` does.
 *
 * @param {Failure} failure
 * @returns {Promise<string>}
 */
async function clientMessage(failure) {
  failingAt("/api/status", failure);
  const outcome = await api.status().then(
    () => null,
    (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e)),
  );
  if (outcome === null) throw new Error("the client resolved; there is no rejection to read");
  return outcome;
}

/**
 * How many characters a status line carries in front of `message`, or -1 when
 * the line does not end with it.
 *
 * @param {string | null} said
 * @param {string} message
 * @returns {number}
 */
const lengthBefore = (said, message) => (said !== null && said.endsWith(message) ? said.length - message.length : -1);

/**
 * Click the card's apply and read the status line once the wire is quiet.
 *
 * @param {import("../../support/wire/wire.js").StagingWire} w
 * @returns {Promise<string | null>}
 */
async function hardwareApplyStatus(w) {
  const { seen } = renderTree(html`<${HardwareCard} />`);
  const click = /** @type {() => unknown} */ (marked(seen, "hw-apply").props.onClick);
  await click();
  await quiesce(w);
  return statusText(renderTree(html`<${HardwareCard} />`).out);
}

/**
 * Pick a backup file in the restore row and read the status line once the wire
 * is quiet.
 *
 * @param {import("../../support/wire/wire.js").StagingWire} w
 * @returns {Promise<string | null>}
 */
async function restoreStatus(w) {
  const { seen } = renderTree(html`<${BackupRestoreRow} />`);
  const target = { files: [new File(["<config/>"], "backup.xml", { type: "text/xml" })], value: "backup.xml" };
  const change = /** @type {(e: unknown) => unknown} */ (filePicker(seen).props.onChange);
  await change({ target, currentTarget: target });
  await quiesce(w);
  return statusText(renderTree(html`<${BackupRestoreRow} />`).out);
}

test("a hardware apply that cannot reach HQPTuner is reported behind the operation's prefix", async () => {
  await reset();
  const message = await clientMessage(unreachable);
  const said = await hardwareApplyStatus(failingAt(ENGINE, unreachable));
  assert.ok(lengthBefore(said, message) > 0, String(said));
});

test("a hardware apply refused with no usable detail is reported behind the operation's prefix", async () => {
  await reset();
  const message = await clientMessage(unexplained);
  const said = await hardwareApplyStatus(failingAt(ENGINE, unexplained));
  assert.ok(lengthBefore(said, message) > 0, String(said));
});

test("a backup restore that cannot reach HQPTuner is reported behind the operation's prefix", async () => {
  await reset();
  const message = await clientMessage(unreachable);
  const said = await restoreStatus(failingAt(RESTORE, unreachable));
  assert.ok(lengthBefore(said, message) > 0, String(said));
});

test("a backup restore refused with no usable detail is reported behind the operation's prefix", async () => {
  await reset();
  const message = await clientMessage(unexplained);
  const said = await restoreStatus(failingAt(RESTORE, unexplained));
  assert.ok(lengthBefore(said, message) > 0, String(said));
});
