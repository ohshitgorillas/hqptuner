// Behavioral suite for which meters the page's Source levels column shows (hqptuner/static/model/gauges/meter/meters.js).
// Slim, it shows the one meter the Meters pick names and offers the pick; full, it shows the level bars and the VU
// meters both, whatever the pick, and offers no pick.
//
// Run: node --test tests/js/model/gauges/meter/meters.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { metersShown } from "../../../../../hqptuner/static/model/gauges/meter/meters.js";

// The two meters, as the Meters pick holds them.
const LEVELS = "levels";
const VU = "vu";

/** @type {{ name: string, slim: boolean, pick: string, want: { pick: boolean, levels: boolean, vu: boolean } }[]} */
const CASES = [
  {
    name: "slim_under_levels_shows_the_level_bars_alone",
    slim: true,
    pick: LEVELS,
    want: { pick: true, levels: true, vu: false },
  },
  {
    name: "slim_under_vu_shows_the_vu_meters_alone",
    slim: true,
    pick: VU,
    want: { pick: true, levels: false, vu: true },
  },
  {
    name: "full_under_levels_shows_both_and_offers_no_pick",
    slim: false,
    pick: LEVELS,
    want: { pick: false, levels: true, vu: true },
  },
  {
    name: "full_under_vu_shows_both_and_offers_no_pick",
    slim: false,
    pick: VU,
    want: { pick: false, levels: true, vu: true },
  },
];

for (const { name, slim, pick, want } of CASES) {
  test(`test_${name}`, () => {
    assert.deepEqual(metersShown(slim, pick), want);
  });
}
