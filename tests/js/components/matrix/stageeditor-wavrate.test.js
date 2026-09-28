// Suite for the WAV header sample-rate sniff in components/matrix/StageEditor.js:
// a RIFF/WAVE header yields its fmt-chunk rate, a corrupted RIFF tag yields null.
//
// Run: node --test --import ./tests/js/support/vendor-resolve.js tests/js/components/matrix/stageeditor-wavrate.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { wavRateFromHeader } from "../../../../hqptuner/static/components/matrix/StageEditor.js";

/**
 * A canonical 44-byte PCM WAV header: RIFF/WAVE, a 16-byte fmt chunk, an empty data chunk.
 *
 * @param {number} rate
 * @returns {Uint8Array}
 */
function wavHeader(rate) {
  const bytes = new Uint8Array(44);
  const v = new DataView(bytes.buffer);
  const tag = (/** @type {number} */ off, /** @type {string} */ s) => {
    for (let i = 0; i < 4; i++) bytes[off + i] = s.charCodeAt(i);
  };
  tag(0, "RIFF");
  v.setUint32(4, 36, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, 0, true);
  return bytes;
}

test("wavRateFromHeader reads the fmt-chunk rate and rejects a corrupted RIFF tag", () => {
  const good = wavHeader(48000);
  const bad = good.slice();
  bad[0] = 0x58;
  assert.deepEqual(
    [wavRateFromHeader(new DataView(good.buffer)), wavRateFromHeader(new DataView(bad.buffer))],
    [48000, null],
  );
});
