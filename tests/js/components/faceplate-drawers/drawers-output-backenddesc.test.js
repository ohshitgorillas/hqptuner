// Rendered suite for the description the Output drawer's Backend row gives: it describes each backend the connected
// daemon offers, once each, and no backend that daemon does not offer. The backends a daemon offers are the options of
// its form's `backend` select (docs/spec/settings-classification.md, Windows daemon local backends): a Linux daemon
// lists ALSA, Network and Combo, a Windows one ASIO and WASAPI in place of ALSA.
//
// Each backend's description is its line in the Backend entry's option glossary, the `options` map of the settings
// metadata keyed by the option's form value (docs/spec/openapi.json, SettingEntry). The fixture glossary holds a line
// for all five backends, so a row that described every backend it knows of, rather than the ones the daemon offers,
// prints the other platform's lines here. Both daemons are read, since each offers a backend the other does not.
//
// Renders through preact-render-to-string with the store driven at the wire by the staging fake. The row is found by
// its catalog key (`data-k`); its text is read whole, the see-more popover's included, and each fixture line counted
// where it occurs.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-output-backenddesc.test.js

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
import { attr, classes, elements, text } from "../../support/markup.js";

/** The Backend row's catalog key, the form field it edits. */
const BACKEND_KEY = "backend";

/** One fixture line per backend, keyed by the backend's form value; no line is a substring of another. */
const BACKEND_LINES = {
  alsa: "Fixture line describing the alsa backend",
  asio: "Fixture line describing the asio backend",
  wasapi: "Fixture line describing the wasapi backend",
  network: "Fixture line describing the network backend",
  combo: "Fixture line describing the combo backend",
};

/** The `backend` select each daemon's form lists, as option value and the label the daemon gives it. */
const DAEMONS = {
  linux: [
    { value: "alsa", label: "ALSA" },
    { value: "network", label: "Network Audio" },
    { value: "combo", label: "Combo" },
  ],
  windows: [
    { value: "asio", label: "ASIO" },
    { value: "wasapi", label: "WASAPI" },
    { value: "network", label: "Network Audio" },
    { value: "combo", label: "Combo" },
  ],
};

/** The settings metadata keys the Output drawer's rows read their paragraphs from. */
const OUTPUT_META_KEYS = [
  "output_mode",
  "dop",
  "dsd_48k",
  "dac_bits",
  "ipv6",
  "buffer_time",
  "channel_offset",
  "net_device",
  "alsa_device",
];

/** @type {Record<string, { label: string, tooltip: string, options?: Record<string, string> }>} */
const OUTPUT_META = Object.fromEntries(
  OUTPUT_META_KEYS.map((k) => [k, { label: "label-fixture", tooltip: `Tooltip fixture for ${k}` }]),
);
OUTPUT_META.backend = { label: "label-fixture", tooltip: "Tooltip fixture for backend", options: BACKEND_LINES };

const META = {
  settings: {
    output: OUTPUT_META,
    dsp: { channels: { label: "label-fixture", tooltip: "Tooltip fixture for channels" } },
  },
};

const NET = "naa-office/hw:CARD=sndrpihifiberry,DEV=0";

/**
 * Seeds the store with a daemon whose form offers `offered` and runs the Network backend, which both daemons offer.
 *
 * @param {{ value: string, label: string }[]} offered
 */
async function load(offered) {
  stagingWire();
  config.value = {
    fields: [
      { name: "mode", type: "select", value: "pcm" },
      { name: "backend", type: "select", value: "network", options: offered },
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
 * The text the Backend row prints, its popovers included, or null when the drawer draws no Backend row.
 *
 * @returns {string | null}
 */
function backendRowText() {
  const row = elements(render(html`<${Drawer} schema=${OUTPUT_DRAWER} blocks=${OUTPUT_BLOCKS} />`)).find(
    (e) => classes(e).includes("drow") && attr(e, "data-k") === BACKEND_KEY,
  );
  return row ? text(row) : null;
}

/**
 * The backends the Backend row describes, sorted, one entry per time its line occurs in the row's text.
 *
 * @returns {string[] | null}
 */
function describedBackends() {
  const shown = backendRowText();
  if (shown === null) return null;
  return Object.entries(BACKEND_LINES)
    .flatMap(([backend, line]) => Array(shown.split(line).length - 1).fill(backend))
    .sort();
}

for (const [daemon, offered] of Object.entries(DAEMONS)) {
  test(`test_on_a_${daemon}_daemon_the_backend_row_describes_each_offered_backend_once_and_no_other`, async () => {
    await load(offered);
    assert.deepEqual(describedBackends(), offered.map((o) => o.value).sort());
  });
}
