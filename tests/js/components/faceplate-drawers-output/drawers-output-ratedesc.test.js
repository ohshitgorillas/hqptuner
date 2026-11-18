// Rendered suite for the text of the Output drawer's rate dial row, drawn by the generic drawer from the Output schema
// (hqptuner/static/components/faceplate/drawers/output.js): the row prints its header line, a header, its sub-label
// and the restart mark, and the glass, and no other text. No description sits under the glass, whether the row would
// take it from its own markup or from the rate entries of the settings metadata. The row's text less the words of the
// header line and the glass is what is read.
//
// The fixture metadata gives every Output entry, the two rate entries among them, a tooltip of its own, so a row that
// printed the paragraph of its metadata entry would print fixture prose here. Both modes are read, since the running
// mode decides which rate band the row is about.
//
// Renders through preact-render-to-string with the store driven at the wire by the staging fake. The dial is found by
// its role (`group`) and class, its row as the smallest drawer row enclosing it; a header is a row label (`b`), a
// sub-label the head's `s`, the restart mark its `data-testid`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers-output/drawers-output-ratedesc.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { within } from "../../support/rendered/drawer-render.js";
import { NETWORK_FILE, loadOutput, outputMarkup, rateDial, rateRow } from "../../support/rendered/outputdrawer.js";
import { attr, classes } from "../../support/markup.js";

/** The output modes, as the `mode` field carries them on the wire. */
const MODES = ["pcm", "sdm"];

/** The settings metadata keys the Output drawer's rows may read their paragraphs from, the two rate entries among them. */
const OUTPUT_META_KEYS = [
  "pcm_rate",
  "sdm_rate",
  "output_mode",
  "dop",
  "dsd_48k",
  "dac_bits",
  "backend",
  "ipv6",
  "buffer_time",
  "channel_offset",
  "net_device",
  "alsa_device",
];

const META = {
  settings: {
    output: Object.fromEntries(
      OUTPUT_META_KEYS.map((k) => [k, { label: "label-fixture", tooltip: `Tooltip fixture for ${k}.` }]),
    ),
    dsp: { channels: { label: "label-fixture", tooltip: "Tooltip fixture for channels." } },
  },
};

/** @param {string} mode */
const load = (mode) => loadOutput({ ...NETWORK_FILE, mode }, { meta: META });

/** The restart mark's test id. */
const MARK = "restart-mark";

/** @param {string} h */
const stripped = (h) =>
  h
    .replace(/<[^<>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The text the rate dial row prints outside its glass, its header, its sub-label and its restart mark, or null when no
 * row encloses the dial.
 *
 * @returns {string | null}
 */
function textBesidesHeadAndGlass() {
  const all = outputMarkup();
  const dial = rateDial(all);
  const row = rateRow(all);
  if (!dial || !row) return null;
  const head = all.filter(
    (e) =>
      within(e, row) &&
      !within(e, dial) &&
      (e.name === "b" || classes(e).includes("s") || attr(e, "data-testid") === MARK),
  );
  return stripped([dial, ...head].reduce((h, e) => h.replace(e.html, ""), row.html));
}

for (const mode of MODES) {
  test(`test_in_${mode}_mode_the_rate_dial_row_prints_no_text_besides_its_header_line_and_its_glass`, async () => {
    await load(mode);
    assert.equal(textBesidesHeadAndGlass(), "");
  });
}
