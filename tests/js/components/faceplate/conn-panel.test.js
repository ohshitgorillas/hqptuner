// Rendered suite for hqptuner/static/components/faceplate/ConnPanel.js, the connection panel as a faceplate sheet: the
// aside is always drawn and carries `data-closed` while the panel is shut, and open it holds the host, username and
// password fields, the remember choice, the verdict on the last Connect, the link to the daemon's own page, Connect,
// and the same-machine host fills.
//
// A fetch fake answers the real REST paths with their real shapes and records every request; no store function is
// stubbed. Taps are fired through the renderer's vnode seam, since render-to-string fires no events.
//
// Not reachable here: Escape closing the panel and the first field taking focus on open, which run in an effect that
// server rendering never runs. A browser run closes that gap.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/conn-panel.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { ConnPanel } from "../../../../hqptuner/static/components/faceplate/ConnPanel.js";
import {
  setupOpen,
  form,
  pageHost,
  verdict,
  hostTouched,
  closeSetup,
} from "../../../../hqptuner/static/store/setup.js";
import { elements, attr, hasAttr } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";
import { ok, bad } from "../../support/wire/wire.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

const OPEN = setupOpen.value;
const FORM = form.value;
const PAGE_HOST = pageHost.value;
const VERDICT = verdict.value;
const HOST_TOUCHED = hostTouched.value;

/** @type {{ path: string, method: string, body: Record<string, unknown> | null }[]} */
const CALLS = [];

/**
 * The answer to one request: the connection read and save, the discovery sweep and the health poll, in their real
 * shapes.
 *
 * @param {string} path
 * @param {string} method
 */
function answer(path, method) {
  if (path === "/api/connection" && method === "POST") return ok({ lane: "ok" });
  if (path === "/api/connection") return ok({ host: "", username: "", remember: true, has_password: false });
  if (path === "/api/discover") return ok([]);
  if (path === "/api/health") return ok({ reachable: true, ready: true, connected: true, info: {} });
  return bad(404, "Not Found");
}

beforeEach(() => {
  CALLS.length = 0;
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string, body?: string }} */ opts = {}) => {
    const method = opts.method || "GET";
    CALLS.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null });
    return answer(path, method);
  };
});

afterEach(() => {
  closeSetup();
  setupOpen.value = OPEN;
  form.value = FORM;
  pageHost.value = PAGE_HOST;
  verdict.value = VERDICT;
  hostTouched.value = HOST_TOUCHED;
  env.fetch = REAL_FETCH;
});

/**
 * The rendered sheet. Raises when the markup carries none.
 *
 * @returns {MarkupElement}
 */
const sheet = () => {
  const aside = elements(render(html`<${ConnPanel} />`)).find(
    (e) => e.name === "aside" && attr(e, "data-testid") === "conn-panel",
  );
  if (!aside) throw new Error('the markup carries no aside[data-testid="conn-panel"]');
  return aside;
};

/** The inputs inside the sheet, in document order. */
const inputs = () => elements(sheet().html).filter((e) => e.name === "input");

/** The host name the daemon-auth-link anchor points at, or undefined when the sheet carries no such anchor. */
const authLinkHostname = () => {
  const link = elements(sheet().html).find((e) => attr(e, "data-testid") === "daemon-auth-link");
  const href = link && attr(link, "href");
  return href ? new URL(href).hostname : undefined;
};

/**
 * Tap the first control the predicate picks from every vnode the panel builds. Taps nothing when the panel draws no
 * such control.
 *
 * @param {(v: VNode) => boolean} pick
 */
async function tap(pick) {
  const { seen } = renderTree(html`<${ConnPanel} />`);
  const hit = seen.find(pick);
  const onClick = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (typeof onClick === "function") await onClick();
}

/** The requests the wire saw for a method and a path. */
const sent = (/** @type {string} */ method, /** @type {string} */ path) =>
  CALLS.filter((c) => c.method === method && c.path === path);

test("test_the_closed_sheet_carries_data_closed", () => {
  setupOpen.value = false;
  assert.equal(hasAttr(sheet(), "data-closed"), true);
});

test("test_the_open_sheet_does_not_carry_data_closed", () => {
  setupOpen.value = true;
  assert.equal(hasAttr(sheet(), "data-closed"), false);
});

test("test_the_open_sheet_is_a_dialog", () => {
  setupOpen.value = true;
  assert.equal(attr(sheet(), "role"), "dialog");
});

test("test_the_open_sheet_holds_host_username_password_and_two_remember_radios_in_order", () => {
  setupOpen.value = true;
  assert.deepEqual(
    inputs().map((e) => (attr(e, "type") === "radio" ? `radio:${attr(e, "name")}` : attr(e, "type"))),
    ["text", "text", "password", "radio:setup-remember", "radio:setup-remember"],
  );
});

test("test_a_refused_verdict_marks_the_sheet_refused", () => {
  setupOpen.value = true;
  verdict.value = "refused";
  assert.equal(attr(sheet(), "data-verdict"), "refused");
});

test("test_a_host_field_naming_the_server_machine_links_the_daemon_page_through_the_page_host", () => {
  setupOpen.value = true;
  form.value = { ...FORM, host: "host.docker.internal" };
  pageHost.value = "192.168.1.40";
  assert.equal(authLinkHostname(), "192.168.1.40");
});

test("test_tapping_connect_posts_the_host_field_to_the_connection_route", async () => {
  setupOpen.value = true;
  form.value = { ...FORM, host: "10.0.0.5" };
  await tap((v) => v.props["data-testid"] === "conn-connect");
  assert.deepEqual(
    sent("POST", "/api/connection").map((c) => c.body?.host),
    ["10.0.0.5"],
  );
});

test("test_tapping_a_same_machine_fill_writes_its_address_into_the_host_field", async () => {
  setupOpen.value = true;
  await tap((v) => v.props["data-host"] === "127.0.0.1");
  assert.equal(form.value.host, "127.0.0.1");
});
