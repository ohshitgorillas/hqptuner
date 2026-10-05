// Behavioral suite for the header's mini spectrum: the three-band readout renders
// only while the advisor is offered.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/chrome/meter-access.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { MiniSpectrum } from "../../../../hqptuner/static/components/MiniSpectrum.js";

/**
 * Whether the `data-testid="mini-spectrum"` element renders at all for one
 * reading of /api/status.
 *
 * @param {{ advisor: boolean }} status
 * @returns {boolean}
 */
function rendersFor(status) {
  engineStatus.value = status;
  const out = render(html`<${MiniSpectrum} />`);
  engineStatus.value = null;
  return out.includes('data-testid="mini-spectrum"');
}

test("test_the_mini_spectrum_renders_only_while_the_advisor_is_on", () => {
  assert.deepEqual([rendersFor({ advisor: true }), rendersFor({ advisor: false })], [true, false]);
});
