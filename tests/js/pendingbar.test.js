// Behavioral suite for components/PendingBar.js — the pending-changes footer.
// Written BEFORE the complexity refactor of PendingBar (13) and statusLine (13).
//
// `statusLine` is private and stays that way: it is a pure function of six
// values that are all exported store signals, so every one of its branches is
// reachable through the rendered bar.
//
// The bar's whole job is to explain WHY Apply is enabled or not, so a disabled
// button never reads as a hung one. These assertions are on that explanation —
// the status text, the button labels, and the disabled attributes — rather than
// on any internal flag.
//
// Staged counts cannot be assigned: stagedCount and split are computed over the
// schema and the staged buffer, so cases that need them stage real edits through
// `edit()` against a faked wire (docs/testing.md rule 4).
//
// The bar asks for a new preset's name, and for permission to overwrite an
// existing one, inline (store/ask.js) rather than through the native
// prompt()/confirm(). What is asserted about that here is only what a user can
// see: the question the bar is asking is on screen, it offers a way out, and it
// leaves the screen when answered or withdrawn — never the resolved value, the
// markup's class names, or which component the question is routed to. Those are
// this week's implementation and would red the suite on a refactor that changed
// no behavior.
//
// NOT reachable, deliberately untested: the "Save as New…" chain end to end —
// click → name field → overwrite confirm → savePresetOnly, and the wire silence
// that must follow a cancel at either step. render-to-string attaches no
// handlers, so the button's onClick never runs, the field's Enter/Escape keys
// never fire, and `autofocus` has no browser to act on. That chain — the
// assertion actually worth having — belongs to the playwright hand-back
// protocol, not to a faked unit test (docs/testing.md, "Branches that cannot be
// reached").

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../hqptuner/static/lib/dom.js";
import { PendingBar } from "../../hqptuner/static/components/PendingBar.js";
import { askName, askConfirm, answer, cancel, clearRefusal } from "../../hqptuner/static/store/ask.js";
import {
  health,
  config,
  engineState,
  applying,
  lastApply,
  pendingPreset,
  discardAll,
  edit,
} from "../../hqptuner/static/store/state.js";
import { ok, staticWire } from "./wire.js";

function wire(staged = { live: {}, http: {} }) {
  staticWire(staged, (path) => {
    if (path === "/api/config") return ok({ data: config.value });
    if (path === "/api/matrix") return ok({ data: null });
  });
}

// Full reset every time — these signals outlive a test.
async function reset({ reachable = true, active = "", profiles = null } = {}) {
  wire();
  cancel();
  applying.value = false;
  lastApply.value = null;
  pendingPreset.value = null;
  health.value = { reachable };
  engineState.value = {};
  config.value = { fields: [{ name: "volume_max", value: "-3" }], file: {}, active, profiles };
  await discardAll();
}

// Rendered output with the two entity escapes decoded. The contract is the text
// a user reads — `switch to "Night"`, `Apply & Save` — not its HTML encoding.
const bar = () =>
  render(html`<${PendingBar} />`)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

// Stage one restart-lane edit, so stagedCount is 1 and split is 0 live / 1 restart.
async function stageOne() {
  wire({ live: {}, http: { volume_max: "-6" } });
  await edit("volume_max", "-6");
}

// Buttons in render order. Matching one by its label is not viable: "Apply" is a
// substring of "Apply & Save", and "Save" of both that and "Save as New".
// Positional, so these hold only while no question is open — the inline ask
// renders its own two buttons ahead of Discard.
const DISCARD = 0;
const APPLY = 1;
const SAVE = 2;
const SAVE_NEW = 3;

const buttons = (out) =>
  out
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);
const attrsOf = (b) => b.slice(0, b.indexOf(">"));
const disabled = (out, i) => attrsOf(buttons(out)[i]).includes("disabled");
const label = (out, i) => {
  const b = buttons(out)[i];
  return b.slice(b.indexOf(">") + 1).trim();
};

// --- the bar itself ---------------------------------------------------------

test("test_an_idle_bar_is_not_marked_active", async () => {
  await reset();
  assert.ok(bar().includes('class="pending-bar "'));
});

test("test_a_pending_bar_is_marked_active", async () => {
  await reset();
  await stageOne();
  assert.ok(bar().includes('class="pending-bar active"'));
});

test("test_an_idle_bar_shows_no_staged_count", async () => {
  await reset();
  assert.ok(bar().includes('<span class="count"></span>'));
});

test("test_a_staged_edit_is_counted", async () => {
  await reset();
  await stageOne();
  assert.ok(bar().includes("1 staged"));
});

// --- status line: idle and done ---------------------------------------------

test("test_an_idle_bar_says_there_is_nothing_pending", async () => {
  await reset();
  assert.ok(bar().includes("No pending changes"));
});

test("test_a_successful_apply_is_reported_with_a_tick", async () => {
  await reset();
  lastApply.value = { ok: true, text: "Applied 1 change" };
  assert.ok(bar().includes("✓"));
});

test("test_a_successful_apply_carries_the_ok_class", async () => {
  await reset();
  lastApply.value = { ok: true, text: "Applied 1 change" };
  assert.ok(bar().includes('class="note ok"'));
});

test("test_a_failed_apply_carries_the_error_class", async () => {
  await reset();
  lastApply.value = { ok: false, text: "Failed: filter" };
  assert.ok(bar().includes('class="note err"'));
});

test("test_a_failed_apply_shows_its_text", async () => {
  await reset();
  lastApply.value = { ok: false, text: "Failed: filter" };
  assert.ok(bar().includes("Failed: filter"));
});

test("test_a_prior_result_is_superseded_by_a_new_edit", async () => {
  await reset();
  lastApply.value = { ok: true, text: "Applied 1 change" };
  await stageOne();
  assert.equal(bar().includes("✓"), false);
});

// A failed apply KEEPS its staging, so "still pending" and "the last apply
// failed" are true at once. Showing only the pending line reads as if nothing
// had been tried — the reason the changes are still sitting there is the one
// thing the user cannot work out for themselves.
test("test_a_failed_apply_is_explained_while_its_changes_stay_staged", async () => {
  await reset();
  await stageOne();
  lastApply.value = { ok: false, text: "Config not applied (unconverged): volume_max" };
  assert.equal(bar().includes("Config not applied (unconverged): volume_max"), true);
});

test("test_a_failed_apply_still_shows_what_is_pending", async () => {
  await reset();
  await stageOne();
  lastApply.value = { ok: false, text: "Config not applied (unconverged): volume_max" };
  assert.equal(bar().includes("1 staged"), true);
});

// --- status line: in flight -------------------------------------------------

test("test_an_apply_in_flight_says_so", async () => {
  await reset();
  applying.value = true;
  assert.ok(bar().includes("Applying…"));
});

test("test_an_apply_carrying_a_restart_warns_that_the_daemon_restarts", async () => {
  await reset();
  await stageOne();
  applying.value = true;
  assert.ok(bar().includes("daemon restarting"));
});

test("test_a_preset_switch_in_flight_warns_that_the_daemon_restarts", async () => {
  await reset();
  pendingPreset.value = "Night";
  applying.value = true;
  assert.ok(bar().includes("daemon restarting"));
});

// --- status line: held ------------------------------------------------------

test("test_pending_changes_on_an_unreachable_daemon_are_reported_as_held", async () => {
  await reset({ reachable: false });
  await stageOne();
  assert.ok(bar().includes("changes held, Apply resumes on reconnect"));
});

test("test_a_held_bar_carries_the_warning_class", async () => {
  await reset({ reachable: false });
  await stageOne();
  assert.ok(bar().includes('class="note warn"'));
});

// --- status line: the live/restart split ------------------------------------

test("test_staged_edits_report_their_live_and_restart_split", async () => {
  await reset();
  await stageOne();
  assert.ok(bar().includes("0 live · 1 restart"));
});

test("test_a_pending_switch_is_named", async () => {
  await reset();
  pendingPreset.value = "Night";
  assert.ok(bar().includes('switch to "Night"'));
});

test("test_a_pending_switch_with_no_edits_reports_no_split", async () => {
  await reset();
  pendingPreset.value = "Night";
  assert.equal(bar().includes("restart"), false);
});

// --- Apply ------------------------------------------------------------------

test("test_apply_is_disabled_with_nothing_pending", async () => {
  await reset();
  assert.equal(disabled(bar(), APPLY), true);
});

test("test_apply_is_enabled_with_a_staged_edit_and_a_reachable_daemon", async () => {
  await reset();
  await stageOne();
  assert.equal(disabled(bar(), APPLY), false);
});

test("test_apply_is_disabled_while_the_daemon_is_unreachable", async () => {
  await reset({ reachable: false });
  await stageOne();
  assert.equal(disabled(bar(), APPLY), true);
});

test("test_apply_is_disabled_while_an_apply_is_in_flight", async () => {
  await reset();
  await stageOne();
  applying.value = true;
  assert.equal(disabled(bar(), APPLY), true);
});

// --- Discard ----------------------------------------------------------------

test("test_discard_is_disabled_with_nothing_pending", async () => {
  await reset();
  assert.equal(disabled(bar(), DISCARD), true);
});

test("test_discard_is_enabled_with_a_staged_edit", async () => {
  await reset();
  await stageOne();
  assert.equal(disabled(bar(), DISCARD), false);
});

test("test_discard_stays_enabled_while_the_daemon_is_unreachable", async () => {
  // discarding is local — it needs no daemon
  await reset({ reachable: false });
  await stageOne();
  assert.equal(disabled(bar(), DISCARD), false);
});

// --- Save -------------------------------------------------------------------

test("test_the_save_button_reads_as_save_with_nothing_pending", async () => {
  await reset({ active: "Night" });
  assert.equal(label(bar(), SAVE), "Save");
});

test("test_the_save_button_reads_as_apply_and_save_with_edits_pending", async () => {
  await reset({ active: "Night" });
  await stageOne();
  assert.ok(bar().includes("Apply & Save"));
});

test("test_save_is_disabled_when_the_default_profile_is_the_only_target", async () => {
  // [default]'s snapshot is the working config, which a plain Apply already writes
  await reset({ active: "" });
  assert.equal(disabled(bar(), SAVE), true);
});

test("test_save_explains_why_it_is_disabled_on_the_default_profile", async () => {
  await reset({ active: "" });
  assert.ok(bar().includes("No named preset to save to ([default])"));
});

test("test_save_offers_to_persist_the_running_config_when_nothing_is_pending", async () => {
  await reset({ active: "Night" });
  assert.ok(bar().includes('Save the current settings to "Night"'));
});

test("test_save_offers_to_apply_and_save_when_edits_are_pending", async () => {
  await reset({ active: "Night" });
  await stageOne();
  assert.ok(bar().includes('Apply and save to "Night"'));
});

test("test_a_pending_switch_targets_the_previewed_preset_not_the_active_one", async () => {
  await reset({ active: "Day" });
  pendingPreset.value = "Night";
  assert.ok(bar().includes('Apply and save to "Night"'));
});

test("test_save_as_new_is_disabled_while_the_daemon_is_unreachable", async () => {
  await reset({ reachable: false });
  assert.equal(disabled(bar(), SAVE_NEW), true);
});

// --- asking, in the bar instead of in a native dialog -----------------------

const NAME_Q = "Save current settings as a new preset:";
const OVERWRITE_Q = 'Preset "Night" already exists. Overwrite it?';

test("test_the_bar_shows_the_name_it_is_asking_for", async () => {
  await reset();
  askName("pending", NAME_Q);
  assert.ok(bar().includes(NAME_Q));
});

test("test_a_question_offers_a_way_out", async () => {
  await reset();
  askName("pending", NAME_Q);
  assert.ok(bar().includes("Cancel"));
});

test("test_a_blank_name_does_not_dismiss_the_question", async () => {
  // refusing it in place is what stops a stray Enter saving a nameless preset
  await reset();
  askName("pending", NAME_Q);
  answer("   ");
  assert.ok(bar().includes(NAME_Q));
});

test("test_a_blank_name_says_why_it_was_refused", async () => {
  // a Save click that commits nothing and says nothing reads as a save that worked
  await reset();
  askName("pending", NAME_Q);
  answer("   ");
  assert.ok(bar().includes("Enter a name first"));
});

test("test_typing_again_withdraws_the_refusal", async () => {
  await reset();
  askName("pending", NAME_Q);
  answer("   ");
  clearRefusal();
  assert.equal(bar().includes("Enter a name first"), false);
});

test("test_a_named_answer_dismisses_the_question", async () => {
  await reset();
  askName("pending", NAME_Q);
  answer("Night");
  assert.equal(bar().includes(NAME_Q), false);
});

test("test_withdrawing_dismisses_the_name_question", async () => {
  await reset();
  askName("pending", NAME_Q);
  cancel();
  assert.equal(bar().includes(NAME_Q), false);
});

test("test_the_bar_shows_the_overwrite_it_is_asking_about", async () => {
  await reset();
  askConfirm("pending", OVERWRITE_Q);
  assert.ok(bar().includes(OVERWRITE_Q));
});

test("test_withdrawing_dismisses_the_overwrite_question", async () => {
  await reset();
  askConfirm("pending", OVERWRITE_Q);
  cancel();
  assert.equal(bar().includes(OVERWRITE_Q), false);
});
