// Device-aware graying of the LIVE preset picker (components/live/Presets.js).
//
// A saved live preset carries the output mode it was captured under (`chain`)
// and the output rate it pins (`fields.rate`, Hz as a string, "0" meaning no
// pin). The output device the daemon opened announces what it can play, and
// HQPTuner serves that on /api/config as `device_caps`:
//
//   { device: "...", pcm_rates: [Hz...], dsd_rates: [Hz...] }
//
// A preset the device cannot reach is rendered DISABLED in the picker, never
// dropped from it. The capability speaks only for the device it was observed
// on, so every fixture here matches `device_caps.device` to the staged
// `net_device` — narrowing against a device the daemon did not open is not
// this suite's subject.
//
// A DSD rate reaches a device either natively (it is in `dsd_rates`) or over a
// DoP carrier, which is that rate divided by 16 and carried as PCM; DoP is the
// per-backend switch `net_dop` / `alsa_dop`.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire, no assertion on copy or on the picker's option ORDER — every case
// reads the `aria-disabled` / `disabled` marks on rows addressed by the wire
// value each carries.
//
// Fixture presets are named nothing in particular; each case picks the row it
// asserts on out of the list by the property under test (its saved rate, its
// saved chain), never by a name standing in for one.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/livepreset-narrow.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { LiveView } from "../../../hqptuner/static/components/live/View.js";
import {
  health,
  engineState,
  engineStatus,
  enums,
  config,
  matrixConfig,
  metadata,
  volume,
  volumeRange,
} from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live/state.js";
import { liveMode } from "../../../hqptuner/static/store/prefs.js";
import { livePresets, livePresetsBusy, livePresetError } from "../../../hqptuner/static/store/live/presets.js";
import { rec, STATE, ENUMS, METADATA, presetWire, settle } from "../support/livepresetwire.js";
import { caps, tick, NET_DEVICE, PCM_TO_192, DSD64, DSD128, DSD512 } from "../support/devicecaps-harness.js";
import { section } from "../support/tabform.js";
import { attr } from "../support/markup.js";
import { rows } from "../support/comborows.js";
import { picker as pickerIn, grayed } from "../support/livepicker.js";

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

/** @typedef {import("../support/livepresetwire.js").PresetRecord} PresetRecord */

// The LIVE MODE card, by the machine identity it carries — never the words in
// its head (docs/testing.md rule 9). The picker inside it is read through the
// shared support/livepicker.js reader.
const LIVE_MODE = "live-mode";

// Rate constants as the wire carries them: option values and saved fields are
// STRINGS, announced capability is INTEGERS. The two are kept in their real
// types so a case pins the join rather than reading past a coercion.
const PCM_96 = "96000";
const PCM_768 = "768000";
const DOP_CARRIER_FOR_DSD64 = 192000; // 3072000 / 16, and a member of PCM_TO_192
const PCM_TO_96 = [44100, 48000, 88200, 96000]; // no DoP carrier for any DSD rate

/**
 * The whole LIVE page, with the saved presets and the announced device
 * capability a case names. Every source signal the page reads is reassigned on
 * every call: module-level signals live for the life of the file, so a partial
 * reset makes cases pass alone and fail in sequence.
 *
 * The config payload lands AFTER discardAll() and the wire has gone quiet, so
 * the capability a case seeded is the one on screen rather than one a
 * round-tripping /api/config answered with.
 *
 * @param {{
 *   presets: PresetRecord[],
 *   deviceCaps: ReturnType<typeof caps>,
 *   netDop?: boolean,
 * }} fixture
 * @returns {Promise<void>}
 */
async function resetPage({ presets, deviceCaps, netDop = false }) {
  presetWire({ presets, chain: "pcm" });
  health.value = { reachable: true, info: {} };
  engineState.value = STATE("pcm");
  engineStatus.value = null;
  enums.value = ENUMS;
  metadata.value = METADATA;
  volume.value = "-10.0";
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  config.value = { fields: [], file: {}, active: "", profiles: null, device_caps: null };
  matrixConfig.value = { fields: [] };
  liveErrors.value = {};
  liveBusy.value = "";
  liveMode.value = false;
  livePresets.value = presets;
  livePresetsBusy.value = "";
  livePresetError.value = "";
  await discardAll();
  await settle();
  config.value = {
    fields: [
      { name: "backend", value: "network" },
      { name: "net_device", value: NET_DEVICE },
      { name: "net_dop", value: netDop },
    ],
    file: {},
    active: "",
    profiles: null,
    device_caps: deviceCaps,
  };
  await tick();
}

const page = () => render(html`<${LiveView} />`);

// The picker's own subtree of the LIVE MODE card. A missing card throws rather
// than quietly measuring nothing.
function picker() {
  const frag = section(page(), LIVE_MODE);
  if (frag === "") throw new Error(`no card identified "${LIVE_MODE}" in the rendered page`);
  return pickerIn(frag);
}

// The one option row offering `name`. For this picker an option's wire value IS
// the preset's name, so the row is found without reading the words in it. A
// preset dropped from the picker altogether fails here loudly: dropping what
// the device cannot reach is not the behavior under test.
/** @param {string} name */
function row(name) {
  const hits = rows(picker()).filter((el) => attr(el, "data-v") === name);
  if (hits.length !== 1) throw new Error(`expected one option row offering "${name}", found ${hits.length}`);
  return hits[0];
}

// Whether each named preset's row came back grayed, keyed by the role the case
// gave it. Read as a pair so a picker that grays EVERY row fails the case
// instead of passing its offending half.
/** @param {Record<string, PresetRecord>} roles */
const grayedByRole = (roles) =>
  Object.fromEntries(Object.entries(roles).map(([role, p]) => [role, grayed(row(p.name))]));

// The one preset in the list carrying the property under test. Throws when it
// is not unique, so no case can silently measure the wrong row.
/**
 * @param {PresetRecord[]} presets
 * @param {(p: PresetRecord) => boolean} carries
 * @returns {PresetRecord}
 */
function only(presets, carries) {
  const hits = presets.filter(carries);
  if (hits.length !== 1) throw new Error(`expected one preset carrying the property, found ${hits.length}`);
  return hits[0];
}

test("test_a_preset_pinned_to_a_dsd_rate_the_device_does_not_offer_is_grayed", async () => {
  // The device HAS a DSD path and offers DSD64/DSD128 natively, so what
  // disqualifies the DSD512 preset is its RATE and nothing else.
  const presets = [rec("one", "sdm", DSD64), rec("two", "sdm", DSD512)];
  await resetPage({
    presets,
    deviceCaps: caps(NET_DEVICE, PCM_TO_192, [Number(DSD64), Number(DSD128)]),
  });
  assert.deepEqual(
    grayedByRole({
      beyond: only(presets, (p) => p.fields.rate === DSD512),
      offered: only(presets, (p) => p.fields.rate === DSD64),
    }),
    { beyond: true, offered: false },
  );
});

test("test_an_sdm_preset_is_grayed_on_a_device_with_no_dsd_path_at_all", async () => {
  // No native DSD rates and no PCM rate high enough to carry one over DoP, so
  // the device cannot reach SDM by any route.
  const presets = [rec("one", "sdm"), rec("two", "pcm", PCM_96)];
  await resetPage({ presets, deviceCaps: caps(NET_DEVICE, PCM_TO_96, []) });
  assert.deepEqual(
    grayedByRole({
      sdm: only(presets, (p) => p.chain === "sdm"),
      pcm: only(presets, (p) => p.chain === "pcm"),
    }),
    { sdm: true, pcm: false },
  );
});

test("test_an_sdm_preset_is_grayed_when_the_only_dsd_path_is_dop_and_dop_is_off", async () => {
  // The device offers no native DSD rate, only the PCM carrier DoP would ride
  // on; with the switch off that route is shut.
  const presets = [rec("one", "sdm"), rec("two", "pcm", PCM_96)];
  await resetPage({
    presets,
    deviceCaps: caps(NET_DEVICE, [...PCM_TO_96, DOP_CARRIER_FOR_DSD64], []),
    netDop: false,
  });
  assert.deepEqual(
    grayedByRole({
      sdm: only(presets, (p) => p.chain === "sdm"),
      pcm: only(presets, (p) => p.chain === "pcm"),
    }),
    { sdm: true, pcm: false },
  );
});

test("test_a_preset_pinned_to_a_pcm_rate_the_device_does_not_offer_is_grayed", async () => {
  const presets = [rec("one", "pcm", PCM_96), rec("two", "pcm", PCM_768)];
  await resetPage({ presets, deviceCaps: caps(NET_DEVICE, PCM_TO_192, []) });
  assert.deepEqual(
    grayedByRole({
      beyond: only(presets, (p) => p.fields.rate === PCM_768),
      offered: only(presets, (p) => p.fields.rate === PCM_96),
    }),
    { beyond: true, offered: false },
  );
});
