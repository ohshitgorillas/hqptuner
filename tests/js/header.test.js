// Behavioral suite for components/Header.js — the chrome header.
// Written BEFORE the complexity refactor of Header (20).
//
// The header is a pure function of four exported store signals (health,
// engineState, config, pendingPreset), so every branch it takes on its own data
// is reachable from outside. `head()` reassigns ALL FOUR on every call: module
// signals outlive a test, and a partial reset passes alone and fails in sequence.
//
// NOT reachable, deliberately untested: the module-private `pickStatus` signal
// ("Loading…" / "Deleting…" / "Failed: …"). It is written only by the select's
// onChange and the Delete button's onClick, and render-to-string fires no
// events, so its two consumers — the select's disabled attribute and the
// `.preset-status.muted` line — cannot be driven from the public surface.
// Exporting the signal to reach them would be testing the implementation.
//
// Same limit, same treatment for the delete confirmation (store/ask.js, inline
// instead of a native confirm()): the chain Delete-click → confirm →
// deletePreset, and the wire silence that must follow a cancel, needs real event
// dispatch and belongs to the playwright hand-back protocol. What is asserted
// here is only what a user can see — the question is on screen, and it leaves
// the screen when answered or withdrawn — never the resolved value or the
// markup's class names.
//
// Assertions read the rendered markup as a user sees it. Note that
// preact-render-to-string does NOT emit `value` on a <select>: it marks the
// matching <option selected> instead, so the picker's current value is asserted
// through `selected()`.

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../hqptuner/static/lib/dom.js";
import { Header } from "../../hqptuner/static/components/Header.js";
import { askConfirm, answer, cancel } from "../../hqptuner/static/store/ask.js";
import { health, engineState, config, pendingPreset } from "../../hqptuner/static/store/state.js";

// The contract is the text a user reads — `Delete preset "Night"` — not its
// HTML encoding.
const decode = (out) => out.replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const PROFILES = {
  value: "",
  options: [
    { value: "", label: "" },
    { value: "Day", label: "Day" },
    { value: "Night", label: "Night" },
  ],
};

// Full reset every time. `"key" in o` rather than a default so a case can pass
// an explicitly absent snapshot (health: null) and still hit the fallbacks.
function head(o = {}) {
  cancel();
  health.value = "health" in o ? o.health : { reachable: true, info: {} };
  engineState.value = "engine" in o ? o.engine : {};
  config.value = "config" in o ? o.config : { fields: [], active: o.active || "", profiles: o.profiles || null };
  pendingPreset.value = o.pending || null;
  return decode(render(html`<${Header} />`));
}

// Re-render without resetting, for the cases that ask a question first.
const again = () => decode(render(html`<${Header} />`));

// The three identity spans, in render order.
const NAME = 0;
const VERSION = 1;
const PLAYING = 2;

const daemon = (out) => out.split('<div class="daemon">')[1].split("</div>")[0];
const idents = (out) => [...daemon(out).matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

// An empty value renders as the bare attribute `<option value>`, and `selected`
// is emitted ahead of it, so the attributes are parsed rather than positional.
const options = (out) =>
  [...out.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map((m) => {
    const named = / value="([^"]*)"/.exec(m[1]);
    return { value: named ? named[1] : "", selected: m[1].includes("selected"), label: m[2] };
  });

const selected = (out) => (options(out).find((o) => o.selected) || {}).value;

// --- daemon identity --------------------------------------------------------

test("test_a_missing_health_snapshot_falls_back_to_the_default_daemon_name", () => {
  assert.equal(idents(head({ health: null }))[NAME], "hqplayerd");
});

test("test_a_health_snapshot_carrying_no_info_falls_back_to_the_default_daemon_name", () => {
  assert.equal(idents(head({ health: { reachable: true } }))[NAME], "hqplayerd");
});

test("test_the_reported_daemon_name_is_shown", () => {
  const out = head({ health: { reachable: true, info: { name: "hqplayerd6" } } });
  assert.equal(idents(out)[NAME], "hqplayerd6");
});

test("test_the_engine_version_is_shown_with_a_v_prefix", () => {
  const out = head({ health: { reachable: true, info: { engine: "5.10.0" } } });
  assert.equal(idents(out)[VERSION], "v5.10.0");
});

test("test_a_daemon_reporting_no_engine_version_shows_none", () => {
  assert.equal(idents(head())[VERSION], "");
});

// --- play state -------------------------------------------------------------

test("test_a_stopped_engine_reads_as_stopped", () => {
  assert.equal(idents(head({ engine: { state: "0" } }))[PLAYING], "Stopped");
});

test("test_a_paused_engine_reads_as_paused", () => {
  assert.equal(idents(head({ engine: { state: "1" } }))[PLAYING], "Paused");
});

test("test_a_playing_engine_reads_as_playing", () => {
  assert.equal(idents(head({ engine: { state: "2" } }))[PLAYING], "Playing");
});

test("test_a_stopping_engine_reads_as_stopping", () => {
  assert.equal(idents(head({ engine: { state: "3" } }))[PLAYING], "Stopping");
});

test("test_an_unrecognized_play_state_shows_no_label", () => {
  assert.equal(idents(head({ engine: { state: "9" } }))[PLAYING], "");
});

test("test_a_missing_engine_snapshot_shows_no_play_label", () => {
  assert.equal(idents(head({ engine: null }))[PLAYING], "");
});

// --- the preset picker ------------------------------------------------------

test("test_a_header_with_no_config_yet_shows_no_preset_picker", () => {
  assert.equal(head({ config: null }).includes("<select"), false);
});

test("test_a_config_carrying_no_profiles_shows_no_preset_picker", () => {
  assert.equal(head().includes("<select"), false);
});

test("test_every_stored_profile_gets_an_option", () => {
  assert.equal(options(head({ profiles: PROFILES })).length, 3);
});

test("test_a_nameless_profile_option_reads_as_the_default", () => {
  assert.equal(options(head({ profiles: PROFILES }))[0].label, "[default]");
});

test("test_the_active_preset_is_the_selected_option", () => {
  assert.equal(selected(head({ profiles: PROFILES, active: "Night" })), "Night");
});

test("test_the_form_default_is_selected_when_the_config_names_no_active_preset", () => {
  const profiles = { ...PROFILES, value: "Day" };
  assert.equal(selected(head({ profiles })), "Day");
});

test("test_a_previewed_preset_is_selected_over_the_active_one", () => {
  assert.equal(selected(head({ profiles: PROFILES, active: "Night", pending: "Day" })), "Day");
});

// --- delete -----------------------------------------------------------------

test("test_an_active_preset_offers_a_delete_button", () => {
  assert.ok(head({ profiles: PROFILES, active: "Night" }).includes('class="preset-del"'));
});

test("test_the_delete_button_names_the_active_preset", () => {
  const out = head({ profiles: PROFILES, active: "Night" });
  assert.ok(out.includes('Delete preset "Night"'));
});

test("test_the_delete_button_names_the_previewed_preset_over_the_active_one", () => {
  const out = head({ profiles: PROFILES, active: "Night", pending: "Day" });
  assert.ok(out.includes('Delete preset "Day"'));
});

test("test_the_default_preset_offers_no_delete_button", () => {
  assert.equal(head({ profiles: PROFILES }).includes('class="preset-del"'), false);
});

// --- confirming the delete, in the header instead of a native dialog --------

const DELETE_Q = 'Delete preset "Night"? This cannot be undone.';

test("test_the_header_shows_the_deletion_it_is_asking_about", () => {
  head({ profiles: PROFILES, active: "Night" });
  askConfirm("header", DELETE_Q);
  assert.ok(again().includes(DELETE_Q));
});

test("test_confirming_dismisses_the_delete_question", () => {
  head({ profiles: PROFILES, active: "Night" });
  askConfirm("header", DELETE_Q);
  answer();
  assert.equal(again().includes(DELETE_Q), false);
});

test("test_withdrawing_dismisses_the_delete_question", () => {
  head({ profiles: PROFILES, active: "Night" });
  askConfirm("header", DELETE_Q);
  cancel();
  assert.equal(again().includes(DELETE_Q), false);
});

// --- pending apply ----------------------------------------------------------

test("test_a_previewed_preset_is_marked_pending_apply", () => {
  assert.ok(head({ profiles: PROFILES, pending: "Day" }).includes("(pending apply)"));
});

test("test_an_active_preset_alone_is_not_marked_pending_apply", () => {
  assert.equal(head({ profiles: PROFILES, active: "Night" }).includes("(pending apply)"), false);
});

// --- status pill ------------------------------------------------------------

test("test_the_header_carries_the_connection_pill", () => {
  assert.ok(head().includes('class="pill pill-'));
});
