// Behavioral suite for the six card gate controls and the card subtitle that
// carries their prose.
//
// A gate is a boolean the whole card hangs off — crossfeed, DAC correction,
// loudness and the matrix engage or bypass a stage of the signal path;
// fixed volume and logging switch something outside it. Each renders as a
// two-choice segmented control rather than a checkbox, its manual prose moved
// off the row and onto the card's subtitle (`noteFor`).
//
// Policy (docs/testing.md): public API only, one assertion per test. Rows go
// through the exported `Field` on the shared harness, driven by the exported
// store signals carrying the daemon's own /config and /matrix form fields;
// staging rides `edit()` over the wire fake on the real REST paths
// (tests/js/wire.js). Nothing is stubbed and no module private is touched.
//
// The prose asserted on is prose THIS FILE supplies through the /api/metadata
// payload, never a string copied out of the shipped settings.json. Each gate's
// entry is written into all three tab groups (dsp / volume / system) because
// the group a given key is filed under is not part of the behaviour under test.
//
// NOT covered, because preact-render-to-string never fires an event handler:
// the click that a gate's segment performs. That the strip reports a change on
// click is segment.test.js's; that a staged "0" reads back as the off choice is
// covered here by staging through the store instead.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/card-gates.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";
import { signal } from "@preact/signals";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Card, collapseFrom } from "../../../hqptuner/static/components/tabs/common.js";
import { noteFor } from "../../../hqptuner/static/store/prose.js";
import { edit } from "../../../hqptuner/static/store/actions.js";
import { isDirty, stagedCount } from "../../../hqptuner/static/store/resolve.js";
import { reset, field, titleOf, grayReason, activeSegment } from "../support/field-harness.js";
import { stagingWire } from "../support/wire.js";

// --- the gates ----------------------------------------------------------------
// Baselines come from the daemon's own forms: the four signal-path gates from
// /matrix, the other two from /config (docs/protocol.md,
// docs/settings-classification.md).

const MATRIX_FIELD = {
  crossfeed_enabled: "post_bauer_enabled",
  dac_correction_enabled: "post_correction_enabled",
  loudness_enabled: "post_loudness_enabled",
  matrix_enabled: "enabled",
};

const SIGNAL_PATH = Object.keys(MATRIX_FIELD);
const SWITCHES = ["fixed_volume_enabled", "log_enabled"];
const GATES = [...SIGNAL_PATH, ...SWITCHES];

const CHOICES = {
  crossfeed_enabled: ["ENGAGE", "BYPASS"],
  dac_correction_enabled: ["ENGAGE", "BYPASS"],
  loudness_enabled: ["ENGAGE", "BYPASS"],
  matrix_enabled: ["ENGAGE", "BYPASS"],
  fixed_volume_enabled: ["ON", "OFF"],
  log_enabled: ["ON", "OFF"],
};

// --- metadata this suite owns ---------------------------------------------------

// A control does not always read its prose from an entry filed under its own
// key: where several controls share one piece of manual prose, or where the
// manual names the thing differently from the UI key, the control names another
// metadata key. `dac_correction_enabled` reads `dac_correction`; the other five
// gates read their own key. Metadata here is filed under the key each gate
// actually reads.
const META_KEY = { dac_correction_enabled: "dac_correction" };
const metaKey = (k) => META_KEY[k] || k;

const PROSE = Object.fromEntries(GATES.map((k) => [k, `${k} manual prose.`]));
const group = () => Object.fromEntries(GATES.map((k) => [metaKey(k), { label: k, tooltip: PROSE[k] }]));
const META = { settings: { dsp: group(), volume: group(), system: group() } };

// A volume control that is live, so loudness is not gated by a bypassed one
// (hqplayerd-readme.txt §1.11.2.1).
const FREE_VOLUME = { name: "fixed_volume_enabled", value: false };

// The /config form carries one entry per field name, so an override supplied by
// a case REPLACES the baseline entry of that name rather than following it: a
// list carrying the same name twice is not a form the daemon ever sends, and a
// test built on one would only be asserting how a duplicate gets resolved.
function formFields(baseline, overrides) {
  const fields = [...baseline];
  for (const f of overrides) {
    const at = fields.findIndex((existing) => existing.name === f.name);
    if (at < 0) fields.push(f);
    else fields[at] = f;
  }
  return fields;
}

async function gate(key, { on = true, desc = true, config = [] } = {}) {
  const own = { name: MATRIX_FIELD[key] || key, value: on };
  const signalPath = key in MATRIX_FIELD;
  await reset({
    meta: META,
    matrix: signalPath ? [own] : [],
    fields: formFields(signalPath ? [FREE_VOLUME] : [own], config),
    desc,
    keep: desc,
  });
  return field(key);
}

const segLabels = (out) => [...out.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].trim());

// ============================================================================
// a gate is a segmented control, never a checkbox
// ============================================================================

for (const key of GATES) {
  test(`test_the_${key}_gate_renders_a_segmented_control`, async () => {
    assert.ok((await gate(key)).includes('<span class="segment">'));
  });

  test(`test_the_${key}_gate_renders_no_checkbox`, async () => {
    assert.equal(/<input[^>]*type="checkbox"/.test(await gate(key)), false);
  });

  test(`test_the_${key}_gate_offers_exactly_two_choices`, async () => {
    assert.equal(segLabels(await gate(key)).length, 2);
  });

  // A gate row has no name column: the card's own title names it, so nothing
  // renders a <label> for the key. One exception below — the fixed-volume gate
  // shares its row with the level field, so it carries a name column.
  if (key !== "fixed_volume_enabled") {
    test(`test_the_${key}_gate_row_renders_no_label`, async () => {
      assert.equal(/<label[\s>]/.test(await gate(key)), false);
    });
  }
}

// The one gate WITH a name column: the fixed-volume gate sits beside the dBFS
// level on a shared row, so the row names the pair "Fixed level".
test("test_the_fixed_volume_enabled_gate_row_carries_a_fixed_level_label", async () => {
  assert.ok((await gate("fixed_volume_enabled")).includes("<label>Fixed level"));
});

// ============================================================================
// what the two choices are called
// ============================================================================

for (const key of SIGNAL_PATH) {
  test(`test_the_${key}_gate_is_labelled_engage_then_bypass`, async () => {
    assert.deepEqual(segLabels(await gate(key)), ["ENGAGE", "BYPASS"]);
  });
}

for (const key of SWITCHES) {
  test(`test_the_${key}_gate_is_labelled_on_then_off`, async () => {
    assert.deepEqual(segLabels(await gate(key)), ["ON", "OFF"]);
  });
}

// ============================================================================
// which choice is active
// ============================================================================

for (const key of GATES) {
  test(`test_an_on_${key}_activates_its_first_choice`, async () => {
    assert.equal(activeSegment(await gate(key, { on: true })), CHOICES[key][0]);
  });

  test(`test_an_off_${key}_activates_its_second_choice`, async () => {
    assert.equal(activeSegment(await gate(key, { on: false })), CHOICES[key][1]);
  });

  test(`test_staging_${key}_off_reads_back_as_the_off_choice`, async () => {
    await gate(key, { on: true });
    stagingWire();
    await edit(key, "0");
    assert.equal(activeSegment(field(key)), CHOICES[key][1]);
  });

  test(`test_staging_${key}_on_reads_back_as_the_on_choice`, async () => {
    await gate(key, { on: false });
    stagingWire();
    await edit(key, "1");
    assert.equal(activeSegment(field(key)), CHOICES[key][0]);
  });

  // The OTHER shape a gate baseline can arrive in — the wire strings "1"/"0"
  // rather than the parsed checkbox boolean. Both are real: the daemon's form
  // parser hands a checked checkbox over as `true`, while a staged edit and a
  // preset snapshot carry the string.

  test(`test_a_string_valued_on_${key}_activates_its_first_choice`, async () => {
    assert.equal(activeSegment(await gate(key, { on: "1" })), CHOICES[key][0]);
  });

  test(`test_a_string_valued_off_${key}_activates_its_second_choice`, async () => {
    assert.equal(activeSegment(await gate(key, { on: "0" })), CHOICES[key][1]);
  });
}

// ============================================================================
// a gate returned to its baseline is clean again
// ============================================================================

// The two domains a gate value lives in — the daemon's form parser hands a
// checked checkbox over as the boolean `true`, a staged edit carries the wire
// string "1" — meet in isDirty. A user who toggles a gate and toggles it back
// has changed nothing, so nothing may stay latched: neither isDirty for the key
// nor the count the pending-changes bar reads to decide whether to demand an
// Apply. Staging twice in sequence needs the wire that ACCUMULATES its buffer
// (tests/js/wire.js `stagingWire`), the way the server's pending buffer does.

for (const key of GATES) {
  test(`test_staging_${key}_off_against_an_on_baseline_reads_as_dirty`, async () => {
    await gate(key, { on: true });
    stagingWire();
    await edit(key, "0");
    assert.equal(isDirty(key), true);
  });

  test(`test_staging_${key}_on_against_an_off_baseline_reads_as_dirty`, async () => {
    await gate(key, { on: false });
    stagingWire();
    await edit(key, "1");
    assert.equal(isDirty(key), true);
  });

  test(`test_toggling_${key}_off_and_back_on_reads_clean`, async () => {
    await gate(key, { on: true });
    stagingWire();
    await edit(key, "0");
    await edit(key, "1");
    assert.equal(isDirty(key), false);
  });

  test(`test_toggling_${key}_on_and_back_off_reads_clean`, async () => {
    await gate(key, { on: false });
    stagingWire();
    await edit(key, "1");
    await edit(key, "0");
    assert.equal(isDirty(key), false);
  });

  // The OTHER baseline shape: the wire string "1" rather than the parsed
  // checkbox boolean. Both sides are asserted — a wire-string baseline that
  // never registered dirty at all would satisfy the clean case on its own.
  test(`test_staging_a_string_valued_${key}_off_reads_as_dirty`, async () => {
    await gate(key, { on: "1" });
    stagingWire();
    await edit(key, "0");
    assert.equal(isDirty(key), true);
  });

  test(`test_toggling_a_string_valued_${key}_off_and_back_on_reads_clean`, async () => {
    await gate(key, { on: "1" });
    stagingWire();
    await edit(key, "0");
    await edit(key, "1");
    assert.equal(isDirty(key), false);
  });

  // The pending-changes bar counts dirty keys, so a round trip must leave it
  // asking for nothing.
  //
  // `volume_fixed` (Auto headroom) is supplied because it and
  // fixed_volume_enabled are mutually exclusive fixed-volume modes: engaging the
  // gate deliberately stages a second, visible edit clearing volume_fixed to
  // "0". That is intended. With volume_fixed already false in the daemon's form
  // that second edit lands back on its own baseline and the count still falls to
  // zero; without the field in the form at all it would hold the count above
  // zero for reasons that have nothing to do with the gate.
  //
  // So the count is zero because every staged entry matches its baseline, NOT
  // because the staging buffer is empty — for fixed_volume_enabled a real
  // volume_fixed="0" edit is still sitting in it.
  test(`test_toggling_${key}_off_and_back_on_leaves_the_pending_count_at_zero`, async () => {
    await gate(key, { on: true, config: [{ name: "volume_fixed", value: false }] });
    stagingWire();
    await edit(key, "0");
    await edit(key, "1");
    assert.equal(stagedCount.value, 0);
  });

  test(`test_an_unstaged_${key}_gate_is_not_dirty`, async () => {
    await gate(key);
    assert.equal(isDirty(key), false);
  });
}

// ============================================================================
// the row's prose moved to the card
// ============================================================================

// The note's absence is read as the absence of the note class ANYWHERE in the
// row, not as the absence of one exact class attribute: a note rendered with an
// extra class alongside `field-note` is still a note on screen.
for (const key of GATES) {
  test(`test_the_${key}_gate_row_carries_no_inline_note`, async () => {
    assert.equal((await gate(key)).includes("field-note"), false);
  });

  test(`test_the_${key}_gate_row_carries_no_inline_note_with_descriptions_off`, async () => {
    assert.equal((await gate(key, { desc: false })).includes("field-note"), false);
  });

  test(`test_the_${key}_gate_row_hovers_its_manual_prose`, async () => {
    assert.equal(titleOf(await gate(key)), PROSE[key]);
  });
}

// ============================================================================
// a grayed gate still says why
// ============================================================================

// Volume-adaptive loudness cannot adapt to a pinned volume, so a fixed volume
// grays the loudness gate WITH a caption naming what bypassed it. The caption's
// exact wording is not part of the contract; that it names the volume control is.
const PINNED = [{ name: "fixed_volume_enabled", value: true }];

test("test_a_gate_grayed_by_a_bypassed_volume_control_names_it_in_the_caption", async () => {
  const reason = grayReason(await gate("loudness_enabled", { config: PINNED }));
  assert.match(String(reason), /volume/i);
});

test("test_a_gate_with_a_live_volume_control_carries_no_gray_caption", async () => {
  assert.equal(grayReason(await gate("loudness_enabled")), null);
});

// ============================================================================
// the card subtitle that now carries that prose
// ============================================================================

const KID = html`<p>kid</p>`;
const card = (props) => render(html`<${Card} title="Crossfeed" ...${props}>${KID}<//>`);
const headOf = (out) => {
  const body = out.indexOf('<div class="card-body"');
  return body < 0 ? out : out.slice(0, body);
};
const bodyOf = (out) => out.slice(out.indexOf('<div class="card-body"'));

const SUB = "Blends the channels the way a room would.";

test("test_a_card_subtitle_renders_at_the_top_of_the_body_before_the_children", async () => {
  const body = bodyOf(card({ subtitle: SUB }));
  assert.ok(body.indexOf(SUB) >= 0 && body.indexOf(SUB) < body.indexOf("<p>kid</p>"));
});

test("test_a_card_subtitle_is_not_rendered_in_the_head", async () => {
  assert.equal(headOf(card({ subtitle: SUB })).includes(SUB), false);
});

// No subtitle means no subtitle ELEMENT anywhere in the card — `.card-sub`
// (docs/design-system.md) is absent, not merely empty.
test("test_a_card_with_no_subtitle_renders_no_subtitle_element", async () => {
  assert.equal(card({}).includes("card-sub"), false);
});

test("test_an_empty_subtitle_renders_no_subtitle_element", async () => {
  assert.equal(card({ subtitle: "" }).includes("card-sub"), false);
});

const disclosure = (open) =>
  render(
    html`<${Card} title="Crossfeed" subtitle=${SUB} collapse=${collapseFrom(signal(open), signal(null))}>${KID}<//>`,
  );

test("test_an_open_collapsible_card_shows_its_subtitle_at_the_top_of_its_body", () => {
  const body = bodyOf(disclosure(true));
  assert.ok(body.indexOf(SUB) >= 0 && body.indexOf(SUB) < body.indexOf("<p>kid</p>"));
});

test("test_a_closed_collapsible_card_shows_no_subtitle", () => {
  assert.equal(disclosure(false).includes(SUB), false);
});

// ============================================================================
// noteFor — the prose a card subtitle is built from
// ============================================================================

test("test_note_for_returns_the_controls_own_manual_prose", async () => {
  await reset({ meta: META });
  assert.equal(noteFor("crossfeed_enabled"), PROSE.crossfeed_enabled);
});

test("test_note_for_returns_the_manual_prose_a_control_names_under_another_key", async () => {
  await reset({ meta: META });
  assert.equal(noteFor("dac_correction_enabled"), PROSE.dac_correction_enabled);
});

test("test_note_for_returns_nothing_with_descriptions_off", async () => {
  await reset({ meta: META, desc: false, keep: false });
  assert.equal(noteFor("crossfeed_enabled"), "");
});

test("test_note_for_returns_nothing_for_a_key_with_no_control", async () => {
  await reset({ meta: META });
  assert.equal(noteFor("no_such_control"), "");
});
