// Suite for the rate stage's drawer title in hqptuner/static/components/faceplate/drawers/index.js: the drawer a rail
// stage opens is titled by the name the rail gives that stage, and the stage with id `resampling` takes one of two names
// depending on what plays. Both names are copy, so they are never written here: the
// drawer's title is compared only against the stage's name as the store's rail reports it, over a picture for each name.
//
// The rail is decided from plain running pictures by railStages in hqptuner/static/store/faceplate/chain.js, the same
// shape tests/js/store/faceplate/chain.test.js hands it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-rate-title.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { stageDrawer } from "../../../../hqptuner/static/components/faceplate/drawers/index.js";
import { railStages } from "../../../../hqptuner/static/store/faceplate/chain.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/chain.js").Running} Running */

const RATE_STAGE = "resampling";

const CONV = {
  filter1x: "poly-sinc-gauss-long",
  filterNx: "sinc-Mx",
  shaper: "NS9",
  noise: "standard-fir",
  decim: "poly-sinc-short-mp",
  integ: "IIR2",
  sdmconv: "XFi",
};

/**
 * A running picture: a CD source with the matrix engine on and nothing else engaged, overridden by `over`.
 *
 * @param {Partial<Running>} over
 * @returns {Running}
 */
const running = (over) => ({
  path: "pcm-pcm",
  chain: "pcm",
  stage: "1x",
  direct: false,
  metadata: { samplerate: "44100", bits: "16" },
  status: { active_rate: "352800", active_bits: "32" },
  hf: "none",
  conv: CONV,
  matrix: true,
  profile: "Desk nearfield",
  pipelines: 2,
  working: false,
  crossfeed: null,
  loudness: false,
  applied: 0,
  correction: false,
  model: "",
  volume: "-20",
  speakers: false,
  hidden: [],
  ...over,
});

/** A CD source resampled to 8x by a PCM filter other than `none`. */
const PCM_RESAMPLED = running({});
/** A DSD64 source remodulated to DSD256, no PCM filter in the path. */
const SDM_CONVERTED = running({
  path: "sdm-sdm",
  chain: "sdm",
  metadata: { samplerate: "2822400", bits: "1" },
  status: { active_rate: "11289600", active_bits: "1" },
});

/**
 * The rate stage's name on the rail and its drawer's title, for one running picture.
 *
 * @param {Running} picture
 * @returns {{ name: unknown, title: unknown }}
 */
function nameAndTitle(picture) {
  const st = railStages(picture).find((s) => s.id === RATE_STAGE);
  return st ? { name: st.name, title: stageDrawer(st).schema.title } : { name: null, title: undefined };
}

test("test_the_rate_stages_drawer_is_titled_by_whichever_name_the_rail_gives_the_stage", () => {
  const pictures = [PCM_RESAMPLED, SDM_CONVERTED].map(nameAndTitle);
  assert.deepEqual(
    pictures.map((p) => p.title),
    pictures.map((p) => p.name),
  );
});
