// Behavioral suite for the Easy Mode card's HELP PANEL: the card's subtitle
// carries an intro and, below it, a link; the panel is absent from the document
// until that link is pressed; pressing it again takes the panel away; and
// pressing it persists nothing.
//
// The harness is tests/js/support/easytiles.js — imported dynamically after
// `useStorage()` so that `store/easyview.js` meets the fake localStorage at its
// load-time read — plus tests/js/support/easyhelp.js for the panel's own readers
// and the press seam.
//
// NOTHING HERE READS COPY (docs/testing.md rule 9, and never owner copy
// verbatim). The link and the panel are found by the `data-testid` each carries,
// the card's subtitle by the `data-note="easy-notice"` marking
// tests/js/components/easymode.test.js already pins. What the intro says, what
// the link is captioned and what the panel explains are the owner's, and are
// asserted nowhere: what is asserted is that the subtitle shows something above
// the link, and how many panels the document carries.
//
// HOOKS THIS SUITE REQUIRES the implementation to provide:
//   * `data-testid="easy-help"` on the subtitle's link, carrying its own onClick
//   * `data-testid="easy-help-panel"` on the panel that link opens
//   * the open state observable across renders — a module-level signal, the way
//     `easyMode` is. SSR runs no effect and keeps no component
//     state between renders, so a panel held in `useState` cannot be seen to
//     open at all.
//
// NOT READ HERE: where the panel sits relative to the pending bar. The pending
// bar is a page-level footer rendered outside this card
// (tests/js/components/pendingbar.test.js renders it on its own), so the two
// never appear in one fragment and their order is a visual claim belonging to
// the hand-back rather than to SSR. What IS read is that a staged edit does not
// cost the card its panel.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-help.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const store = useStorage();

const { resetTab, flush, tabs, seenTabs, pressTile } = await import("../support/easytiles.js");
const { HELP_LINK, helpPanels, helpLinks, subtitleCarriesHelpLink, introPrecedesHelpLink, pressTestId, resetHelp } =
  await import("../support/easyhelp.js");

// The tile pressed to put an edit in the staging buffer. A preset id is a wire
// identifier.
const PRESET_TILE = "perfect-ten";

/**
 * The card, with every signal it reads put back — the panel's own included,
 * which a case that opened it would otherwise leave open for the next.
 *
 * @returns {Promise<import("../support/wire.js").StagingWire>}
 */
async function reset() {
  const w = await resetTab({ mode: "pcm" });
  resetHelp();
  return w;
}

/** One press on the help link, over a fresh render of the card. */
const pressHelp = () => pressTestId(seenTabs(), HELP_LINK);

/** Everything the fake localStorage is holding, as a comparable snapshot. */
const stored = () => [...store.map.entries()].sort();

// ============================================================================
// the subtitle
// ============================================================================

test("test_the_card_subtitle_offers_exactly_one_help_link", async () => {
  await reset();
  assert.equal(helpLinks(tabs()), 1);
});

test("test_the_help_link_stands_inside_the_cards_subtitle", async () => {
  await reset();
  assert.equal(subtitleCarriesHelpLink(tabs()), true);
});

// The intro comes first and the link below it: read as document order, which is
// the half of "on a line below" a rendering can answer. Where the two land on
// screen is CSS and belongs to the visual hand-back.

test("test_the_subtitle_shows_its_intro_before_the_help_link", async () => {
  await reset();
  assert.equal(introPrecedesHelpLink(tabs()), true);
});

// ============================================================================
// the panel comes and goes with the link
// ============================================================================

// The card draws no panel while the store says closed. That the store SAYS
// closed on a fresh load is a fact about the store and is pinned there, off a
// module instance nothing has written to (tests/js/store/easyview.test.js) —
// this case cannot pin it, because the reset above puts the signal down before
// every render.

test("test_the_card_carries_no_help_panel_while_the_store_says_closed", async () => {
  await reset();
  assert.equal(helpPanels(tabs()), 0);
});

test("test_pressing_the_help_link_puts_one_panel_in_the_document", async () => {
  await reset();
  pressHelp();
  assert.equal(helpPanels(tabs()), 1);
});

test("test_pressing_the_help_link_a_second_time_takes_the_panel_away", async () => {
  await reset();
  pressHelp();
  pressHelp();
  assert.equal(helpPanels(tabs()), 0);
});

// ============================================================================
// nothing is written down
// ============================================================================
//
// "Not persisted" read where a browser would keep it: the panel's state never
// reaches storage, so the next load of the page has no panel open however the
// last one was left. The whole store is compared rather than one key, because
// which key it would have been written under is the writer's business.

test("test_opening_the_help_panel_writes_nothing_to_storage", async () => {
  await reset();
  const before = stored();
  pressHelp();
  assert.deepEqual(stored(), before);
});

// ============================================================================
// with an edit staged
// ============================================================================
//
// The panel is opened FIRST and the edit staged under it, which is the order a
// user meets: a card that dropped the panel when the pending bar appeared fails
// here. Pressing the link after staging would only show that a panel can be
// opened while an edit is pending, which is a weaker claim and not the one the
// spec makes.

test("test_an_open_help_panel_survives_an_edit_being_staged", async () => {
  const w = await reset();
  pressHelp();
  pressTile(seenTabs(), PRESET_TILE);
  await flush(w);
  assert.equal(helpPanels(tabs()), 1);
});
