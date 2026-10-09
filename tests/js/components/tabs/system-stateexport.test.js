// Behavioral suite for the About card's maintenance row on the System tab: the
// row offers the state export as a download.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders the exported `System` and reads the rendered markup. The link is found
// by its `href`, the REST path it fetches, which is a wire identifier; the words
// on it are owner copy and are neither selected on nor asserted (rule 9).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/tabs/system-stateexport.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { System } from "../../../../hqptuner/static/components/tabs/SystemTab.js";
import {
  health,
  config,
  matrixConfig,
  metadata,
  engineState,
  enums,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../../hqptuner/static/store/ui/prefs.js";
import { stagingWire } from "../../support/wire/wire.js";
import { attr, elements, hasAttr } from "../../support/markup.js";

//: The REST path the state export is served from: wire identity.
const STATE_EXPORT = "/api/state-export";

// Module-level signals outlive a case (docs/testing.md, harness facts), so every
// source the tab could read is put back before each render.
async function reset() {
  stagingWire();
  health.value = { info: {}, license: null };
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  matrixConfig.value = { fields: [] };
  config.value = { fields: [], file: {}, active: "", profiles: null };
  await discardAll();
}

/**
 * Every anchor in a rendered fragment whose `href` is `path`.
 *
 * @param {string} out
 * @param {string} path
 * @returns {import("../../support/markup.js").MarkupElement[]}
 */
const linksTo = (out, path) => elements(out).filter((el) => el.name === "a" && attr(el, "href") === path);

test("the state export link carries the download attribute", async () => {
  await reset();
  const out = render(html`<${System} />`);
  assert.deepEqual(
    linksTo(out, STATE_EXPORT).map((el) => hasAttr(el, "download")),
    [true],
  );
});
