import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { api } from "../../../hqptuner/static/lib/api.js";
import { createConnPanel } from "../../../hqptuner/static/store/connpanel.js";
import { health } from "../../../hqptuner/static/store/signals.js";
import { panelOpen } from "../../../hqptuner/static/store/faceplate/view.js";
import { fakeClock } from "../support/clock.js";
import { stagingWire, quiesce, ok } from "../support/wire/wire.js";

const GENERATION = 29;
const ELAPSED = 60000;
const HOST = "192.0.2.42";
const EDITED_HOST = "192.0.2.63";
const PASSWORD = "fixture-password";
const PHASES = ["Down", "Reachable", "Ready", "Alarm"];
/** @type {{ fetch?: unknown }} */
const env = globalThis;
const originalFetch = env.fetch;
/** @type {(() => void)[]} */
let disposers = [];
/** @type {ReturnType<typeof stagingWire> | null} */
let activeWire = null;

afterEach(async () => {
  if (activeWire) await quiesce(activeWire);
  activeWire = null;
  for (const dispose of disposers) dispose();
  disposers = [];
  health.value = null;
  panelOpen.value = false;
  env.fetch = originalFetch;
});

function start() {
  health.value = null;
  panelOpen.value = false;
  const fake = fakeClock();
  const panel = createConnPanel({ clock: fake.clock, api });
  disposers.push(panel.initPanel());
  return { panel, fake };
}

/**
 * @param {string} phase
 * @param {boolean | null} credentials
 * @param {boolean | null} address
 */
function reading(phase, credentials, address) {
  health.value = {
    phase,
    generation: GENERATION,
    connected_at: null,
    credentials_ok: credentials,
    address_found: address,
  };
}

/** @returns {Record<string, unknown>[]} */
function wire() {
  /** @type {Record<string, unknown>[]} */
  const posts = [];
  const connection = { host: HOST, username: "fixture-user", remember: true, has_password: true };
  activeWire = stagingWire({
    routes: (path, opts) => {
      if (path === "/api/discover") {
        return ok([{ address: HOST, name: "fixture-daemon", version: "6", product: "Embedded", platform: "linux" }]);
      }
      if (path === "/api/connection" && opts.method === "POST") {
        posts.push(JSON.parse(String(opts.body)));
        return ok({ ...connection, lane: "ok" });
      }
      if (path === "/api/connection") return ok(connection);
      return undefined;
    },
  });
  return posts;
}

/** @type {{ name: string, credentials: boolean | null, address: boolean | null, open: boolean }[]} */
const VERDICTS = [
  { name: "rejected_credentials", credentials: false, address: true, open: true },
  { name: "rejected_credentials_with_unknown_address", credentials: false, address: null, open: true },
  { name: "address_not_found", credentials: true, address: false, open: true },
  { name: "address_not_found_with_unknown_credentials", credentials: null, address: false, open: true },
  { name: "both_rejected", credentials: false, address: false, open: true },
  { name: "both_accepted", credentials: true, address: true, open: false },
  { name: "host_found_without_credential_verdict", credentials: null, address: true, open: false },
  { name: "unknown_address_with_accepted_credentials", credentials: true, address: null, open: false },
  { name: "no_conclusive_dial", credentials: null, address: null, open: false },
];

for (const phase of PHASES) {
  for (const verdict of VERDICTS) {
    // Break: infer opening from phase, or treat an unknown verdict as rejection.
    test(`test_panel_opening_follows_${verdict.name}_even_when_phase_is_${phase}`, () => {
      start();
      wire();
      reading(phase, verdict.credentials, verdict.address);
      assert.equal(panelOpen.value, verdict.open);
    });
  }
}

for (const hadConnected of [false, true]) {
  // Break: a cold-page deadline opens the panel while the host is still found.
  test(`test_engine_down_never_opens_the_panel_after_a_long_wait_with_prior_connection_${hadConnected}`, () => {
    const { fake } = start();
    wire();
    if (hadConnected) reading("Ready", true, true);
    reading("Down", null, true);
    fake.advance(ELAPSED);
    reading("Down", null, true);
    assert.equal(panelOpen.value, false);
  });
}

// Break: the ever-connected latch suppresses a later address failure.
test("test_address_loss_opens_the_panel_after_a_successful_connection", () => {
  start();
  wire();
  reading("Ready", true, true);
  reading("Down", null, false);
  assert.equal(panelOpen.value, true);
});

// Break: constructing another panel resets or shares the first panel's form.
test("test_a_second_panel_keeps_the_first_panels_form_edits", () => {
  const { panel } = start();
  panel.form.value = { ...panel.form.value, host: EDITED_HOST };
  const other = createConnPanel({ clock: fakeClock().clock, api });
  other.form.value = { ...other.form.value, host: HOST };
  assert.equal(panel.form.value.host, EDITED_HOST);
});

for (const touched of [false, true]) {
  // Break: discovery overwrites typed hosts or refuses to fill untouched hosts.
  test(`test_discovery_respects_host_editing_${touched}`, async () => {
    const { panel } = start();
    wire();
    panel.form.value = { ...panel.form.value, host: EDITED_HOST };
    panel.hostTouched.value = touched;
    await panel.runDiscovery();
    assert.equal(panel.form.value.host, touched ? EDITED_HOST : HOST);
  });
}

for (const password of ["", PASSWORD]) {
  // Break: saving sends a blank password or drops a newly typed password.
  test(`test_save_preserves_password_intent_when_${password ? "typed" : "blank"}`, async () => {
    const { panel } = start();
    const posts = wire();
    panel.form.value = { ...panel.form.value, host: HOST, username: "fixture-user", password, remember: true };
    await panel.submitConnection();
    assert.deepEqual(
      posts.map((body) => body.password),
      [password || undefined],
    );
  });
}

// Break: the save request's acknowledgement is mistaken for a healthy daemon.
test("test_save_acknowledgement_keeps_the_panel_open_until_health_confirms", async () => {
  const { panel } = start();
  wire();
  panelOpen.value = true;
  panel.form.value = { ...panel.form.value, host: HOST, username: "fixture-user", password: PASSWORD, remember: true };
  await panel.submitConnection(true);
  assert.equal(panelOpen.value, true);
});
