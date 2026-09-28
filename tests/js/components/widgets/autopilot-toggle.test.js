// Behavioral suite for components/widgets/AutopilotToggle.js: the state the row
// carries for each reading of /api/status and the descriptions preference.
//
// The state is read off the row's class tokens plus the checkbox's `checked`
// and `disabled` attributes.
//
// Run: node --test --import ./tests/js/support/vendor-resolve.js tests/js/components/widgets/autopilot-toggle.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { AutopilotToggle } from "../../../../hqptuner/static/components/widgets/AutopilotToggle.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { showDescriptions } from "../../../../hqptuner/static/store/ui/prefs.js";
import { elements } from "../../support/markup.js";

/**
 * The sorted state tokens of one render: every class token, and the checkbox's
 * boolean attributes.
 * @param {{ metering: boolean, autopilot: boolean }} status
 * @param {boolean} descriptions
 * @returns {string[]}
 */
function stateOf(status, descriptions) {
  engineStatus.value = status;
  showDescriptions.value = descriptions;
  const all = elements(render(html`<${AutopilotToggle} />`));
  const tokens = all.flatMap((e) => (/\bclass="([^"]*)"/.exec(e.attrs)?.[1] ?? "").split(/\s+/).filter(Boolean));
  const input = all.find((e) => e.name === "input")?.attrs ?? "";
  for (const flag of ["checked", "disabled"]) if (new RegExp(`\\b${flag}\\b`).test(input)) tokens.push(flag);
  return tokens.sort();
}

test("the row is grayed, checked and noted without metering, and plain with it", () => {
  const states = [
    stateOf({ metering: false, autopilot: true }, true),
    stateOf({ metering: true, autopilot: false }, false),
  ];
  engineStatus.value = null;
  showDescriptions.value = true;
  const stateBearing = new Set(["checked", "disabled", "field-gray-reason", "field-note"]);
  assert.deepEqual(
    states.map((tokens) => tokens.filter((t) => stateBearing.has(t))),
    [["checked", "disabled", "field-gray-reason", "field-note"], []],
  );
});
