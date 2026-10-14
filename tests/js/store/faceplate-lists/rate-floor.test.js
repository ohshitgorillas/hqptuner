// Behavioral suite for the shaper lists' Minimum rate chips (hqptuner/static/store/faceplate/lists/options.js): a chip
// is a floor, not an exact tier. On the modulator list a picked floor keeps every modulator whose rate floor is at or
// above it; on the dither list a picked floor keeps every dither whose rate marker is at or above it; with several
// chips picked, the lowest pick decides.
//
// The wire is the seam (tests/js/support/listsfixture.js), widened here to three tiered modulators on the loaded SDM
// chain's <GetShapers/> enumeration, each with the rate floor its overlay records, and to one more dither on the
// dormant PCM chain's /config form whose plain leaf carries a higher rate marker. Every name asserted is the
// fixture's own.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-lists/rate-floor.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { flushNarrowing } from "../../../../hqptuner/static/store/narrow/persist.js";
import { narrowedOptions } from "../../../../hqptuner/static/store/faceplate/lists/options.js";
import { setFacet } from "../../../../hqptuner/static/store/faceplate/lists/facets.js";
import { config, enums, metadata } from "../../../../hqptuner/static/store/signals.js";
import { favoritesWire } from "../../support/wire/favoriteswire.js";
import { loadLists, resetLists } from "../../support/listsfixture.js";

const MOD_256 = "DSD7 256+fs";
const MOD_512 = "ASDM7EC 512+fs";
const MOD_1024 = "ASDM7EC 1024+fs";

const TIER_256 = "256+";
const TIER_512 = "512+";
const TIER_1024 = "1024+";

/** The engine names of the tiered modulators, with the rate floor each one's overlay records. */
const TIERED = [
  { name: MOD_256, min_rate_hz: 10240000 },
  { name: MOD_512, min_rate_hz: 20480000 },
  { name: MOD_1024, min_rate_hz: 40960000 },
];

const DITHER_4X = "NS9";
const DITHER_16X = "LNS15";
const MARKER_4X = "≥4x";

/** Replace the loaded SDM chain's modulators with the three tiered ones, overlays and all. */
function serveTieredModulators() {
  enums.value = {
    ...enums.value,
    shapers: TIERED.map((m, i) => ({ index: String(i), value: String(10 + i), name: m.name })),
  };
  const meta = metadata.value;
  metadata.value = {
    ...meta,
    shapers: {
      ...meta.shapers,
      sdm_modulators: Object.fromEntries(TIERED.map((m) => [m.name, { min_rate_hz: m.min_rate_hz, generation: 4 }])),
    },
  };
}

/** Add a dither whose plain leaf carries a rate marker above the fixture's own NS9 to the dormant PCM chain's form. */
function serveHigherDither() {
  config.value = {
    ...config.value,
    fields: config.value.fields.map((/** @type {{ name: string, options: { value: string, label: string }[] }} */ f) =>
      f.name === "dither" ? { ...f, options: [...f.options, { value: "6", label: DITHER_16X }] } : f,
    ),
  };
  const meta = metadata.value;
  const dithers = meta.plain_names.dithers;
  metadata.value = {
    ...meta,
    plain_names: {
      ...meta.plain_names,
      dithers: {
        ...dithers,
        entries: {
          ...dithers.entries,
          [DITHER_16X]: { family: "Noise shaping", variant: null, leaf: "Fifteenth order, ≥16x", short: DITHER_16X },
        },
      },
    },
  };
}

beforeEach(() => {
  favoritesWire();
  resetLists();
  loadLists();
});

afterEach(async () => {
  await flushNarrowing();
});

/**
 * The engine names a key's list keeps under the narrowing set, sorted so engine order plays no part.
 *
 * @param {string} key
 */
const kept = (key) =>
  narrowedOptions(key, "1x")
    .map((o) => o.v)
    .sort();

test("test_a_modulator_rate_floor_keeps_the_modulators_above_it_as_well_as_at_it", () => {
  serveTieredModulators();
  setFacet("modTier", [TIER_512]);
  assert.deepEqual(kept("sdm_modulator"), [MOD_1024, MOD_512].sort());
});

test("test_the_lowest_of_several_picked_modulator_rate_floors_decides", () => {
  serveTieredModulators();
  setFacet("modTier", [TIER_1024, TIER_256]);
  assert.deepEqual(kept("sdm_modulator"), [MOD_1024, MOD_256, MOD_512].sort());
});

test("test_a_dither_rate_floor_keeps_the_dithers_above_it_as_well_as_at_it", () => {
  serveHigherDither();
  setFacet("ditherRate", [MARKER_4X]);
  assert.deepEqual(kept("pcm_dither"), [DITHER_16X, DITHER_4X].sort());
});
