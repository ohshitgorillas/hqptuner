// Contract suite for the third smoothness behavior: the spectrogram scrolls at a constant rate in playback time, with no stall
// and no catch-up burst. It reads the picture the Source drawer's real painter draws, never the playhead signal, and pins no
// cause: a picture can fall behind, clear or hold and then jump while the playhead moves smoothly.
//
// Each stream (tests/js/contracts/streams.js) is replayed through the real stack (tests/js/contracts/world.js) once; every
// test reads one finding of that replay. Over each paint of a track's window after its opening stretch, the columns the
// picture scrolled left, matched off its pixels, are set against the columns the music heard over that paint's wall time
// is worth, read off the stream's own heard clock. The picture scrolls whole columns, so a paint may stray by one column
// and by the quarter of the music's move that steady motion allows; a real break (a stop Status shows and the break the
// feed store marks after it) is left out. Contract 2 (spectrogram-picture.test.js) sums the scroll over a whole run; this
// suite reads it paint by paint.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/steady-spectrogram.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { scrollStepProbe, seenOnce } from "./smooth-probes.js";
import { STREAMS } from "./streams.js";

//: Paints a window must hold for the reading to count as one.
const MIN_PAINTS = 20;
const NONE = { count: 0, first: "" };

const seen = seenOnce((stream) => scrollStepProbe(stream.reads, stream.schedule.status ?? []));

for (const stream of STREAMS) {
  stream.reads.forEach((read, k) => {
    const where = `through_serial_${read.serial}_a_${read.kind}_in_${stream.name}`;
    test(`test_the_picture_never_stalls_while_the_music_moves_${where}`, () => {
      const { read: n, stalled } = seen(stream)[k];
      assert.deepEqual({ read: n >= MIN_PAINTS, stalled }, { read: true, stalled: NONE });
    });

    test(`test_the_picture_never_bursts_ahead_of_the_music_${where}`, () => {
      const { read: n, burst } = seen(stream)[k];
      assert.deepEqual({ read: n >= MIN_PAINTS, burst }, { read: true, burst: NONE });
    });

    test(`test_the_picture_can_be_read_at_every_paint_while_the_music_moves_${where}`, () => {
      const { read: n, unread } = seen(stream)[k];
      assert.deepEqual({ read: n >= MIN_PAINTS, unread }, { read: true, unread: NONE });
    });
  });
}
