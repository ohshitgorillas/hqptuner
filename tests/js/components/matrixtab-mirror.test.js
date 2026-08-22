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
// no DOM and no event dispatch, so that behavior belongs to the hand-back
// protocol rather than to a faked event.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/matrixtab-mirror.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { MatrixTab } from "../../../hqptuner/static/components/matrix/Tab.js";
import { matrixMode } from "../../../hqptuner/static/store/matrix/mode.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { plottedRows } from "../../../hqptuner/static/components/matrix/Plot.js";
import { selectedStage } from "../../../hqptuner/static/components/matrix/BandStrip.js";
import { stagingWire } from "../support/wire.js";
import { section } from "../support/tabform.js";
import { attr, classes, elements } from "../support/markup.js";

/** @typedef {import("../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow */

/** @param {Partial<PipelineRow>} patch */
const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });

// A stereo pair — two pipelines is what mirroring concerns.
const PAIR = () => [ROW({}), ROW({ source: "1", mixdown: "1" })];

// Full reset every time — every one of these signals outlives a test.
/**
 * @param {PipelineRow[]} rows
 * @param {{ mode?: string }} [opts]
 * @returns {Promise<void>}
 */
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

// The Pipelines card's own slice of the render, by the id its section carries.
// The tab carries other checkboxes; a control found outside this card is not the
// one under test.
/** @param {string} out */
const pipelinesCard = (out) => section(out, "pipelines");

// The mirror switch, found by the class its own row carries,
// `mtx-import-mirror` — a CSS class is a machine identifier, the words beside
// the box are the owner's (docs/testing.md rule 9). "The card's only checkbox"
// would name no control at all: the card is free to grow another one, and a
// case would then measure whichever came first. Null when the row or the input
// is missing, so that "no control" can never be read as "control unchecked";
// more than one input in that row raises, since then this lookup has stopped
// naming a single control.
/**
 * @param {string} out
 * @returns {string | null}
 */
function mirrorBox(out) {
  const row = elements(pipelinesCard(out)).find((el) => classes(el).includes("mtx-import-mirror"));
  if (!row) return null;
  const boxes = elements(row.html).filter((el) => el.name === "input" && attr(el, "type") === "checkbox");
  if (boxes.length > 1) throw new Error(`the mirror row carries ${boxes.length} checkboxes, not one`);
  return boxes[0]?.html ?? null;
}

// SSR emits a checked box as a bare `checked` attribute and omits it entirely
// when unchecked — matched in that bare form, so an `aria-checked="false"` or a
// class containing "checked" cannot answer for it. A missing box throws rather
// than reporting unchecked.
/**
 * @param {string} out
 * @returns {boolean}
 */
function mirrorChecked(out) {
  const box = mirrorBox(out);
  if (box === null) throw new Error("no checkbox in the Pipelines card");
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
