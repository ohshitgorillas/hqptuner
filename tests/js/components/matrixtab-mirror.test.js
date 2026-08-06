// Behavioral suite for the Pipelines card's "mirror to stereo pair" checkbox —
// the switch that decides whether an EQ import also lands on the target
// pipeline's stereo pair. A headphone curve is one curve for both ears, so
// mirroring is the headphone default; speaker correction is per channel, so it
// is not the speaker default.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders the exported `MatrixTab` and drives it through exported signals
// (`matrixMode`, `config`, `matrixConfig`, `showDescriptions`, the plot/selection
// signals); nothing private is touched.
//
// NOT covered: what the checkbox actually does to an import. The import lanes
// fire from click handlers, and this harness is `preact-render-to-string` with
// no DOM and no event dispatch, so that behaviour belongs to the hand-back
// protocol rather than to a faked event.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/matrixtab-mirror.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { MatrixTab } from "../../../hqptuner/static/components/MatrixTab.js";
import { matrixMode } from "../../../hqptuner/static/store/matrixmode.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { plottedRows } from "../../../hqptuner/static/components/MatrixPlot.js";
import { selectedStage } from "../../../hqptuner/static/components/BandStrip.js";
import { stagingWire } from "../support/wire.js";

const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });

// A stereo pair — two pipelines is what mirroring concerns.
const PAIR = () => [ROW({}), ROW({ source: "1", mixdown: "1" })];

// Full reset every time — every one of these signals outlives a test.
async function reset(rows, { mode = "speakers" } = {}) {
  stagingWire();
  showDescriptions.value = true;
  plottedRows.value = new Set();
  selectedStage.value = null;
  matrixConfig.value = {
    fields: [],
    rows: [],
    live_profiles: [],
    live_active: "[Default]",
    file_profiles: {},
  };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify(rows) } };
  await discardAll();
  matrixMode.value = mode;
}

const tab = () =>
  render(html`<${MatrixTab} />`)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'");

const LABEL = "mirror to stereo pair";

// The Pipelines card's own slice of the render, from its title onward. The tab
// carries other checkboxes; a control found outside this card is not the one
// under test.
const pipelinesCard = (out) => {
  const at = out.indexOf("Pipelines <span");
  return at < 0 ? "" : out.slice(at);
};

// The checkbox the label NAMES: the label element carrying the text, and the
// checkbox inside that same element. Not the nearest checkbox by byte distance —
// proximity is markup shape, whereas label association is the control's contract
// with the user. Null when the card, the label or the input is missing, so that
// "no control" can never be read as "control unchecked".
function mirrorBox(out) {
  for (const m of pipelinesCard(out).matchAll(/<label\b[^>]*>(.*?)<\/label>/gs)) {
    if (!m[1].includes(LABEL)) continue;
    const box = m[1].match(/<input\b[^>]*type="checkbox"[^>]*>/);
    return box === null ? null : box[0];
  }
  return null;
}

// SSR emits a checked box as a bare `checked` attribute and omits it entirely
// when unchecked — matched in that bare form, so an `aria-checked="false"` or a
// class containing "checked" cannot answer for it. A missing box throws rather
// than reporting unchecked.
function mirrorChecked(out) {
  const box = mirrorBox(out);
  if (box === null) throw new Error(`no "${LABEL}" checkbox in the Pipelines card`);
  return /\schecked(\s|\/|>)/.test(box);
}

test("test_the_pipelines_card_offers_a_mirror_to_stereo_pair_checkbox_in_speakers_mode", async () => {
  await reset(PAIR(), { mode: "speakers" });
  assert.notEqual(mirrorBox(tab()), null);
});

test("test_the_pipelines_card_offers_a_mirror_to_stereo_pair_checkbox_in_headphones_mode", async () => {
  await reset(PAIR(), { mode: "headphones" });
  assert.notEqual(mirrorBox(tab()), null);
});

test("test_headphones_mode_checks_mirror_to_stereo_pair", async () => {
  await reset(PAIR(), { mode: "headphones" });
  assert.equal(mirrorChecked(tab()), true);
});

test("test_speakers_mode_leaves_mirror_to_stereo_pair_unchecked", async () => {
  await reset(PAIR(), { mode: "speakers" });
  assert.equal(mirrorChecked(tab()), false);
});
