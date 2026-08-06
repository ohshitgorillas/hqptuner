// Behavioral suite for the half of the live-volume wiring that PlaybackVolume
// owns: publishing the drag.
//
// The knob is the only place a drag starts, and every other surface that shows
// the playback level — the Range bar's needle, the Loudness plot — reads it back
// off the shared `volumeDrag` signal. So the card's contract is exactly two
// things: while the drag is in flight `volumeDrag` carries the dB the knob is
// at, and on release it goes back to null with `volume` left carrying the level
// the user let go at. tests/js/components/volumerangebar-needle.test.js and
// tests/js/components/loudness-drag.test.js pin the reading half.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders the exported `PlaybackVolume`, which takes no props, and reads the
// exported store signals — the same surface every other component has. Nothing
// of ours is stubbed: the gesture bubbles the dial's own ancestor chain with
// events shaped the way a browser shapes them (tests/js/support/pointer.js), and
// the wire is a staging fake answering the real REST paths, `POST /api/volume`
// among them (docs/settings-classification.md: the live volume's own immediate
// write path, never staged).
//
// tests/js/components/playbackvolume.test.js owns the card's rendered contract —
// ARIA range, readout, disabled reasons — and documents the drag as unreachable
// from a render-only route; this file is that gap closed, not a second copy of
// it. Nothing here asserts on the markup.
//
// A drag that published nothing throws rather than handing a case a null to pass
// on: "the release cleared it" must not be satisfiable by a drag that never set
// it in the first place.
//
// State reset is total on every call: module-level signals outlive a test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/playbackvolume-drag.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { PlaybackVolume } from "../../../hqptuner/static/components/PlaybackVolume.js";
import {
  volume,
  volumeDrag,
  volumeRange,
  config,
  engineState,
  matrixConfig,
} from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { fastVolumeUpdates } from "../../../hqptuner/static/store/prefs.js";
import { ok, stagingWire } from "../support/wire.js";
import { knobDrag } from "../support/pointer.js";

// A live volume control: the card only drags when the engine reports one.
const ON = { enabled: "1", min: "-60", max: "0" };
const POLLED = "-20";

// Where the press lands, and two travels from it — down the dial for a quieter
// level, back up for a louder one.
const START_Y = 200;
const DOWN_Y = 230;
const UP_Y = 170;

// The daemon's own live-volume endpoint, answering a write with the level it set
// (tests/js/store/polling.test.js pins that readback shape). It is scenery here:
// these cases are about the signal the card publishes, not about the write.
function reset() {
  const w = stagingWire({
    routes: (path, opts, x) => {
      if (path === "/api/volume" && opts.method === "POST") {
        x.posts.push(JSON.parse(opts.body));
        return ok({ volume: POLLED });
      }
    },
    fallback: (x) => ok(x.staged),
  });
  volume.value = POLLED;
  volumeDrag.value = null;
  volumeRange.value = ON;
  fastVolumeUpdates.value = false;
  engineState.value = {};
  matrixConfig.value = null;
  config.value = { fields: [], file: {} };
  return w;
}

const card = () => html`<${PlaybackVolume} />`;

// A drag under way on the card's knob, pressed and pulled down the dial.
async function draggingCard() {
  reset();
  await discardAll();
  const drag = knobDrag(card());
  drag.down(START_Y);
  drag.move(DOWN_Y, 1);
  if (volumeDrag.value === null) throw new Error("the drag published no level, so there is nothing for a case to read");
  return drag;
}

// --- while the drag is in flight ---------------------------------------------

test("test_a_drag_down_the_dial_publishes_a_quieter_level_than_the_polled_one", async () => {
  await draggingCard();
  assert.ok(volumeDrag.value < Number(POLLED));
});

test("test_a_drag_back_up_the_dial_republishes_the_louder_level", async () => {
  // continuous, not once at the press: the surfaces reading this signal follow
  // the knob the whole way
  const drag = await draggingCard();
  const quieter = volumeDrag.value;
  drag.move(UP_Y, 1);
  assert.ok(volumeDrag.value > quieter);
});

// --- when the user lets go ---------------------------------------------------

test("test_a_released_drag_clears_the_published_level", async () => {
  const drag = await draggingCard();
  drag.up(DOWN_Y);
  assert.equal(volumeDrag.value, null);
});

test("test_a_released_drag_leaves_the_engine_level_at_the_value_let_go_of", async () => {
  const drag = await draggingCard();
  // snapshotted BEFORE the release, so the case states the level it expects
  const released = volumeDrag.value;
  drag.up(DOWN_Y);
  assert.equal(volume.value, String(released));
});

test("test_a_drag_that_loses_its_pointer_also_clears_the_published_level", async () => {
  // the context-menu case: the pointerup never arrives, and the next move says
  // the button is gone (tests/js/components/knob-lost-pointer.test.js)
  const drag = await draggingCard();
  drag.move(DOWN_Y, 0);
  assert.equal(volumeDrag.value, null);
});
