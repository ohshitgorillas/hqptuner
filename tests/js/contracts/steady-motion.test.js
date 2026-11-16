// Contract suite for the second smoothness behavior: each paint shows the moment of playback its own wall time calls for.
// Over a paint the playhead moves as far as the music heard moves over that paint's wall time: it never freezes while the
// music moves, never jumps ahead of it and never steps back. The one exception is a real break, a stop Status shows and the
// break the feed store marks after it. It asks the move and pins no cause.
//
// Each stream (tests/js/contracts/streams.js) is replayed through the real stack (tests/js/contracts/world.js) once; every
// test reads one finding of that replay. The music heard over a paint is read off the stream's own heard clock, never off
// Status `position`, whose steps are larger than a paint. The paints read are those of each track's window after its opening
// stretch, the window the steady lag suite reads. This is a different result from the lag, a level read at each paint: a
// playhead can hold its lag within a frame and still freeze, or stutter. Contract 1 (trace-and-meters.test.js) reads each
// move against wall time and lets the playhead stand at the newest end; this suite reads it against the music heard and
// lets it stand nowhere outside a break.
//
// A move is a freeze when it falls short of the music's move by more than a quarter of it, a jump when it passes it by more
// than a quarter, and a step back when it is negative; a quarter leaves room for a playhead that follows a drifting clock
// with a gentle correction and none for a stutter.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/steady-motion.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { motionProbe, seenOnce } from "./smooth-probes.js";
import { STREAMS } from "./streams.js";

//: Paints a window must hold for the reading to count as one.
const MIN_PAINTS = 20;
const NONE = { count: 0, first: "" };

const seen = seenOnce((stream) => motionProbe(stream.reads, stream.schedule.status ?? []));

for (const stream of STREAMS) {
  stream.reads.forEach((read, k) => {
    const where = `through_serial_${read.serial}_a_${read.kind}_in_${stream.name}`;
    test(`test_the_playhead_never_freezes_while_the_music_moves_${where}`, () => {
      const { read: n, froze } = seen(stream)[k];
      assert.deepEqual({ read: n >= MIN_PAINTS, froze }, { read: true, froze: NONE });
    });

    test(`test_the_playhead_never_jumps_ahead_of_the_music_${where}`, () => {
      const { read: n, jumped } = seen(stream)[k];
      assert.deepEqual({ read: n >= MIN_PAINTS, jumped }, { read: true, jumped: NONE });
    });

    test(`test_the_playhead_never_steps_back_${where}`, () => {
      const { read: n, back } = seen(stream)[k];
      assert.deepEqual({ read: n >= MIN_PAINTS, back }, { read: true, back: NONE });
    });
  });
}
