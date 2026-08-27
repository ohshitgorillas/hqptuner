// Behavioral suite for the System tab's Hardware acceleration card
// (components/SystemHardware.js), covering the CLEAN half of its apply/revert
// contract: with nothing changed, the apply button carries no dirty marking,
// NEITHER button is disabled, and the status line renders with nothing to say.
//
// "Neither button is ever disabled" is the card's half of the product rule that
// user actions always proceed (CLAUDE.md), and the clean card is where it is
// reachable under SSR: an apply disabled for want of a change, and a revert
// disabled for want of anything to put back, would both show up here. The dirty
// half of the same rule is in tests/e2e/test_hwapply.py.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders the exported `HardwareCard` and reads the rendered markup. Controls are
// addressed by the `data-testid` each carries — machine identity, contract — and
// never by the words on them (rule 9); the dirty marking is read as the `primary`
// class token, which is contract too.
//
// NOT covered here, and deliberately so (docs/testing.md, "Branches that cannot
// be reached"): everything about the card being DIRTY. The card snapshots what it
// loaded from the daemon in `useEffect`, which `preact-render-to-string` never
// runs, and the six settings live in module-private signals with no public
// writer, so a rendered card here is always the unloaded, clean one. Reaching the
// dirty state would mean exporting a private signal to serve a test, which the
// policy forbids; those cases are in the browser suite,
// tests/e2e/test_hwapply.py, where the load really runs and a real edit really
// fires.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/hardware-apply.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { HardwareCard } from "../../../hqptuner/static/components/SystemHardware.js";
import { config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { stagingWire } from "../support/wire.js";
import { attr, classes, elements, hasAttr, text } from "../support/markup.js";

//: The dirty marking itself — a CSS class, contract (docs/testing.md rule 9).
const DIRTY = "primary";

//: The status line, by its own class — machine identity, like every other
//: selector here. What it says when it has something to say is the owner's copy
//: and is neither selected on nor asserted; that it is EMPTY on a card that has
//: applied nothing is behavior.
const STATUS = "hw-status";

//: The machine-readable outcome a status message carries, as class tokens beside
//: `hw-status`. Contract, like every other selector here. A card that has applied
//: nothing has no outcome to report, so it carries none of them — which is what
//: makes the outcome readable at all: a token that were always present would say
//: nothing.
const OUTCOMES = ["busy", "ok", "warn", "err"];

// Module-level signals outlive a case (docs/testing.md, harness facts), so every
// source this card could read is put back before each render rather than left at
// whatever the previous file wrote.
async function reset() {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  matrixConfig.value = { fields: [] };
  config.value = { fields: [], file: {}, active: "", profiles: null };
  await discardAll();
}

const card = () => render(html`<${HardwareCard} />`);

/**
 * The element carrying `data-testid="<id>"`, or undefined when the card renders none.
 *
 * @param {string} out
 * @param {string} id
 * @returns {import("../support/markup.js").MarkupElement | undefined}
 */
const marked = (out, id) => elements(out).find((el) => attr(el, "data-testid") === id);

/**
 * @param {string} out
 * @param {string} id
 * @returns {import("../support/markup.js").MarkupElement}
 */
function control(out, id) {
  const hit = marked(out, id);
  if (!hit) throw new Error(`the card renders no control marked "${id}"`);
  return hit;
}

/**
 * The card's status line, which is rendered whether or not it has anything to say.
 *
 * @param {string} out
 * @returns {import("../support/markup.js").MarkupElement}
 */
function statusLine(out) {
  const hit = elements(out).find((el) => classes(el).includes(STATUS));
  if (!hit) throw new Error("the card renders no status line");
  return hit;
}

test("an unchanged card leaves the apply button unmarked", async () => {
  await reset();
  assert.equal(classes(control(card(), "hw-apply")).includes(DIRTY), false);
});

test("the apply button is enabled on a card with nothing changed", async () => {
  await reset();
  assert.equal(hasAttr(control(card(), "hw-apply"), "disabled"), false);
});

test("the revert button is enabled on a card with nothing to revert", async () => {
  await reset();
  assert.equal(hasAttr(control(card(), "hw-revert"), "disabled"), false);
});

test("a card that has applied nothing renders an empty status line", async () => {
  await reset();
  assert.equal(text(statusLine(card())), "");
});

test("a card that has applied nothing renders a status line carrying no outcome", async () => {
  await reset();
  assert.deepEqual(
    classes(statusLine(card())).filter((token) => OUTCOMES.includes(token)),
    [],
  );
});
