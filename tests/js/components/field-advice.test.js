// Behavioral suite for the Output-tab advisory notes.
//
// Four per-backend settings — the two DAC bit depths (alsa_bits / net_bits) and
// the two 48k DSD switches (alsa_anydsd / net_anydsd) — only bear on ONE output
// mode each, but the daemon still honors a write to them in the other mode. So
// they are NOT grayed: the control stays live and the field carries an advisory
// note beside the widget saying which mode the setting is relevant to.
//
// The observable contract is placement plus presence plus editability: the note
// sits INSIDE <div class="control">…</div>, carries the field-advice class
// (distinct from field-gray-reason), appears only in the mode the setting does
// not serve, and never stands in the way of staging an edit.
//
// Which mode a note NAMES is the owner's wording and is never asserted
// (docs/testing.md rule 9). It does not need to be: each control is pinned in
// both modes, so the two advisories are told apart by which mode raises which
// note. A bit-depth field advises under SDM and falls silent under PCM; a 48k
// DSD field does the opposite. Swapping the two notes fails four cases.
//
// Gap: the note's own styling and its position relative to the widget within the
// row are visual, not observable from SSR — they belong to the hand-back
// protocol rather than to this suite.

import test from "node:test";
import assert from "node:assert/strict";

import {
  reset,
  stageEdit,
  field,
  hasClass,
  advice,
  grayReason,
  controlRow,
  outsideControlRow,
  isDisabled,
} from "../support/field-harness.js";

// The control row of a rendered field. A field that renders none is a broken
// fixture rather than a case with nothing to say, so it raises here instead of
// reaching an assertion as an absence.
/** @param {string} out */
const row = (out) => {
  const found = controlRow(out);
  if (found === null) throw new Error("the rendered field encloses no control row");
  return found;
};

// ============================================================================
// the note appears in the mode the setting does not serve
// ============================================================================

test("test_bit_depth_advises_while_the_output_mode_is_sdm", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }] });
  assert.notEqual(advice(row(field("alsa_bits"))), null);
});

test("test_network_bit_depth_advises_while_the_output_mode_is_sdm", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }] });
  assert.notEqual(advice(row(field("net_bits"))), null);
});

test("test_48k_dsd_advises_while_the_output_mode_is_pcm", async () => {
  await reset({ fields: [{ name: "mode", value: "pcm" }] });
  assert.notEqual(advice(row(field("alsa_anydsd"))), null);
});

test("test_network_48k_dsd_advises_while_the_output_mode_is_pcm", async () => {
  await reset({ fields: [{ name: "mode", value: "pcm" }] });
  assert.notEqual(advice(row(field("net_anydsd"))), null);
});

// ============================================================================
// the note is absent in the mode the setting does serve
//
// The other half of each pairing above: every one of the four controls is
// pinned in BOTH modes, so which note a control raises is fixed by the mode
// that raises it rather than by anything either note says.
// ============================================================================

test("test_bit_depth_falls_silent_while_the_output_mode_is_pcm", async () => {
  await reset({ fields: [{ name: "mode", value: "pcm" }] });
  assert.equal(advice(field("alsa_bits")), null);
});

test("test_network_bit_depth_falls_silent_while_the_output_mode_is_pcm", async () => {
  await reset({ fields: [{ name: "mode", value: "pcm" }] });
  assert.equal(advice(field("net_bits")), null);
});

test("test_48k_dsd_falls_silent_while_the_output_mode_is_sdm", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }] });
  assert.equal(advice(field("alsa_anydsd")), null);
});

test("test_network_48k_dsd_falls_silent_while_the_output_mode_is_sdm", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }] });
  assert.equal(advice(field("net_anydsd")), null);
});

// ============================================================================
// an advisory replaces the gray reason — it never joins it
//
// The two are alternatives: a field that advises is a field that stayed live, so
// the old gray caption must be gone entirely. Rendering both would read as a
// disabled control that also claims to be editable.
// ============================================================================

test("test_an_advised_bit_depth_renders_no_gray_reason", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }] });
  assert.equal(grayReason(field("alsa_bits")), null);
});

test("test_an_advised_48k_dsd_renders_no_gray_reason", async () => {
  await reset({ fields: [{ name: "mode", value: "pcm" }] });
  assert.equal(grayReason(field("alsa_anydsd")), null);
});

// ============================================================================
// placement — beside the widget, not stacked under the field
// ============================================================================

test("test_the_advice_renders_nowhere_outside_the_control_row", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }] });
  assert.equal(advice(outsideControlRow(field("alsa_bits"))), null);
});

// ============================================================================
// an advised field stays live
// ============================================================================

test("test_bit_depth_stays_enabled_in_sdm_mode", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }] });
  assert.equal(isDisabled(field("alsa_bits")), false);
});

test("test_network_bit_depth_stays_enabled_in_sdm_mode", async () => {
  await reset({ fields: [{ name: "mode", value: "sdm" }] });
  assert.equal(isDisabled(field("net_bits")), false);
});

test("test_48k_dsd_stays_enabled_in_pcm_mode", async () => {
  await reset({ fields: [{ name: "mode", value: "pcm" }] });
  assert.equal(isDisabled(field("alsa_anydsd")), false);
});

test("test_network_48k_dsd_stays_enabled_in_pcm_mode", async () => {
  await reset({ fields: [{ name: "mode", value: "pcm" }] });
  assert.equal(isDisabled(field("net_anydsd")), false);
});

test("test_editing_bit_depth_in_sdm_mode_still_stages_the_new_value", async () => {
  await reset({
    fields: [
      { name: "mode", value: "sdm" },
      { name: "alsa_bits", value: "24" },
    ],
  });
  await stageEdit("alsa_bits", "20", { alsa_bits: "20" });
  assert.ok(hasClass(field("alsa_bits"), "dirty"));
});
