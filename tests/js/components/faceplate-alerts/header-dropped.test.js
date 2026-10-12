// Rendered suite for what the brand knob's popover on hqptuner/static/components/faceplate/Header.js shows of the
// settings a daemon restart dropped: one row per setting, each reading the setting's label and its engine name, a
// pinned rate in the form the page prints rates (kHz), and adaptive volume as a word that tells its two states apart.
//
// The wire is the seam, as tests/js/components/faceplate-alerts/header.test.js drives it: the /api/health reading,
// carrying `dropped_settings` in its `WrittenSetting` shape, goes into `health`, and the rest of the header's state is
// set the way that file sets it. The tap is fired through the renderer's vnode seam, since render-to-string fires no
// events. The sentence, the labels and the On / Off words are owner copy and are nowhere in this file: a row is read
// for the engine name or the rate number the fixture put on the wire, and a label or a flag word only by comparing two
// renders that differ in that one field.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/header-dropped.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Header } from "../../../../hqptuner/static/components/faceplate/Header.js";
import {
  health,
  config,
  pendingPreset,
  engineState,
  engineStatus,
  matrixConfig,
  lastApply,
} from "../../../../hqptuner/static/store/signals.js";
import { applying, discardAll } from "../../../../hqptuner/static/store/actions.js";
import { engineBusy } from "../../../../hqptuner/static/store/enginewrite.js";
import { liveBook, livePresets } from "../../../../hqptuner/static/store/live/presets.js";
import { unfolded } from "../../../../hqptuner/static/store/faceplate/stations.js";
import { body, openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { elements, hasAttr, text } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";
import { staticWire } from "../../support/wire/wire.js";

/** @typedef {{ field: string, value: string, name: string | null }} WrittenSetting */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** A /api/health reading whose credentials the daemon accepted and which lists no dropped setting. */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true, info: {}, dropped_settings: [] };

/**
 * Two dropped settings whose engine names differ from their form values.
 *
 * @type {{ field: string, value: string, name: string }[]}
 */
const NAMED = [
  { field: "filter", value: "42", name: "poly-sinc-gauss-xla" },
  { field: "modulator", value: "7", name: "ASDM7EC-super" },
];

/** One engine name two fields can both hold. */
const SHARED_NAME = "poly-sinc-gauss-long";

/** Pinned rates in Hz as the wire carries them, each with the kHz figure the page prints for it. */
const RATES = [
  { hz: "352800", khz: "352.8" },
  { hz: "44100", khz: "44.1" },
];

beforeEach(async () => {
  staticWire();
  engineState.value = {};
  engineStatus.value = null;
  matrixConfig.value = { fields: [] };
  config.value = {
    fields: [],
    file: {},
    active: "Day",
    profiles: { value: "Day", options: ["", "Day"].map((n) => ({ value: n, label: n })) },
  };
  liveBook.value = {};
  livePresets.value = null;
  lastApply.value = null;
  pendingPreset.value = null;
  await discardAll();
  health.value = { ...HEALTHY };
  applying.value = false;
  engineBusy.value = false;
  unfolded.value = null;
  body.value = "chain";
  openPopover.value = null;
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

/**
 * A fresh health reading listing `dropped`.
 *
 * @param {WrittenSetting[]} dropped
 */
const report = (dropped) => {
  health.value = { ...HEALTHY, dropped_settings: dropped.map((d) => ({ ...d })) };
};

/** Every element of the rendered header. */
const all = () => elements(render(html`<${Header} />`));

/** Tap the knob; taps nothing when it takes no tap. */
function tapKnob() {
  const { seen } = renderTree(html`<${Header} />`);
  const hit = seen.find((v) => v.props["data-testid"] === "conn");
  const onClick = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (typeof onClick === "function") onClick();
}

/** What a reader sees in the header's shown popover panels. */
const shownText = () =>
  all()
    .filter((e) => e.name !== "button" && hasAttr(e, "data-pop") && !hasAttr(e, "hidden"))
    .map(text)
    .join(" ");

/**
 * What the knob's popover shows once tapped, with the report listing `dropped`. Each call starts from a closed popover.
 *
 * @param {WrittenSetting[]} dropped
 */
const knobReads = (dropped) => {
  openPopover.value = null;
  report(dropped);
  tapKnob();
  return shownText();
};

for (const [i, setting] of NAMED.entries()) {
  test(`test_the_knobs_popover_shows_dropped_setting_${i + 1}_by_its_engine_name`, () => {
    assert.ok(knobReads(NAMED).includes(setting.name));
  });
}

test("test_two_fields_dropped_on_one_engine_name_read_apart_by_their_labels", () => {
  const onFilter1x = knobReads([{ field: "filter1x", value: "40", name: SHARED_NAME }]);
  const onFilterNx = knobReads([{ field: "filter", value: "40", name: SHARED_NAME }]);
  assert.notEqual(onFilter1x, onFilterNx);
});

for (const { hz, khz } of RATES) {
  test(`test_a_dropped_rate_of_${hz}_hz_reads_${khz.replace(".", "_")}_khz`, () => {
    assert.ok(knobReads([{ field: "rate", value: hz, name: null }]).includes(khz));
  });
}

test("test_dropped_adaptive_volume_on_and_off_read_apart", () => {
  const on = knobReads([{ field: "adaptive_volume", value: "1", name: null }]);
  const off = knobReads([{ field: "adaptive_volume", value: "0", name: null }]);
  assert.notEqual(on, off);
});
