// Behavioral suite for lib/eqexport.js — the write-side twin of eqimport.js.
//
// `rowToRewText` is a pure function of a pipeline row. Policy (docs/testing.md):
// public API only, one assertion per test. The round-trip case is the strongest
// contract — export then re-import must reproduce the original process string —
// so it is asserted through the real importer (parseEqText) and the real chain
// serializer (serializeProcess), never a hand-written golden.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqexport.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { rowToRewText, pipelinesToRewText } from "../../../hqptuner/static/lib/eqexport.js";
import { parseEqText } from "../../../hqptuner/static/lib/eqimport.js";
import { serializeProcess } from "../../../hqptuner/static/lib/matrixspec.js";

const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });
const PEAK = "iir:type=peak;f=105;q=1.41;g=-3.2";

test("a peaking stage exports as a REW PK filter line", () => {
  const { text } = rowToRewText(ROW({ process: PEAK }));
  assert.match(text, /Filter 1: ON PK Fc 105 Hz Gain -3\.2 dB Q 1\.41/);
});

test("a dB channel gain becomes the Preamp line", () => {
  const { text } = rowToRewText(ROW({ process: PEAK, gain: "-6.4", gainunit: "dB" }));
  assert.match(text, /^Preamp: -6\.4 dB$/m);
});

test("a low shelf exports with the LSC token", () => {
  const { text } = rowToRewText(ROW({ process: "iir:type=lshelf;f=105;q=0.7;g=5.5" }));
  assert.match(text, /Filter 1: ON LSC Fc 105 Hz Gain 5\.5 dB Q 0\.7/);
});

test("a raw biquad has no Fc/Gain/Q form and is not exported", () => {
  const { count } = rowToRewText(ROW({ process: "iir:type=biquad;b0=1;b1=0;b2=0;a0=1;a1=0;a2=0" }));
  assert.equal(count, 0);
});

test("a raw biquad is reported as skipped rather than dropped silently", () => {
  const { skipped } = rowToRewText(ROW({ process: "iir:type=biquad;b0=1;b1=0;b2=0;a0=1;a1=0;a2=0" }));
  assert.equal(skipped.length, 1);
});

test("a Lin channel gain has no Preamp equivalent and is reported", () => {
  const { text } = rowToRewText(ROW({ process: PEAK, gain: "1.5", gainunit: "Lin" }));
  assert.doesNotMatch(text, /Preamp:/);
});

test("export then re-import reproduces the original process string", () => {
  const exported = rowToRewText(ROW({ process: PEAK })).text;
  assert.equal(serializeProcess(parseEqText(exported).stages), PEAK);
});

test("a stereo-identical pipeline pair exports as one collapsed block", () => {
  const rows = [ROW({ process: PEAK }), ROW({ source: "1", mixdown: "1", process: PEAK })];
  assert.doesNotMatch(pipelinesToRewText(rows).text, /# Pipeline/);
});

test("divergent channels are written under per-pipeline section headers", () => {
  const rows = [ROW({ process: PEAK }), ROW({ source: "1", mixdown: "1", process: "iir:type=peak;f=120;q=1;g=-2" })];
  assert.match(pipelinesToRewText(rows).text, /# Pipeline 2 \(In 2 -> Out 2\)/);
});

test("the master export counts only pipelines that carry EQ", () => {
  const rows = [ROW({ process: PEAK }), ROW({ source: "1", mixdown: "1", process: "" })];
  assert.equal(pipelinesToRewText(rows).count, 1);
});

test("a pipeline set with no parametric EQ exports nothing", () => {
  assert.equal(pipelinesToRewText([ROW({}), ROW({ source: "1" })]).count, 0);
});
