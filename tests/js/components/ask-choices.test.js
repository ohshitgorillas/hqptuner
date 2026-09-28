// The choices ask renders one checkbox per offered option, each carrying the
// checked state the asker gave it.

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Ask } from "../../../hqptuner/static/components/Ask.js";
import { askChoices, cancel } from "../../../hqptuner/static/store/ask.js";
import { attr, elements, hasAttr } from "../support/markup.js";

const OWNER = "ask-choices-test";

/** @type {ChoiceOption[]} */
const OPTIONS = [
  { value: "a", label: "A", checked: true, disabled: false },
  { value: "b", label: "B", checked: false, disabled: false },
];

test("each rendered checkbox carries its option's checked state, in option order", () => {
  askChoices(OWNER, "Pick", OPTIONS);
  const out = render(html`<${Ask} owner=${OWNER} />`);
  cancel();
  const checked = elements(out)
    .filter((el) => el.name === "input" && attr(el, "type") === "checkbox")
    .map((el) => hasAttr(el, "checked"));
  assert.deepEqual(
    checked,
    OPTIONS.map((o) => o.checked),
  );
});
