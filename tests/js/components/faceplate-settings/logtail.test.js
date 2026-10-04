// Rendered suite for hqptuner/static/components/faceplate/settings/LogTail.js, the Logging drawer's live log tail block:
// the head with its Copy button, the paragraph beside it, and the pane printing the last lines of the daemon's log, or
// the failed request's line in the pane's place. What the pane holds is store/logtail.js's, pinned in
// tests/js/store/logtail.test.js; this suite covers what the block draws from it.
//
// Renders through preact-render-to-string, driven by assigning `logLines` and `logMessage`. Every line and message
// asserted is one the test put into those signals; the Copy button is found by its `data-copy` state.
//
// Not reachable here: the poll, which a `useEffect` keyed on the open drawer starts and clears, and the Copy button's
// Copied and Copy failed states, which a click sets through component state and a clock reverts. Server rendering runs
// no effects and keeps no state across renders, so neither the interval nor the label change can be observed. A
// browser run closes both.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/logtail.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { LogTailBlock } from "../../../../hqptuner/static/components/faceplate/settings/LogTail.js";
import { logLines, logMessage } from "../../../../hqptuner/static/store/logtail.js";
import { attr, classes, elements, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const SCHEMA = { id: "logging", title: "logging-title", aria: "logging", tabs: [] };
const HERE = { drawer: "logging", tab: "logging" };

const draw = () => elements(render(html`<${LogTailBlock} schema=${SCHEMA} here=${HERE} />`));

/**
 * The first element of the block with tag `name` carrying class `cls`.
 *
 * @param {string} name
 * @param {string} cls
 * @returns {MarkupElement | undefined}
 */
const first = (name, cls) =>
  draw()
    .filter((e) => e.name === name && classes(e).includes(cls))
    .sort((a, b) => a.start - b.start)[0];

/**
 * The lines the pane prints: its inner text split on newlines.
 *
 * @returns {string[]}
 */
function printed() {
  const pre = first("pre", "logtail");
  if (!pre) return [];
  return pre.html
    .replace(/^<pre[^>]*>/, "")
    .replace(/<\/pre>$/, "")
    .split("\n");
}

beforeEach(() => {
  logLines.value = [];
  logMessage.value = "";
});

test("test_the_pane_prints_each_log_line_on_its_own_line", () => {
  logLines.value = ["line-a", "line-b", "line-c"];
  assert.deepEqual(printed(), ["line-a", "line-b", "line-c"]);
});

test("test_a_failed_request_prints_its_message_in_the_pane_place", () => {
  logMessage.value = "tail-unreachable";
  const note = first("p", "mnote");
  assert.equal(note ? text(note) : "", "tail-unreachable");
});

test("test_the_head_offers_the_copy_button_at_rest", () => {
  const copy = draw().find((e) => e.name === "button" && attr(e, "data-copy") !== undefined);
  assert.equal(copy ? attr(copy, "data-copy") : undefined, "idle");
});

test("test_the_paragraph_beside_the_head_carries_text", () => {
  const man = first("div", "man");
  const para = man ? elements(man.html).find((e) => e.name === "p") : undefined;
  assert.notEqual(para ? text(para) : "", "");
});
