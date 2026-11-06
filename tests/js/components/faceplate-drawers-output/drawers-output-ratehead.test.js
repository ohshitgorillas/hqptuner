// Rendered suite for the head of the Output drawer's rate dial row, drawn by the generic drawer from the Output schema
// (hqptuner/static/components/faceplate/drawers/output.js): the row carries one header, and beside it a sub-label, the
// same way the DAC bits row does. The DAC bits row is the reference the dial row's head is read against.
//
// Renders through preact-render-to-string with the store driven at the wire by the staging fake. The dial is found by
// its role (`group`) and class, its row as the smallest drawer row enclosing it, the DAC bits row by its catalog key
// (`data-k`); a header is a row label (`b`), a sub-label the head's `s`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js

import test, { beforeEach } from "node:test";
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
import { seedReadings } from "../../support/readings.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const NET = "naa-office/hw:CARD=sndrpihifiberry,DEV=0";

/** The DAC bits row of the network backend, the reference head. */
const DAC_BITS_ROW = "net_bits";

beforeEach(async () => {
  stagingWire();
  config.value = {
    fields: [
      { name: "mode", type: "select" },
      { name: "backend", type: "select" },
      { name: "defaults_samplerate", type: "select" },
      { name: "defaults_bitrate", type: "select" },
      { name: "channels", type: "number" },
      { name: "net_device", type: "select", options: [{ value: NET, label: "naa-office: card: iface" }] },
      { name: "net_dop", type: "checkbox" },
      { name: "net_anydsd", type: "checkbox" },
      { name: "net_bits", type: "number" },
      { name: "net_ipv6", type: "checkbox" },
      { name: "net_period", type: "number" },
    ],
    profiles: null,
    device_caps: null,
  };
  seedReadings({
    mode: "pcm",
    backend: "network",
    defaults_samplerate: "192000",
    defaults_bitrate: "12288000",
    channels: 2,
    net_device: NET,
    net_dop: false,
    net_anydsd: true,
    net_bits: 20,
    net_ipv6: true,
    net_period: 0,
  });
  engineState.value = { state: "0" };
  engineStatus.value = { status: {}, metadata: {} };
  enums.value = null;
  metadata.value = null;
  openStage.value = null;
  openPopover.value = null;
  await pickChannelLayout("2");
  await discardAll();
});

const markup = () => elements(render(html`<${Drawer} schema=${OUTPUT_DRAWER} blocks=${OUTPUT_BLOCKS} />`));

/**
 * Whether `inner` lies inside `outer`.
 *
 * @param {MarkupElement} inner
 * @param {MarkupElement} outer
 */
const within = (inner, outer) =>
  inner.start >= outer.start && inner.start + inner.html.length <= outer.start + outer.html.length;

/** The elements inside the smallest drawer row enclosing the rate dial, or none when no row encloses it. */
function inDialRow() {
  const all = markup();
  const dial = all.find((e) => classes(e).includes("dial") && attr(e, "role") === "group");
  if (!dial) return [];
  const row = all
    .filter((e) => classes(e).includes("drow") && within(dial, e))
    .sort((a, b) => a.html.length - b.html.length)[0];
  return row ? elements(row.html) : [];
}

/** The elements inside the DAC bits row. */
function inDacBitsRow() {
  const row = markup().find((e) => classes(e).includes("drow") && attr(e, "data-k") === DAC_BITS_ROW);
  return row ? elements(row.html) : [];
}

/** @param {MarkupElement[]} inside */
const headers = (inside) => inside.filter((e) => e.name === "b").length;

test("test_the_dac_bits_row_prints_one_header", () => {
  assert.deepEqual(headers(inDacBitsRow()), 1);
});

test("test_the_rate_dial_row_prints_one_header", () => {
  assert.deepEqual(headers(inDialRow()), 1);
});
