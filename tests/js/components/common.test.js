// Behavioral suite for components/common.js — the shared tab-layout
// primitives every tab body is built from: Section (the tab wrapper) and Card,
// the one card component. A card handed a `collapse` handle grows a toggle head
// and a body that comes and goes; handed none, it is a plain titled group.
// There is no separate Collapsible component to test.
//
// Policy (docs/testing.md): public API only, one assertion per test. Both are
// exported, and a card's disclosure state is a pure function of the handle it
// is HANDED — collapseFrom() resolves the auto/override signal pair the caller
// owns — so the whole contract is reachable by rendering with signals the test
// owns. Nothing is stubbed and no module private is touched.
//
// NOT covered, because SSR never fires an event handler: the disclosure head's
// onClick, which flips the caller's `override` signal. Both states that toggle
// can produce ARE covered here, by handing the component an override already
// set; only the click itself belongs to the playwright hand-back protocol.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/common.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";
import { signal } from "@preact/signals";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Section, Card, collapseFrom } from "../../../hqptuner/static/components/common.js";

const KID = html`<p>kid</p>`;

// A collapsible rendered with the two signals its caller owns: `auto` is app
// state (which backend is selected, which output mode is running), `override` is
// the user's own toggle — null meaning "follow app state".
const disclosure = (auto, override = null) =>
  render(html`<${Card} title="ALSA Backend" collapse=${collapseFrom(signal(auto), signal(override))}>${KID}<//>`);

// --- section ------------------------------------------------------------------

test("test_a_section_wraps_the_tab_body", () => {
  assert.ok(render(html`<${Section}>${KID}<//>`).includes('<section class="tab-body">'));
});

test("test_a_section_keeps_its_children", () => {
  assert.ok(render(html`<${Section}>${KID}<//>`).includes("<p>kid</p>"));
});

// --- card ---------------------------------------------------------------------

test("test_a_card_shows_its_title_in_its_head", () => {
  assert.ok(render(html`<${Card} title="General">${KID}<//>`).includes('<div class="card-head">General</div>'));
});

test("test_a_card_keeps_its_children_in_its_body", () => {
  assert.ok(render(html`<${Card} title="General">${KID}<//>`).includes('<div class="card-body"><p>kid</p></div>'));
});

test("test_a_centered_card_marks_its_head_as_centered", () => {
  assert.ok(
    render(html`<${Card} title="Rate" center=${true}>${KID}<//>`).includes('<div class="card-head center">Rate</div>'),
  );
});

// --- collapsible --------------------------------------------------------------

test("test_a_collapsible_opens_when_app_state_says_it_should", () => {
  assert.ok(disclosure(true).includes('<section class="card open">'));
});

test("test_a_collapsible_closes_when_app_state_says_it_should", () => {
  assert.ok(disclosure(false).includes('<section class="card closed">'));
});

test("test_an_open_collapsible_renders_its_children", () => {
  assert.ok(disclosure(true).includes('<div class="card-body"><p>kid</p></div>'));
});

test("test_a_closed_collapsible_renders_no_children", () => {
  assert.equal(disclosure(false).includes("<p>kid</p>"), false);
});

test("test_a_manual_open_wins_over_a_closed_app_state", () => {
  assert.ok(disclosure(false, true).includes('<section class="card open">'));
});

test("test_a_manual_close_wins_over_an_open_app_state", () => {
  assert.ok(disclosure(true, false).includes('<section class="card closed">'));
});

test("test_an_open_collapsible_points_its_triangle_down", () => {
  assert.ok(disclosure(true).includes('<span class="tri">▾</span>'));
});

test("test_a_closed_collapsible_points_its_triangle_right", () => {
  assert.ok(disclosure(false).includes('<span class="tri">▸</span>'));
});

test("test_a_collapsible_names_itself_in_its_head", () => {
  assert.ok(disclosure(false).includes("</span> ALSA Backend</button>"));
});

test("test_a_closed_collapsible_still_offers_its_head_to_open_it", () => {
  assert.ok(disclosure(false).includes('<button type="button" class="card-head">'));
});
