// Rendered suite for the catalog's FFT filter length rule as the stage drawer reads it: an `fft_size` row whose drawer
// gives it no `when` of its own shows on a PCM out or SDM out tab only while that tab's own 1x or Nx filter is
// FFT-family, so the decision comes from the catalog entry and not from the drawer that places the row.
//
// Renders `Drawer` through preact-render-to-string over a two-tab drawer, `pcm` and `sdm`, each holding one bare
// `fft_size` row; the store is driven at the wire by the staging fake, the daemon's /config form into `config`. Rows are
// found by catalog key (`data-k`), tabs by id (`data-tab`); every string asserted is a wire value.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-fft-catalog.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { config, engineState, enums, metadata, pendingPreset } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { filterFields } from "../../support/rendered/filter-fields.js";
import { stagingWire } from "../../support/wire/wire.js";
import { elements, attr, classes } from "../../support/markup.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

const PLAIN = "1";
const FFT = "2";

const FILTERS = [
  { value: PLAIN, label: "sinc-L" },
  { value: FFT, label: "FFT" },
];

const FFT_LENGTHS = [
  { value: "16384", label: "16384" },
  { value: "32768", label: "32768" },
];

/**
 * A drawer of a PCM out and an SDM out tab, each holding the catalog's `fft_size` row with no `when` of its own.
 *
 * @type {DrawerSchema}
 */
const BARE = {
  id: "fftbare",
  title: "fftbare",
  aria: "fftbare",
  tabs: [
    { id: "pcm", label: "pcm", body: [{ row: { key: "fft_size" } }] },
    { id: "sdm", label: "sdm", body: [{ row: { key: "fft_size" } }] },
  ],
};

/**
 * Load the /config form: each chain's 1x and Nx filter by value, and the FFT length.
 *
 * @param {{ pcm1x?: string, pcmnx?: string, sdm1x?: string, sdmnx?: string }} [f]
 */
function load({ pcm1x = PLAIN, pcmnx = PLAIN, sdm1x = PLAIN, sdmnx = PLAIN } = {}) {
  config.value = {
    fields: [
      ...filterFields({ pcm1x, pcmnx, sdm1x, sdmnx }, FILTERS),
      { name: "fft_size", type: "select", value: "16384", options: FFT_LENGTHS },
    ],
    file: {},
    active: "",
  };
}

beforeEach(async () => {
  stagingWire();
  load();
  engineState.value = { state: "0", active_chain: "sdm" };
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openPopover.value = null;
  openStage.value = BARE.id;
  openStage.value = null;
  cancel();
  await discardAll();
});

/**
 * Whether each tab, PCM out then SDM out, draws the `fft_size` row.
 *
 * @returns {[boolean, boolean]}
 */
function fftShownOn() {
  const panels = elements(render(html`<${Drawer} schema=${BARE} />`)).filter((e) => classes(e).includes("dpanel"));
  const shown = (/** @type {string} */ tab) => {
    const panel = panels.find((p) => attr(p, "data-tab") === tab);
    return panel ? elements(panel.html).some((e) => attr(e, "data-k") === "fft_size") : false;
  };
  return [shown("pcm"), shown("sdm")];
}

test("test_a_bare_fft_length_row_shows_only_on_the_tab_whose_nx_filter_is_fft_family", () => {
  load({ sdmnx: FFT });
  assert.deepEqual(fftShownOn(), [false, true]);
});

test("test_a_bare_fft_length_row_shows_only_on_the_tab_whose_1x_filter_is_fft_family", () => {
  load({ pcm1x: FFT });
  assert.deepEqual(fftShownOn(), [true, false]);
});

test("test_a_bare_fft_length_row_follows_a_staged_filter_pick", async () => {
  await edit("pcm_filter_nx", FFT);
  assert.deepEqual(fftShownOn(), [true, false]);
});
