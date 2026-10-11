// The station's saved-snapshot book in a browser that still holds v1's LIVE mode flag. v1 stored LIVE mode's on/off
// state in localStorage under `hqptuner.liveMode`; v2 has no LIVE mode, so a browser holding the flag set reads the
// book off the wire only once v2 asks for it, exactly as a browser that never held the flag does.
//
// Own process on purpose (tests/js/store/presets/apodwindow-pref.test.js is the pattern): the prefs are read from
// storage once at load, so the working fake localStorage is installed and PRE-SEEDED, and the wire fake installed,
// BEFORE any of HQPTuner's modules is imported. Nothing of HQPTuner's is stubbed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/livepresets-v1-livemode.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";
import { rec, presetWire, settle } from "../../support/wire/livepresetwire.js";

/** The key v1 kept LIVE mode's on/off state under, and the value it wrote for on. */
const V1_LIVE_MODE = "hqptuner.liveMode";
const ON = "1";

/** The REST path the book is read from. */
const BOOK = "/api/livepresets";

useStorage().setItem(V1_LIVE_MODE, ON);
const wire = presetWire({ station: "Den", presets: [rec("Warm", "pcm")], others: { "": [rec("Hall", "pcm")] } });

const { bookWanted } = await import("../../../../hqptuner/static/store/live/presets.js");

/** How many times the book has been read off the wire so far. */
const reads = () => wire.calls.filter((c) => c.method === "GET" && c.path.split("?")[0] === BOOK).length;

test("test_a_browser_holding_v1s_live_mode_flag_reads_the_book_only_once_it_is_wanted", async () => {
  await settle();
  const unasked = reads();
  bookWanted.value = true;
  await settle();
  assert.deepEqual([unasked, reads() > 0], [0, true]);
});
