// Rendered suite for the text of the Output drawer's rate dial row, drawn by the generic drawer from the Output schema
// (hqptuner/static/components/faceplate/drawers/output.js): the row prints its header line, a header and its
// sub-label, and the glass, and no other text. No description sits under the glass, whether the row would take it from
// its own markup or from the rate entries of the settings metadata. The words of the header line and the glass are
// owner copy and are not asserted (docs/testing.md rule 9): the row's text less theirs is what is read.
//
// The fixture metadata gives every Output entry, the two rate entries among them, a tooltip of its own, so a row that
// printed the paragraph of its metadata entry would print fixture prose here. Both modes are read, since the running
// mode decides which rate band the row is about.
//
// Renders through preact-render-to-string with the store driven at the wire by the staging fake. The dial is found by
// its role (`group`) and class, its row as the smallest drawer row enclosing it; a header is a row label (`b`), a
// sub-label the head's `s`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-output-ratedesc.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { OUTPUT_BLOCKS, OUTPUT_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/output.js";
import { config, engineState, engineStatus, enums, metadata } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { pickChannelLayout } from "../../../../hqptuner/static/store/faceplate/drawers/output.js";
import { stagingWire } from "../../support/wire/wire.js";
import { attr, classes, elements } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const NET = "naa-office/hw:CARD=sndrpihifiberry,DEV=0";

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
async function load(mode) {
  stagingWire();
  config.value = {
    fields: [
      { name: "mode", type: "select", value: mode },
      { name: "backend", type: "select", value: "network" },
      { name: "defaults_samplerate", type: "select", value: "192000" },
      { name: "defaults_bitrate", type: "select", value: "12288000" },
      { name: "channels", type: "number", value: 2 },
      { name: "net_device", type: "select", value: NET, options: [{ value: NET, label: "naa-office: card: iface" }] },
      { name: "net_dop", type: "checkbox", value: false },
      { name: "net_anydsd", type: "checkbox", value: true },
      { name: "net_bits", type: "number", value: 20 },
      { name: "net_ipv6", type: "checkbox", value: true },
      { name: "net_period", type: "number", value: 0 },
    ],
    file: {},
    active: "",
    profiles: null,
    device_caps: null,
    autosave: true,
  };
  engineState.value = { state: "0" };
  engineStatus.value = { status: {}, metadata: {} };
  enums.value = null;
  metadata.value = META;
  openStage.value = null;
  openPopover.value = null;
  await pickChannelLayout("2");
  await discardAll();
}

/**
 * Whether `inner` lies inside `outer`.
 *
 * @param {MarkupElement} inner
 * @param {MarkupElement} outer
 */
const within = (inner, outer) =>
  inner.start >= outer.start && inner.start + inner.html.length <= outer.start + outer.html.length;

/** @param {string} h */
const stripped = (h) =>
  h
    .replace(/<[^<>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The text the rate dial row prints outside its glass, its header and its sub-label, or null when no row encloses
 * the dial.
 *
 * @returns {string | null}
 */
function textBesidesHeadAndGlass() {
  const all = elements(render(html`<${Drawer} schema=${OUTPUT_DRAWER} blocks=${OUTPUT_BLOCKS} />`));
  const dial = all.find((e) => classes(e).includes("dial") && attr(e, "role") === "group");
  if (!dial) return null;
  const row = all
    .filter((e) => classes(e).includes("drow") && within(dial, e))
    .sort((a, b) => a.html.length - b.html.length)[0];
  if (!row) return null;
  const head = all.filter((e) => within(e, row) && !within(e, dial) && (e.name === "b" || classes(e).includes("s")));
  return stripped([dial, ...head].reduce((h, e) => h.replace(e.html, ""), row.html));
}

for (const mode of MODES) {
  test(`test_in_${mode}_mode_the_rate_dial_row_prints_no_text_besides_its_header_line_and_its_glass`, async () => {
    await load(mode);
    assert.equal(textBesidesHeadAndGlass(), "");
  });
}
