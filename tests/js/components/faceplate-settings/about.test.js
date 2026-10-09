// Rendered suite for hqptuner/static/components/faceplate/settings/About.js, the settings page under the drawers: About
// HQPlayer (the engine identity windows read off the health payload, the backup download and the restore upload with its
// status line) and About HQPTuner (the version line and the prose with its two links).
//
// Driven at the wire: the health payload is assigned into `health` as the poll writes it, and a fetch fake answers the
// real REST paths and records every request (POST /api/restore for a restore, GET /api/health for the read-back after
// it). No store function is stubbed. The upload's change is fired through the renderer's vnode seam, since
// render-to-string fires no events. Identity values and the server's refusal are the fixture's own wire data; the backup
// controls are located by `data-testid`.
//
// The restore status lives in a module-private signal written only from the upload's handler, so it persists for the
// life of this file: the restore cases run last.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/about.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { About } from "../../../../hqptuner/static/components/faceplate/settings/About.js";
import { health } from "../../../../hqptuner/static/store/signals.js";
import { elements, attr, text, classes } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";
import { ok, bad } from "../../support/wire/wire.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {import("../../support/wire/wire.js").FakeResponse} FakeResponse */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** @type {{ path: string, method: string, body: unknown }[]} */
const CALLS = [];

/** The answer to a restore. @type {FakeResponse} */
let restoreAnswer = ok({ ok: true });

const PAYLOAD = {
  reachable: true,
  info: { product: "Signalyst HQPlayer Embedded", engine: "6.0.4", platform: "Linux" },
  release: "6.0.2",
  app_version: "9.8.7",
};

beforeEach(() => {
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string, body?: unknown }} */ opts = {}) => {
    CALLS.push({ path, method: opts.method || "GET", body: opts.body });
    if (path === "/api/restore") return restoreAnswer;
    if (path === "/api/health") return ok({ ...PAYLOAD });
    return ok({});
  };
  health.value = { ...PAYLOAD };
  restoreAnswer = ok({ ok: true });
  CALLS.length = 0;
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

/** Every element of the page as it renders now. */
const all = () => elements(render(html`<${About} />`));

/** The elements carrying a class. */
const withClass = (/** @type {string} */ cls) => all().filter((e) => classes(e).includes(cls));

/** The identity windows' values, in order. */
const values = () =>
  all()
    .filter((e) => e.name === "span" && classes(e).includes("v"))
    .map(text);

/**
 * The handler a vnode carrying a test id holds under a prop, or undefined when the page draws none.
 *
 * @param {string} testid
 * @param {string} prop
 * @returns {((e?: unknown) => unknown) | undefined}
 */
function handler(testid, prop) {
  const { seen } = renderTree(html`<${About} />`);
  const hit = seen.find((v) => v.props["data-testid"] === testid);
  const fn = hit?.props[prop];
  return typeof fn === "function" ? /** @type {(e?: unknown) => unknown} */ (fn) : undefined;
}

/** Fire the upload's change with one file, and wait for the restore to settle. */
async function upload(/** @type {File} */ file) {
  const onChange = handler("backup-upload", "onChange");
  if (onChange) await onChange({ target: { files: [file] } });
}

const zip = () => new File([new Uint8Array(8)], "hqplayerd.zip");

test("test_the_identity_windows_carry_the_health_payloads_values_in_order", () => {
  assert.deepEqual(values(), ["Signalyst HQPlayer Embedded", "6.0.2", "6.0.4", "Linux"]);
});

test("test_an_empty_health_payload_draws_no_identity_window", () => {
  health.value = {};
  assert.deepEqual(values(), []);
});

test("test_the_version_line_names_the_running_app_version", () => {
  assert.equal(withClass("cap").map(text).join(" ").includes("9.8.7"), true);
});

test("test_the_backup_download_points_at_the_backup_route", () => {
  assert.deepEqual(
    all()
      .filter((e) => attr(e, "data-testid") === "backup-download")
      .map((e) => attr(e, "href")),
    ["/api/backup"],
  );
});

test("test_the_state_export_download_points_at_the_state_export_route", () => {
  assert.deepEqual(
    all()
      .filter((e) => attr(e, "data-testid") === "state-export")
      .map((e) => attr(e, "href")),
    ["/api/state-export"],
  );
});

test("test_the_prose_links_open_ko_fi_and_the_mit_license_in_a_new_tab", () => {
  assert.deepEqual(
    all()
      .filter((e) => e.name === "a" && attr(e, "target") === "_blank")
      .map((e) => attr(e, "href"))
      .sort(),
    ["https://ko-fi.com/ohshitgorillas", "https://opensource.org/license/mit"],
  );
});

test("test_a_restore_posts_the_chosen_file_to_the_restore_route", async () => {
  const file = zip();
  await upload(file);
  assert.deepEqual(
    CALLS.filter((c) => c.method === "POST" && c.path === "/api/restore").map((c) =>
      c.body instanceof FormData ? c.body.get("cfgfile") : null,
    ),
    [file],
  );
});

test("test_a_refused_restore_prints_the_servers_reason", async () => {
  restoreAnswer = bad(500, "backup archive unreadable");
  await upload(zip());
  assert.equal(withClass("mnote").map(text).join(" ").includes("backup archive unreadable"), true);
});
