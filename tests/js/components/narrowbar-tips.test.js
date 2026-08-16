// The owner-approved explainers the narrow bar's stage groups carry
// (components/narrowbar/Stages.js), pinned character for character.
//
// User-facing text is owner-approved and verbatim: it ships as written, with no
// additions, trims or "improvements" (CLAUDE.md, binding product rules). These
// two cases are the copy's own gate — a reworded tip fails here, whatever else
// still renders.
//
// Kept in their own file, away from the render suites: an export that is missing
// or renamed is a link error for the whole module, and that failure belongs to
// the copy rather than to the bar's markup.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-tips.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { LOSSY_TIP, SRC_FORMAT_TIP } from "../../../hqptuner/static/components/narrowbar/Stages.js";

// Straight double quotes around the two name fragments, no em dash anywhere.
const LOSSY =
  'This feature determines whether to show or hide filters capable of reducing ultrasonic noise (containing "hires" or "mp3/mqa" in the name) in the 1x filter dropdowns. At 1x rates, this only benefits lossy material like MP3 and MQA; lossless material contains no ultrasonic content to attenuate. Selecting "Lossless" hides these filters; "Lossy" shows them only.';

const SRC_FORMAT =
  'The vast majority of music is packaged as PCM: if you\'re using streaming services only, leave this setting alone. If you have a personal library with DSD files (*.DSF and *.DFF), select "+DSD" to show the chain settings for these sources as well.';

test("test_the_lossy_sources_explainer_reads_as_the_owner_approved_copy", () => {
  assert.equal(LOSSY_TIP, LOSSY);
});

test("test_the_source_format_explainer_reads_as_the_owner_approved_copy", () => {
  assert.equal(SRC_FORMAT_TIP, SRC_FORMAT);
});
