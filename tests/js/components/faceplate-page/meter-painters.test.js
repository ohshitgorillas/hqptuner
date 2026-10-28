// Suite for the canvas painters of hqptuner/static/components/faceplate/page/SourceMeter.js (timing rule 6:
// a painter is a factory with one instance per root, created when the root mounts). Changing what the meter shows,
// its channels, slim or full, Levels or VU, leaves the running spectrum effects where they are: the effects canvas keeps
// the one effects painter it had and the GL canvas its one aurora painter, so nothing restarts and no graphics
// resources pile up.
//
// Mounting. The section is mounted with preact's client renderer into tests/js/support/painters/livedom.js, every
// element laid out BOX_W by BOX_H, so its layout effects, effects and re-renders run; each change is made through the
// store it belongs to and the page settles after it. The stream reaches the stores at the wire: playback through a
// fresh /api/status object on a Ready connection, the feed through the EventSource fake
// (tests/js/support/eventsource.js), its frames sent by `follow` (tests/js/support/meterfeed.js) in the meter feed's
// wire shape. The feed and the meter loop run on one fake clock (tests/js/support/clock.js), so the meter loop paints
// as the clock moves. A change of channels is a new geometry event on the same stream, the frames after it carrying
// the new count. The Meters pick and the spectrum style go through the prefs store's setters, read off the module
// namespace with optional access.
//
// Reading the painters. Every canvas the page creates is tests/js/support/painters/canvasledger.js's, which counts
// the drawing contexts asked of it by kind: the effects canvas is drawn in 2d, the aurora's in webgl2. A run mounts
// the section, paints for PLAY_MS, makes the change or not, and paints for PLAY_MS more. The asks of a run with the
// change, over the asks of the same run without it, are 1 where the change set nothing up again, more where it set up
// painters afresh, and NaN where the run without the change asked none.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/meter-painters.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SourceMeter } from "../../../../hqptuner/static/components/faceplate/page/SourceMeter.js";
import { engineStatus, health } from "../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { initMeterLoop } from "../../../../hqptuner/static/store/meter/loop.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import * as uiPrefs from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { fakeClock } from "../../support/clock.js";
import { MONO_BINS, RATE_44K, follow, geometry } from "../../support/meterfeed.js";
import { liveDom } from "../../support/painters/livedom.js";
import { canvasLedger } from "../../support/painters/canvasledger.js";

/** @typedef {import("../../support/painters/livedom.js").LiveDom} LiveDom */

const FULL = { w: 1366, h: 1024 };
const SLIM = { w: 1080, h: 810 };

/** The lifecycle generation of the Ready connection every case starts on. */
const GEN = 3;

//: The channels the stream reports before a change, and after a change of channels.
const STEREO = 2;
const SIX = 6;

//: One channel's reading in every frame sent.
const READING = { peak: -6.5, rms: -12.25, bins: MONO_BINS };
//: Samples at RATE_44K each frame covers: 22.7 ms.
const FRAME_N = 1000;
//: Frames sent each half of a run, and the wall time, ms, the clock moves on after them: several paints.
const FRAMES = 20;
const PLAY_MS = 500;

//: The size every element is laid out at, CSS pixels.
const BOX_W = 600;
const BOX_H = 200;

//: The two meters on offer, as the store holds them.
const LEVELS = "levels";
const VU = "vu";

//: The canvases, by the context each is drawn in and the spectrum style that shows it.
const CANVASES = /** @type {const} */ ([
  ["effects", "2d", "bars"],
  ["aurora", "webgl2", "aurora"],
]);

/** @type {{ setMeters?(v: string): void, setSpectrumStyle?(v: string): void }} */
const prefs = uiPrefs;

//: The one clock the feed and the meter loop pace on for the life of the file, as they do for the life of a page.
const fake = fakeClock();

/**
 * The changes to what the meter shows: each with the view it starts from, and the change itself, which returns the
 * channels the frames after it carry.
 *
 * @type {[string, () => void, () => number][]}
 */
const CHANGES = [
  [
    "a_change_of_channels",
    () => (viewport.value = FULL),
    () => {
      lastStream()?.emit("geometry", geometry(RATE_44K, SIX));
      return SIX;
    },
  ],
  [
    "going_slim",
    () => (viewport.value = FULL),
    () => {
      viewport.value = SLIM;
      return STEREO;
    },
  ],
  [
    "a_slim_pick_of_vu_over_levels",
    () => (viewport.value = SLIM),
    () => {
      prefs.setMeters?.(VU);
      return STEREO;
    },
  ],
];

/**
 * Send FRAMES frames of `channels` channels, move the clock on PLAY_MS and settle the page.
 *
 * @param {{ advance: (ms: number) => void }} clock
 * @param {LiveDom} dom
 * @param {number} channels
 */
function play(clock, dom, channels) {
  for (let i = 0; i < FRAMES; i++) follow(new Array(channels).fill(READING), FRAME_N);
  clock.advance(PLAY_MS);
  dom.settle();
}

/**
 * The contexts of `kind` asked in a run under spectrum style `style` from the view `from` sets, with `change` made
 * halfway, or none where it is null.
 *
 * @param {string} kind
 * @param {string} style
 * @param {() => void} from
 * @param {(() => number) | null} change
 */
function asksOver(kind, style, from, change) {
  prefs.setSpectrumStyle?.(style);
  from();
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state: "2" }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(fake.clock);
  initMeterLoop(fake.clock);
  lastStream()?.emit("geometry", geometry(RATE_44K, STEREO));
  /** @type {LiveDom} */
  const dom = liveDom(() => ({ width: BOX_W, height: BOX_H }));
  dom.install();
  const ledger = canvasLedger();
  try {
    render(html`<${SourceMeter} />`, dom.root);
    dom.settle();
    play(fake, dom, STEREO);
    const channels = change ? change() : STEREO;
    dom.settle();
    play(fake, dom, channels);
    return ledger.asked(kind);
  } finally {
    render(null, dom.root);
    ledger.uninstall();
    dom.uninstall();
    closeMeterFeed();
  }
}

/**
 * The asks of `kind` in a run with `change` made, over those of the same run without it; NaN where that one asked
 * none.
 *
 * @param {string} kind
 * @param {string} style
 * @param {() => void} from
 * @param {() => number} change
 */
function askedWithChange(kind, style, from, change) {
  const without = asksOver(kind, style, from, null);
  prefs.setMeters?.(LEVELS);
  const changed = asksOver(kind, style, from, change);
  return without > 0 ? changed / without : Number.NaN;
}

beforeEach(() => {
  health.value = { phase: "Ready", generation: GEN };
  useStorage();
  prefs.setMeters?.(LEVELS);
  viewport.value = FULL;
});

for (const [changeName, from, change] of CHANGES) {
  for (const [canvasName, kind, style] of CANVASES) {
    test(`test_${changeName}_keeps_the_${canvasName}_canvas_s_one_painter`, () => {
      assert.equal(askedWithChange(kind, style, from, change), 1);
    });
  }
}
