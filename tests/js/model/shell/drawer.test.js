// Behavioral suite for hqptuner/static/model/shell/drawer.js: what a stage drawer decides, free of the DOM. When the apply
// group shows and is live, and when an edit anywhere in a drawer family stages the drawer.
//
// Every family member is one this file writes.
//
// Run: node --test tests/js/model/shell/drawer.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { applyPaint, isStaged } from "../../../../hqptuner/static/model/shell/drawer.js";

/** A dirty member and a clean one, for the family-wide staged state. */
const DIRTY = { hasDirty: () => true };
const CLEAN = { hasDirty: () => false };

test("test_apply_group_shows_with_staged_edits", () => {
  assert.equal(applyPaint(false, true).shown, true);
});

test("test_apply_group_shows_on_a_restart_tab_with_no_edits", () => {
  assert.equal(applyPaint(true, false).shown, true);
});

test("test_apply_group_hides_with_no_edits_and_no_restart", () => {
  assert.equal(applyPaint(false, false).shown, false);
});

test("test_apply_group_buttons_are_dead_with_no_edits", () => {
  assert.equal(applyPaint(true, false).live, false);
});

test("test_apply_group_buttons_are_live_with_staged_edits", () => {
  assert.equal(applyPaint(true, true).live, true);
});

test("test_a_drawer_with_its_own_dirty_row_is_staged", () => {
  assert.equal(isStaged(true, []), true);
});

test("test_an_edit_in_another_family_member_stages_this_drawer", () => {
  assert.equal(isStaged(false, [CLEAN, DIRTY]), true);
});

test("test_a_family_with_no_edits_is_not_staged", () => {
  assert.equal(isStaged(false, [CLEAN, CLEAN]), false);
});
