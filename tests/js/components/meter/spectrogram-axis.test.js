// Suite for the frequency gutter's ticks beside the METER page's spectrogram
// (components/meter/Spectrogram.js), on both scales and at more than one
// source Nyquist.
//
// Every case renders the exported `Spectrogram` and reads the gutter's
// `mt-spec-tick` spans by their inline `bottom: N%`, never by the label text a
// tick carries.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/meter/spectrogram-axis.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Spectrogram } from "../../../../hqptuner/static/components/meter/Spectrogram.js";
import { meterGeometry } from "../../../../hqptuner/static/store/meter/feed.js";
import { meterScale } from "../../../../hqptuner/static/store/ui/prefs.js";
import { elements, attr, classes } from "../../support/markup.js";

/**
 * Every frequency-axis tick's position, bottom to top, as the percentage its
 * inline style carries.
 *
 * @param {string} out
 * @returns {number[]}
 */
function tickPositions(out) {
  return elements(out)
    .filter((e) => e.name === "span" && classes(e).includes("mt-spec-tick"))
    .map((e) => Number((/bottom:\s*([\d.]+)%/.exec(attr(e, "style") || "") || [])[1]));
}

const spectrogram = () => render(html`<${Spectrogram} />`);

test("a log scale renders more frequency ticks than a linear scale at the same source nyquist", () => {
  meterGeometry.value = { nyquist: 22050 };
  meterScale.value = "log";
  const log = tickPositions(spectrogram()).length;
  meterScale.value = "linear";
  const linear = tickPositions(spectrogram()).length;
  assert.ok(log > linear);
});

test("raising the source nyquist adds a linear-scale tick", () => {
  meterScale.value = "linear";
  meterGeometry.value = { nyquist: 10000 };
  const narrow = tickPositions(spectrogram()).length;
  meterGeometry.value = { nyquist: 40000 };
  const wide = tickPositions(spectrogram()).length;
  assert.ok(wide > narrow);
});

test("a wider source nyquist sits a shared log tick lower on the axis", () => {
  meterScale.value = "log";
  meterGeometry.value = { nyquist: 24000 };
  const narrow = tickPositions(spectrogram());
  meterGeometry.value = { nyquist: 96000 };
  const wide = tickPositions(spectrogram());
  assert.ok(wide[5] < narrow[5]);
});

test("with no geometry reported yet, the axis falls back to the CD-source nyquist", () => {
  meterScale.value = "linear";
  meterGeometry.value = null;
  const fallback = tickPositions(spectrogram()).length;
  meterGeometry.value = { nyquist: 192000 };
  const reported = tickPositions(spectrogram()).length;
  assert.ok(reported > fallback);
});
