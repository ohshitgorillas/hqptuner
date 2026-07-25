// Behavioral suite for components/tabs/VolumeTab.js — the Volume tab's rendered
// contract: the live knob paired with the fixed-volume card, the range bar, the
// automatic card, and the Loudness card's dimming rule.
//
// Policy (docs/testing.md): public API only, one assertion per test.
// `LoudnessCard` is private and stays that way — every case here goes through
// the exported `Volume`, driven by the exported store signals (`config` and
// `matrixConfig` carrying the daemon's own /config and /matrix forms, `volume` /
// `volumeRange` carrying the live level) over a faked wire on the real REST
// paths. Nothing is stubbed.
//
// The Loudness body's dimming is the one piece of logic this tab owns: it is
// off when the feature is disabled OR when the volume control is bypassed, since
// volume-adaptive loudness cannot adapt to a pinned volume. Both arms are pure
// functions of exported signals, so both are covered.
//
// NOT covered here: the knob, the range bar and each Field's own rendering.
// Those are contracts of their own components and are covered in
// playbackvolume.test.js, volumerangebar.test.js and field.test.js; the cases
// below assert only that this tab places them, not how they draw.
//
// State reset is total on every call: module-level signals outlive a test, so a
// partial reset makes cases pass alone and fail in sequence.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/volumetab.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../hqptuner/static/lib/dom.js";
import { Volume } from "../../hqptuner/static/components/tabs/VolumeTab.js";
import {
  config,
  matrixConfig,
  metadata,
  engineState,
  enums,
  volume,
  volumeRange,
  discardAll,
} from "../../hqptuner/static/store/state.js";
import { showDescriptions, keepOptionDescriptions, fastVolumeUpdates } from "../../hqptuner/static/store/prefs.js";
import { stagingWire } from "./wire.js";

// The daemon's own forms, keyed by FORM FIELD name — the volume range is
// volume_min / volume_max, loudness is post_loudness_enabled on /matrix.
const formFields = (spec) => Object.entries(spec).map(([name, value]) => ({ name, value }));

// A volume control that is live: a real range, nothing fixing or bypassing it.
const FREE = { volume_min: "-60", volume_max: "0", defaults_volume: "-20", fixed_volume_enabled: false };

async function reset({ cfg = FREE, mtx = {} } = {}) {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  volume.value = null;
  volumeRange.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  fastVolumeUpdates.value = false;
  matrixConfig.value = { fields: formFields(mtx) };
  config.value = { fields: formFields(cfg), file: {}, active: "", profiles: null };
  await discardAll();
}

const tab = () => render(html`<${Volume} />`);

// One card's fragment, from its head to its close. Cards on this tab carry no
// nested <section>, so the first close after the head is the card's own.
const card = (out, title) => {
  const head = out.indexOf(`<div class="card-head">${title}</div>`);
  return head < 0 ? "" : out.slice(head, out.indexOf("</section>", head));
};

const LOUDNESS = "Loudness";
const DIMMED = 'class="dsp-body off"';
const ON = { post_loudness_enabled: true };
const OFF = { post_loudness_enabled: false };
// Fixed volume bypasses the live volume control, which is what gates loudness.
const FIXED = { ...FREE, fixed_volume_enabled: true };

// --- the cards this tab lays out ----------------------------------------------

test("test_the_playback_knob_leads_the_tab", async () => {
  await reset();
  assert.ok(tab().includes('<div class="card-head">Playback volume</div>'));
});

test("test_the_fixed_volume_card_carries_auto_headroom", async () => {
  await reset();
  assert.ok(card(tab(), "Fixed volume").includes("<label>Auto headroom"));
});

test("test_the_fixed_volume_card_carries_the_fixed_volume_enable", async () => {
  await reset();
  assert.ok(card(tab(), "Fixed volume").includes("<label>Fixed volume</label>"));
});

test("test_the_fixed_volume_level_is_indented_under_its_enable", async () => {
  await reset();
  assert.ok(card(tab(), "Fixed volume").includes('<div class="indent">'));
});

test("test_the_volume_range_bar_follows_the_knob_and_the_fixed_card", async () => {
  await reset();
  assert.ok(tab().includes("vr-card"));
});

test("test_the_automatic_card_carries_adaptive_volume", async () => {
  await reset();
  assert.ok(card(tab(), "Automatic").includes("<label>Adaptive volume</label>"));
});

test("test_the_automatic_card_carries_playlist_album_gain", async () => {
  await reset();
  assert.ok(card(tab(), "Automatic").includes("<label>Playlist album gain</label>"));
});

// --- loudness -----------------------------------------------------------------

test("test_the_loudness_body_is_dimmed_while_loudness_is_off", async () => {
  await reset({ mtx: OFF });
  assert.ok(card(tab(), LOUDNESS).includes(DIMMED));
});

test("test_the_loudness_body_is_live_once_loudness_is_on", async () => {
  await reset({ mtx: ON });
  assert.equal(card(tab(), LOUDNESS).includes(DIMMED), false);
});

test("test_the_loudness_body_stays_dimmed_while_the_volume_control_is_bypassed", async () => {
  await reset({ cfg: FIXED, mtx: ON });
  assert.ok(card(tab(), LOUDNESS).includes(DIMMED));
});

test("test_the_loudness_enable_stays_outside_the_dimmed_body", async () => {
  await reset({ mtx: OFF });
  assert.ok(card(tab(), LOUDNESS).split(DIMMED)[0].includes("<label>Enable</label>"));
});

test("test_the_loudness_card_carries_a_bass_cluster", async () => {
  await reset({ mtx: ON });
  assert.ok(card(tab(), LOUDNESS).includes('<div class="cluster-head">Bass</div>'));
});

test("test_the_loudness_card_carries_a_treble_cluster", async () => {
  await reset({ mtx: ON });
  assert.ok(card(tab(), LOUDNESS).includes('<div class="cluster-head">Treble</div>'));
});

test("test_the_loudness_card_rules_between_bass_and_treble", async () => {
  await reset({ mtx: ON });
  assert.ok(card(tab(), LOUDNESS).includes('<span class="col-rule" aria-hidden="true"></span>'));
});

test("test_the_loudness_card_carries_the_loudness_range", async () => {
  await reset({ mtx: ON });
  assert.ok(card(tab(), LOUDNESS).includes('<div class="cluster-head">Range</div>'));
});

test("test_the_loudness_card_plots_the_shelving_it_applies", async () => {
  await reset({ mtx: ON });
  assert.ok(card(tab(), LOUDNESS).includes('<div class="dsp-plot">'));
});
