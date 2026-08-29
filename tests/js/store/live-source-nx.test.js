// Behavioral suite for `sourceIsNx` (store/live/derive.js): whether the SOURCE
// rate the engine reports playing puts playback on the Nx side of the chain.
//
// THE BOUNDARY IS THE ENGINE'S OWN, and it is published: "Filter/oversampling
// selection for '1x' rates covers source sampling rates below 50 kHz, so called
// base rates. Filter selection for 'Nx' rates covers everything else above the
// 1x rates" (HQPlayer 6 Desktop manual §4.6). So 49999 Hz is 1x and 50000 Hz is
// Nx, and the two rates either side of that edge are read here alongside the
// two ordinary ones a listener actually meets — 44.1 kHz on the 1x side and
// 96 kHz on the Nx side. Without the pair straddling the edge, a boundary put
// at 48 kHz or at 88.2 kHz would still pass the ordinary two.
//
// It is the SOURCE rate, not the output rate. `metadata.samplerate` is what the
// engine reports for the material being played and `status.active_rate` is what
// it is running the output at (the split tests/js/store/liverateauto.test.js
// rests on), so every fixture below carries an `active_rate` that disagrees
// with the side its source rate names: a reading taken off the output rate
// answers backwards on every case rather than coinciding.
//
// The state is driven by assigning the exported `engineStatus` signal the shape
// /api/status serves — `metadata` present when a track is loaded, its
// `samplerate` a string attribute (docs/protocol.md §Status). A fresh object
// every time: writing the same reference to a signal does not notify.
//
// Nothing playing is the case with no `samplerate` in the metadata at all,
// which is what the daemon serves between tracks.
//
// The module is imported under a BUILT specifier so a checkout that predates
// the change fails per-case rather than at module link — the convention
// tests/js/store/plainnames-truename.test.js settled.
//
// Policy (docs/testing.md): public API only, one assertion per test, state
// driven through exported signals. No store function of HQPTuner's is stubbed
// and no copy is read.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live-source-nx.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { engineStatus } from "../../../hqptuner/static/store/signals.js";

const MOD = new URL("../../../hqptuner/static/store/live/derive.js", import.meta.url).href;
const derive = await import(`${MOD}`);

// An output rate that sits on the OPPOSITE side of the boundary from every
// source rate read below, so a reading taken off it cannot coincide with the
// right answer: 705600 Hz is an Nx rate, and it accompanies the 1x sources; the
// Nx sources are accompanied by 44100.
const OUTPUT_NX = "705600";
const OUTPUT_1X = "44100";

/**
 * The engine playing a track at one source rate.
 *
 * @param {string} samplerate
 * @param {string} activeRate
 * @returns {void}
 */
const playing = (samplerate, activeRate) => {
  engineStatus.value = { status: { active_rate: activeRate }, metadata: { samplerate, bits: "24" } };
};

// --- the boundary and the two ordinary rates ---------------------------------------

/** @type {[string, string, string, boolean][]} */
const SOURCES = [
  ["one_hz_below_the_boundary", "49999", OUTPUT_NX, false],
  ["at_the_boundary", "50000", OUTPUT_1X, true],
  ["a_base_rate", "44100", OUTPUT_NX, false],
  ["a_multiple_rate", "96000", OUTPUT_1X, true],
];

for (const [at, samplerate, activeRate, isNx] of SOURCES) {
  const verdict = isNx ? "on_the_nx_side" : "on_the_1x_side";
  test(`test_a_source_${at}_puts_playback_${verdict}`, () => {
    playing(samplerate, activeRate);
    assert.equal(derive.sourceIsNx(), isNx);
  });
}

// --- nothing playing ---------------------------------------------------------------
//
// Metadata with no `samplerate` in it: there is no source, so there is no side
// it puts playback on, and the answer is the 1x one.

test("test_no_source_playing_puts_playback_on_the_1x_side", () => {
  engineStatus.value = { status: { active_rate: OUTPUT_NX }, metadata: {} };
  assert.equal(derive.sourceIsNx(), false);
});
