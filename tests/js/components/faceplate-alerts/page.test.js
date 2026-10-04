// Rendered suite for the section alert home on hqptuner/static/components/faceplate/Page.js: an alert homed on a page
// section prints its line in that section's header, one line per alert carrying its severity, and a section with no
// alert homed on it prints none.
//
// The wire is the seam, as tests/js/store/faceplate/alerts.test.js drives it: the state, enumerations, config and
// metadata payloads the shaper fit reads go in through the shared shaper-fit scenario builder, which raises a PCM
// ditherer below its floor, homed on Shaping. The preferences and the window are set as
// tests/js/components/faceplate/page.test.js sets them. Sections are told apart by `data-stage`; the lines' sentences
// are owner copy and are nowhere in this file.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/page.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Page } from "../../../../hqptuner/static/components/faceplate/Page.js";
import { matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { topOfPage, allowPinnedRates } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/view.js";
import { elements, attr, classes } from "../../support/markup.js";
import { reset, PCM_4X } from "../../support/shaperfit-fixtures.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

beforeEach(async () => {
  viewport.value = { w: 1080, h: 810 };
  matrixConfig.value = { fields: [{ name: "enabled", value: true }] };
  topOfPage.value = "auto";
  allowPinnedRates.value = false;
  await reset({ chain: "pcm", mode: "1", pcmRate: PCM_4X });
});

/**
 * The alert lines in one section's header, in document order, or a string naming the stage when the page has no such
 * section or the section no header, so a missing header never reads as an empty one.
 *
 * @param {string} stage
 * @returns {MarkupElement[] | string}
 */
function headLines(stage) {
  const sec = elements(render(html`<${Page} />`)).find((e) => e.name === "section" && attr(e, "data-stage") === stage);
  if (!sec) return `no ${stage} section`;
  const head = elements(sec.html).find((e) => classes(e).includes("sh"));
  if (!head) return `no ${stage} header`;
  return elements(head.html)
    .filter((e) => classes(e).includes("aline"))
    .sort((a, b) => a.start - b.start);
}

test("test_a_ditherer_below_its_floor_prints_one_line_in_the_shaping_header", () => {
  const lines = headLines("shaping");
  assert.equal(typeof lines === "string" ? lines : lines.length, 1);
});

test("test_the_shaping_header_line_carries_the_alerts_severity", () => {
  const lines = headLines("shaping");
  const first = typeof lines === "string" ? undefined : lines[0];
  assert.equal(first ? attr(first, "data-sev") : lines, "warn");
});

test("test_the_resampling_header_holds_no_alert_line", () => {
  const lines = headLines("resampling");
  assert.equal(typeof lines === "string" ? lines : lines.length, 0);
});
