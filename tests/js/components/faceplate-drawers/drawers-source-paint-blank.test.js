// Suite for meterPainter in hqptuner/static/components/faceplate/drawers/source/paint.js, the picture half: while music
// plays, the spectrogram never shows a blank column for music that has played. A column is blank when every pixel of it
// is the glass the painter is handed; the music's own columns are the ones from the first column that is not glass to
// the last, so a blank column is a glass column with music on both sides of it. Glass to the right of the last music
// column is the edge not yet drawn to, and is not read.
//
// The cases play a feed of 44.1 kHz frames, 17.4 and 23.1 ms long, into the history and move the playhead the way the
// meter loop does, one paint every 16.7 ms of music, then read the pixels the painter leaves on a canvas that keeps them
// (pixelCanvas below). Three situations, each its own claim: the playhead stands at the newest end of the
// music between bursts, which is where the loop leaves it whenever the queue runs dry; the playhead trails the newest
// end by 20 ms, a little under one slice, a frame arriving between paints; and the playhead trails it by 150 ms, well
// inside the buffer. Each ends with a burst of 15 frames and the playhead moving on to 150 ms behind the newest end,
// so every slice up to the edge has closed by the last paint and the music it covers is all there to be drawn. The
// window is the finest the page offers, 30 s: a 60 s window, the default, drew no blank column on these feeds on the
// code the cases were written against, so it is not read.
//
// The painter is created on a canvas pair and a token reader that answers only the glass, so no ramp color can be taken
// for it. The playhead is the exported signal the loop publishes, written directly; no loop runs, and each case sets it
// back to null when it ends. The history is cleared by a track change through the poll seam before each case.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-source-paint-blank.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { SPEC_SIZE, meterPainter } from "../../../../hqptuner/static/components/faceplate/drawers/source/paint.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { setSpectrogramSpan } from "../../../../hqptuner/static/store/faceplate/drawers/source.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import {
  closeMeterFeed,
  openMeterFeed,
  takeMeterFrames,
  toSpectrogram,
} from "../../../../hqptuner/static/store/meter/feed.js";
import {
  METER_RANGES,
  setApodWindow,
  setMeterChannel,
  setMeterRange,
} from "../../../../hqptuner/static/store/ui/prefs.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { initSpectrogram } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { MONO_BINS, RATE_44K, follow, geometry } from "../../support/meterfeed.js";
import { dropStorage, useStorage } from "../../support/storage.js";
import { fakeClock } from "../../support/clock.js";
import { newTrack, poll } from "../../support/apodpolls.js";

const SECOND_MS = 1000;
const STRIP_WIDTH = 600;

/** The glass the painter is handed, red, green, blue; the token reader answers it for `--glass` and nothing else. */
const GLASS = [10, 11, 12];
const TOKENS = { getPropertyValue: (/** @type {string} */ name) => (name === "--glass" ? "#0a0b0c" : "") };

/** Event lengths, samples at 44.1 kHz, in turn: 17.4 and 23.1 ms. */
const LENGTHS = [768, 768, 768, 1020, 1020, 1020, 768, 1020];

/** The frames in each burst between stands, in turn: they set where in a slice each stand falls. */
const BURSTS = [3, 5, 2, 4, 7, 3, 6, 2, 5, 4, 3, 6, 2, 7, 4, 5, 3, 2, 6, 4, 5, 3, 7, 2];

/** Frames sent before the first paint, and where the playhead stands then, playback ms. */
const FIRST_FRAMES = 30;
const FIRST_HEAD_MS = 100;

/** Playback, ms, the playhead moves per paint. */
const PAINT_MS = 16.7;

/** How far behind the newest end the last paints leave the playhead, playback ms, and the frames of the last burst. */
const LAST_BEHIND_MS = 150;
const LAST_BURST = 15;

/** Frames the trailing cases send, one before each paint. */
const TRAILING_PAINTS = 60;

/** The trailing cases' distance behind the newest end, playback ms. */
const CLOSE_MS = 20;
const INSIDE_MS = 150;

/** The apodizing window, s: the finest the page offers, 25 ms a column. */
const WINDOW = "30";

initApodHistory();
initSpectrogram();

/** @type {(() => void) | null} */
let dispose = null;

beforeEach(() => {
  openStage.value = "source";
  setSpectrogramSpan("full");
  useStorage();
  setMeterChannel("sum");
  setMeterRange(METER_RANGES[0] ?? "");
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state: "2" }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(fakeClock().clock);
  lastStream()?.emit("geometry", geometry(RATE_44K));
  newTrack();
  poll();
});

afterEach(() => {
  if (dispose) dispose();
  dispose = null;
  playhead.value = null;
  closeMeterFeed();
  dropStorage();
});

// A canvas that keeps the pixels a painter puts on it, in color. Its 2D context keeps one RGBA image of the canvas's
// size; `putImageData` writes the image's dirty rectangle (the whole image when none is given) at the destination the
// browser puts it, and `drawImage` of the canvas onto itself copies the source rectangle to the destination rectangle,
// reading the whole source before the copy writes. A call on the context that this canvas does not draw is absent, so a
// painter using one fails by throwing.

/**
 * @typedef {object} PixelCanvas
 * @property {number} width
 * @property {number} height
 * @property {Uint8ClampedArray} data  RGBA, row by row
 * @property {() => unknown} getContext
 */

/**
 * A canvas of `width` by `height` pixels, every byte 0.
 *
 * @param {number} width
 * @param {number} height
 * @returns {PixelCanvas}
 */
export function pixelCanvas(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  /** @type {PixelCanvas} */
  const canvas = { width, height, data, getContext: () => ctx };
  const ctx = {
    /** @param {number} w @param {number} h */
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    /**
     * @param {{ width: number, height: number, data: Uint8ClampedArray }} img
     * @param {number} x
     * @param {number} y
     * @param {number[]} dirty  the dirty rectangle's x, y, width and height, each optional
     */
    putImageData: (img, x, y, ...dirty) => {
      const [sx = 0, sy = 0, sw = img.width, sh = img.height] = dirty;
      for (let r = sy; r < sy + sh; r++) {
        const from = (r * img.width + sx) * 4;
        data.set(img.data.subarray(from, from + sw * 4), ((y + r) * width + x + sx) * 4);
      }
    },
    /**
     * The canvas onto itself: `sw` by `sh` pixels at `sx`, `sy` drawn at `dx`, `dy`, the same size.
     *
     * @param {unknown} _src
     * @param {number[]} rects  the source's x, y, width and height, then the destination's x and y
     */
    drawImage: (_src, ...rects) => {
      const [sx, sy, sw, sh, dx, dy] = rects;
      const before = data.slice();
      for (let r = 0; r < sh; r++) {
        const from = ((sy + r) * width + sx) * 4;
        data.set(before.subarray(from, from + sw * 4), ((dy + r) * width + dx) * 4);
      }
    },
  };
  return canvas;
}

/**
 * The columns of `canvas` in which every pixel is `color`, left to right.
 *
 * @param {PixelCanvas} canvas
 * @param {ArrayLike<number>} color  red, green, blue
 * @returns {number[]}
 */
export function columnsOf(canvas, color) {
  const { width, height, data } = canvas;
  const out = [];
  for (let x = 0; x < width; x++) {
    let all = true;
    for (let y = 0; y < height && all; y++) {
      const p = (y * width + x) * 4;
      all = data[p] === color[0] && data[p + 1] === color[1] && data[p + 2] === color[2];
    }
    if (all) out.push(x);
  }
  return out;
}

/**
 * One feed and its playhead: frames follow each other from the music's start, and the playhead only moves on.
 *
 * @returns {{ send: (count: number) => void, move: (to: number) => void, end: () => number }}
 */
function music() {
  let sent = 0;
  let newest = 0;
  let head = FIRST_HEAD_MS;
  return {
    send: (count) => {
      for (let i = 0; i < count; i++) {
        const n = LENGTHS[sent++ % LENGTHS.length];
        follow([{ peak: -10, rms: -20, bins: MONO_BINS }], n);
        newest += (n * SECOND_MS) / RATE_44K;
        toSpectrogram(takeMeterFrames());
      }
    },
    // One paint per call, the playhead moving PAINT_MS toward `to` and no further; a `to` behind it moves nothing.
    move: (to) => {
      head = Math.max(head, Math.min(head + PAINT_MS, to));
      playhead.value = head;
    },
    end: () => newest,
  };
}

/**
 * Mount the painter on the music the first frames made, play the feed `plays` out, and count the blank columns the
 * spectrogram shows at the end.
 *
 * @param {(m: ReturnType<typeof music>) => void} plays
 * @returns {{ music: number, blank: number }}  the columns from the first non-glass one to the last, and those of them
 *   that are glass
 */
function blankColumns(plays) {
  setApodWindow(WINDOW);
  const m = music();
  m.send(FIRST_FRAMES);
  playhead.value = FIRST_HEAD_MS;
  const spec = pixelCanvas(SPEC_SIZE.width, SPEC_SIZE.height);
  const strip = pixelCanvas(STRIP_WIDTH, 1);
  dispose = meterPainter(
    /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (spec)),
    /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (strip)),
    /** @type {CSSStyleDeclaration} */ (/** @type {unknown} */ (TOKENS)),
  );
  plays(m);
  m.send(LAST_BURST);
  for (let i = 0; i < SPEC_SIZE.width; i++) m.move(m.end() - LAST_BEHIND_MS);
  const glass = columnsOf(spec, GLASS);
  let first = 0;
  while (glass.includes(first)) first++;
  let last = SPEC_SIZE.width - 1;
  while (glass.includes(last)) last--;
  return { music: last - first + 1, blank: glass.filter((x) => x > first && x < last).length };
}

/** The playhead moves to the newest end and stands there; a burst arrives; again, for each burst of BURSTS. */
const standsBetweenBursts = (/** @type {ReturnType<typeof music>} */ m) => {
  for (const burst of BURSTS) {
    for (let i = 0; i < SPEC_SIZE.width && playhead.value !== m.end(); i++) m.move(m.end());
    m.send(burst);
  }
  for (let i = 0; i < SPEC_SIZE.width && playhead.value !== m.end(); i++) m.move(m.end());
};

/** One frame arrives before each paint, and the playhead keeps `behind` ms behind the newest end. */
const trailing = (/** @type {number} */ behind) => (/** @type {ReturnType<typeof music>} */ m) => {
  for (let i = 0; i < TRAILING_PAINTS; i++) {
    m.send(1);
    playhead.value = Math.max(playhead.value ?? 0, m.end() - behind);
  }
};

test("test_the_spectrogram_shows_no_blank_column_where_the_playhead_stood_at_the_newest_end", () => {
  const shown = blankColumns(standsBetweenBursts);
  assert.deepEqual({ some: shown.music > 1, blank: shown.blank }, { some: true, blank: 0 });
});

test("test_the_spectrogram_shows_no_blank_column_with_the_playhead_close_to_the_newest_end", () => {
  const shown = blankColumns(trailing(CLOSE_MS));
  assert.deepEqual({ some: shown.music > 1, blank: shown.blank }, { some: true, blank: 0 });
});

test("test_the_spectrogram_shows_no_blank_column_with_the_playhead_inside_the_buffer", () => {
  const shown = blankColumns(trailing(INSIDE_MS));
  assert.deepEqual({ some: shown.music > 1, blank: shown.blank }, { some: true, blank: 0 });
});
