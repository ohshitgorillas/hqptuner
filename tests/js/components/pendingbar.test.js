// Behavioral suite for components/PendingBar.js — the pending-changes footer.
// Written BEFORE the complexity refactor of PendingBar (13) and statusLine (13).
//
// `statusLine` is private and stays that way: it is a pure function of store
// values that are all exported signals, so every one of its branches is
// reachable through the rendered bar.
//
// The bar's whole job is to explain WHY Apply is enabled or not, so a disabled
// button never reads as a hung one. These assertions are on the STATE behind
// that explanation — the bar's active marker, the status note's classes, the
// staged count, the disabled attributes — never on the sentence announcing it:
// the status lines are owner copy, reworded at will, and a test that pins them
// reds the gate on a copy edit while nothing behavioral moved.
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

import { html } from "../../../hqptuner/static/lib/dom.js";
import { PendingBar } from "../../../hqptuner/static/components/PendingBar.js";
import { askName, askConfirm, answer, cancel, clearRefusal } from "../../../hqptuner/static/store/ask.js";
import { health, config, engineState, pendingPreset } from "../../../hqptuner/static/store/signals.js";
import { applying, lastApply, discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { ok, staticWire } from "../support/wire.js";
import { elements, classes, attr } from "../support/markup.js";

function wire(staged = { live: {}, http: {} }) {
  staticWire(staged, (path) => {
    if (path === "/api/config") return ok({ data: config.value });
    if (path === "/api/matrix") return ok({ data: null });
    return undefined; // unhandled path: the wire's own fallback answers it
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

// The two buttons that carry a machine identity are addressed by it: Apply and
// Discard wear `data-testid` (docs/testing.md rule 9). The two Save buttons
// carry none, so they stay positional — which holds only while no question is
// open, since the inline ask renders its own two buttons ahead of Discard.
const DISCARD = "discard";
const APPLY = "apply";
const SAVE = 2;
const SAVE_NEW = 3;

/** @param {string} out */
const buttons = (out) =>
  out
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);
/** @param {string} b */
const attrsOf = (b) => b.slice(0, b.indexOf(">"));
/**
 * Whether the button at a position, or the one carrying a test id, renders
 * disabled.
 *
 * @param {string} out
 * @param {string | number} which
 */
const disabled = (out, which) => {
  const found =
    typeof which === "number"
      ? buttons(out)[which]
      : buttons(out).find((b) => attrsOf(b).includes(`data-testid="${which}"`));
  if (found === undefined) throw new Error(`the bar renders no "${which}" button`);
  return attrsOf(found).includes("disabled");
};
// The status span, found by its class — `muted` at rest, `note …` once an apply
// is in flight or concluded. Only the NUMBERS in it are ever asserted: the
// sentence wrapped around them is copy.
/** @param {string} out */
const statusText = (out) => {
  const m = /<span class="(?:muted|note[^"]*)">([^<]*)<\/span>/.exec(out);
  return m ? m[1] : "";
};
/** @param {string} out */
const statusNumbers = (out) => (statusText(out).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

// The inline question's own block, and the buttons it offers.
/** @param {string} out */
const askBlock = (out) => {
  const i = out.indexOf('<span class="ask">');
  return i < 0 ? "" : out.slice(i, out.indexOf('<span class="spacer">', i));
};

// The status note's class list, order-independent. The note carries `note` plus
// state modifiers; asking "is `busy` among them" is what the contract says,
// where matching an exact full class string would red on a reordering that
// changed nothing a user can see.
// The staged count as the bar reports it. The count rides its own `count` span,
// so the span is the handle and the number inside it is the contract — the
// wording wrapped around the number is owner copy and is never asserted.
/** @param {string} out */
const countSpan = (out) => (/<span class="count">([^<]*)<\/span>/.exec(out) || ["", ""])[1];
/** @param {string} out */
const stagedCount = (out) => Number((countSpan(out).match(/\d+/) || ["NaN"])[0]);

// The machine identity of the verdict the note is rendering: `data-outcome`
// carries the apply verdict's own `code`, which is what lets a reader tell
// WHICH outcome is on screen without reading the sentence announcing it (the
// sentence being owner copy — docs/testing.md rule 9). Undefined when the bar
// renders no note at all, which fails an equality rather than passing as "".
//
// Read off the ELEMENT rather than out of the raw tag text: a regex requiring
// `class=` to precede `data-outcome=` reds on a prop reorder in the component,
// which preserves behavior entirely.
/** @param {string} out */
const noteOutcome = (out) => {
  const note = elements(out).find((el) => classes(el).includes("note"));
  return note && attr(note, "data-outcome");
};

/** @param {string} out */
const noteClasses = (out) =>
  [...out.matchAll(/class="([^"]*)"/g)]
    .map((m) => m[1].split(/\s+/).filter(Boolean))
    .find((cs) => cs.includes("note")) ?? [];

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
  assert.equal(countSpan(bar()), "");
});

test("test_a_staged_edit_is_counted", async () => {
  await reset();
  await stageOne();
  assert.equal(stagedCount(bar()), 1);
});

// --- status line: idle and done ---------------------------------------------
//
// That an idle bar differs from a pending one is pinned structurally above, by
// the bar's own `active` marker and by the empty count; the sentence it prints
// while idle is copy and is not asserted.

test("test_a_successful_apply_carries_the_ok_class", async () => {
  await reset();
  lastApply.value = { ok: true, code: "applied", text: "Applied 1 change" };
  assert.ok(bar().includes('class="note ok"'));
});

test("test_a_failed_apply_carries_the_error_class", async () => {
  await reset();
  lastApply.value = { ok: false, code: "live-failed", text: "Failed: filter" };
  assert.ok(bar().includes('class="note err"'));
});

test("test_a_failed_apply_shows_its_text", async () => {
  await reset();
  lastApply.value = { ok: false, code: "live-failed", text: "Failed: filter" };
  assert.ok(bar().includes("Failed: filter"));
});

// --- status line: which outcome is on screen --------------------------------
//
// `ok`/`err` says only whether the apply worked; `data-outcome` says WHICH
// verdict produced the note, and it is the only observable that does — the
// sentence beside it is copy. So the wiring from the verdict the store
// published to the attribute the bar renders is pinned per code, on the real
// codes store/actions.js publishes (tests/js/store/store.test.js): a bar
// rendering one constant, or the `ok` flag, or nothing at all, fails here while
// every class assertion above stays green.
/** @type {[boolean, string][]} */
const VERDICTS = [
  [true, "switched"],
  [false, "live-failed"],
  [false, "live-unavailable"],
  [false, "persist-refused"],
  [false, "persist-error"],
  [false, "endpoint-missing"],
];

for (const [succeeded, code] of VERDICTS) {
  test(`test_a_concluded_apply_marks_the_note_with_its_${code.replace(/-/g, "_")}_verdict`, async () => {
    await reset();
    lastApply.value = { ok: succeeded, code, text: "Whatever the copy says" };
    assert.equal(noteOutcome(bar()), code);
  });
}

// A case stood here asserting that two failures wearing the same `err` class
// carry DIFFERENT outcomes. The sweep above already states it and states it more
// strongly: it pins four failure codes to four exact values, so a bar hardcoding
// one failure code fails there. `persist-error`, which that case was the only
// user of, is now one of the four.

test("test_a_prior_result_is_superseded_by_a_new_edit", async () => {
  await reset();
  lastApply.value = { ok: true, code: "applied", text: "Applied 1 change" };
  await stageOne();
  assert.equal(noteClasses(bar()).includes("ok"), false);
});

// A failed apply KEEPS its staging, so "still pending" and "the last apply
// failed" are true at once. Showing only the pending line reads as if nothing
// had been tried — the reason the changes are still sitting there is the one
// thing the user cannot work out for themselves.
test("test_a_failed_apply_is_explained_while_its_changes_stay_staged", async () => {
  await reset();
  await stageOne();
  lastApply.value = {
    ok: false,
    code: "persist-refused",
    text: "Config not applied (unconverged): volume_max",
  };
  assert.equal(bar().includes("Config not applied (unconverged): volume_max"), true);
});

test("test_a_failed_apply_still_shows_what_is_pending", async () => {
  await reset();
  await stageOne();
  lastApply.value = {
    ok: false,
    code: "persist-refused",
    text: "Config not applied (unconverged): volume_max",
  };
  assert.equal(stagedCount(bar()), 1);
});

// --- status line: in flight -------------------------------------------------
//
// An apply in flight is pinned by the `busy` marker on the status note and by
// Apply's disabled state, both below; the sentence announcing it is copy.

test("test_an_apply_carrying_a_restart_is_marked_as_restarting", async () => {
  await reset();
  await stageOne();
  applying.value = true;
  assert.equal(noteClasses(bar()).includes("restart"), true);
});

test("test_a_preset_switch_in_flight_is_marked_as_restarting", async () => {
  await reset();
  pendingPreset.value = "Night";
  applying.value = true;
  assert.equal(noteClasses(bar()).includes("restart"), true);
});

// --- status line: held ------------------------------------------------------
//
// Held is a state of its own — pending changes the daemon cannot take yet — and
// the bar marks it with the warning class asserted here. The sentence it prints
// alongside is copy.

test("test_a_held_bar_carries_the_warning_class", async () => {
  await reset({ reachable: false });
  await stageOne();
  assert.ok(bar().includes('class="note warn"'));
});

// --- status line: busy ------------------------------------------------------
//
// Only an apply that is still in flight is busy. A concluded apply — succeeded
// or failed — and a held bar are all resting states, and marking any of them
// busy would leave the bar reading as working when nothing is happening.

test("test_an_apply_in_flight_marks_the_status_note_busy", async () => {
  await reset();
  await stageOne();
  applying.value = true;
  assert.equal(noteClasses(bar()).includes("busy"), true);
});

test("test_a_successful_apply_does_not_leave_the_status_note_busy", async () => {
  await reset();
  lastApply.value = { ok: true, code: "applied", text: "Applied 1 change" };
  assert.equal(noteClasses(bar()).includes("busy"), false);
});

test("test_a_failed_apply_does_not_leave_the_status_note_busy", async () => {
  await reset();
  lastApply.value = { ok: false, code: "live-failed", text: "Failed: filter" };
  assert.equal(noteClasses(bar()).includes("busy"), false);
});

test("test_a_held_bar_is_not_marked_busy", async () => {
  await reset({ reachable: false });
  await stageOne();
  assert.equal(noteClasses(bar()).includes("busy"), false);
});

// --- status line: the live/restart split ------------------------------------

test("test_staged_edits_report_their_live_and_restart_split", async () => {
  // one restart-lane edit, none live: the two numbers are the contract, the
  // sentence they are formatted into is not
  await reset();
  await stageOne();
  assert.deepEqual(statusNumbers(bar()), [0, 1]);
});

test("test_a_pending_switch_names_its_target_preset", async () => {
  await reset();
  pendingPreset.value = "Night";
  assert.ok(statusText(bar()).includes("Night"));
});

// The "(no preset)" option's name is the empty string, so a truthiness test read
// it as nothing previewed and the bar went quiet about a switch it was about to
// make. Named presets keep their quotes; this one carries its own parentheses.
test("test_a_pending_switch_to_the_no_preset_option_still_marks_the_bar_pending", async () => {
  await reset({ active: "Night" });
  pendingPreset.value = "";
  assert.ok(bar().includes('class="pending-bar active"'));
});

test("test_a_pending_switch_with_no_edits_reports_no_split", async () => {
  await reset();
  pendingPreset.value = "Night";
  assert.deepEqual(statusNumbers(bar()), []);
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

test("test_save_is_disabled_when_no_preset_is_the_only_target", async () => {
  // "(no preset)" has no snapshot of its own: it is the working config, which a
  // plain Apply already writes
  await reset({ active: "" });
  assert.equal(disabled(bar(), SAVE), true);
});

// Falling through to the active preset here offered to save into the very preset
// the user was leaving.
test("test_a_previewed_no_preset_option_leaves_save_with_nothing_to_write_to", async () => {
  await reset({ active: "Night" });
  pendingPreset.value = "";
  assert.equal(disabled(bar(), SAVE), true);
});

// Which preset Save writes to is DATA — the name is read out of the button, the
// wording around it is not asserted.
test("test_save_targets_the_previewed_preset_not_the_active_one", async () => {
  await reset({ active: "Day" });
  pendingPreset.value = "Night";
  assert.ok(buttons(bar())[SAVE].includes("Night"));
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

test("test_a_question_offers_both_a_commit_and_a_way_out", async () => {
  await reset();
  askName("pending", NAME_Q);
  assert.equal(askBlock(bar()).split("<button").length - 1, 2);
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
  assert.ok(askBlock(bar()).includes('class="ask-refused"'));
});

test("test_typing_again_withdraws_the_refusal", async () => {
  await reset();
  askName("pending", NAME_Q);
  answer("   ");
  clearRefusal();
  assert.equal(askBlock(bar()).includes('class="ask-refused"'), false);
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
