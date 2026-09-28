// The warn ask renders its own box, marked as the warn kind, and a choices ask
// in the same slot does not.

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Ask } from "../../../hqptuner/static/components/Ask.js";
import { askChoices, askWarn, cancel } from "../../../hqptuner/static/store/ask.js";
import { classes, elements } from "../support/markup.js";

const OWNER = "ask-warn-test";

/** @param {string} out */
const hasWarnBox = (out) => elements(out).some((el) => classes(el).includes("ask-warn"));

test("only the warn kind renders the warn box", () => {
  askWarn(OWNER, "Sure?");
  const warn = render(html`<${Ask} owner=${OWNER} />`);
  askChoices(OWNER, "Pick", [{ value: "a", label: "A", checked: false, disabled: false }]);
  const choices = render(html`<${Ask} owner=${OWNER} />`);
  cancel();
  assert.deepEqual([hasWarnBox(warn), hasWarnBox(choices)], [true, false]);
});
