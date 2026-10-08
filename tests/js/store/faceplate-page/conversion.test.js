// Behavioral suite for hqptuner/static/store/faceplate/page/conversion.js: the page's Resampling and Shaping sections,
// read off what runs. Each section holds the running chain's fields, each field's engine name at the index the engine
// reports, whether this track's path runs it, its plain-name breakdown and the prose of the option it runs; which field
// is open, the running filter unless the user opened another for the same playback, and both filters on a plate tall
// enough; and a pick, written live by the option's enum ID.
//
// The wire is the seam: /api/state into `engineState`, the enumerations into `enums`, the Status frame into
// `engineStatus`, the /config form into `config`, the overlay bundle into `metadata`, the window into `viewport`, and
// every pick goes out over a faked `globalThis.fetch` on POST /api/config/live.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-page/conversion.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  config,
  engineState,
  engineStatus,
  enums,
  liveOverride,
  metadata,
  staged,
} from "../../../../hqptuner/static/store/signals.js";
import { plainNames } from "../../../../hqptuner/static/store/ui/prefs.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/view.js";
import {
  conversionSections,
  openField,
  pickOption,
} from "../../../../hqptuner/static/store/faceplate/page/conversion.js";
import { ok } from "../../support/wire/wire.js";
import { settle } from "../../support/wire/livepresetwire.js";

const CD = "44100";
const HIRES = "96000";
const DSD64 = "2822400";
const PCM_8X = "352800";
const DSD256 = "11289600";

const FILTERS = ["poly-sinc-short", "poly-sinc-long", "sinc-Mx"];
const SHAPERS = ["TPDF", "NS9", "LNS15"];

/**
 * The globals the fake wire installs a `fetch` on, viewed as an optional member.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/**
 * One enumeration item as the daemon sends it: every attribute a string, the enum ID apart from the list index.
 *
 * @param {string} name
 * @param {number} i
 */
const item = (name, i) => ({ index: String(i), value: String(100 + i), name });

const META = {
  filters: {
    filters: {
      "poly-sinc-long": { description: "fixture-prose-long" },
      "sinc-Mx": { description: "fixture-prose-mx" },
    },
    aliases: {},
  },
  shapers: {
    pcm_dithers: { NS9: { description: "fixture-prose-ns9" } },
    sdm_modulators: { NS9: { description: "fixture-prose-mod" } },
  },
  settings: {},
  plain_names: {
    filters: {
      entries: {
        "poly-sinc-long": { family: "fixture-family", variant: "fixture-variant", leaf: "fixture-leaf", short: "s" },
      },
      families: {},
      variants: {},
    },
  },
};

/**
 * @typedef {object} Running
 * @property {string} [source]  the source's sample rate, Hz
 * @property {string} [output]  the output's rate, Hz
 * @property {boolean} [playing]
 * @property {string} [chain]   the chain the engine has loaded
 * @property {string} [f1x]     the 1x filter's list index
 * @property {string} [fnx]     the Nx filter's list index
 * @property {string} [shaper]  the shaper's list index
 */

/**
 * Write one running engine onto the wire-side signals: by default a CD source playing to a PCM rate.
 *
 * @param {Running} [r]
 */
function wire({
  source = CD,
  output = PCM_8X,
  playing = true,
  chain = "pcm",
  f1x = "1",
  fnx = "2",
  shaper = "1",
} = {}) {
  engineState.value = { state: playing ? "2" : "0", active_chain: chain, filter1x: f1x, filterNx: fnx, shaper };
  enums.value = { filters: FILTERS.map(item), shapers: SHAPERS.map(item) };
  engineStatus.value = { status: { active_rate: output }, metadata: { samplerate: source } };
  config.value = { fields: [{ name: "direct_sdm", value: false }] };
  staged.value = { live: {}, http: {} };
  liveOverride.value = {};
  metadata.value = META;
  plainNames.value = false;
  viewport.value = { w: 1080, h: 810 };
}

/** The same engine playing to an SDM rate, the SDM chain loaded. */
const sdm = () => wire({ output: DSD256, chain: "sdm" });

// A live-lane server: every POST /api/config/live body is recorded and answered verified, once `held` resolves where a
// case passes one, and the re-mirror reads answer the State and enumerations the case seeded.
function liveWire(/** @type {Promise<void> | null} */ held = null) {
  /** @type {unknown[]} */
  const posts = [];
  env.fetch = async (/** @type {string} */ path, /** @type {{ body?: string }} */ opts = {}) => {
    if (path === "/api/config/live") {
      posts.push(JSON.parse(String(opts.body)));
      if (held) await held;
      return ok({ report: { live: [], stored: {} } });
    }
    if (path === "/api/state") return ok({ data: { ...engineState.value } });
    if (path === "/api/enumerations") return ok({ data: { ...enums.value } });
    return ok({});
  };
  return posts;
}

// Each case starts from a playback of its own: the engine stops before it plays, so no open field a case before it
// picked survives.
beforeEach(() => {
  wire({ playing: false });
  wire();
});

/** The keys of one section's fields. @param {"resampling" | "shaping"} s */
const keys = (s) => conversionSections()[s].fields.map((f) => f.key);

/**
 * One field of one section, by its id.
 *
 * @param {"resampling" | "shaping"} s
 * @param {string} id
 */
const fieldOf = (s, id) => conversionSections()[s].fields.find((f) => f.id === id);

/** Every field's idle flag, Resampling's then Shaping's. */
const idles = () => {
  const s = conversionSections();
  return [...s.resampling.fields, ...s.shaping.fields].map((f) => f.idle);
};

// --- which fields ------------------------------------------------------------------------

test("test_resampling_holds_the_pcm_chains_filters_on_a_pcm_output", () => {
  assert.deepEqual(keys("resampling"), ["pcm_filter_1x", "pcm_filter_nx"]);
});

test("test_resampling_holds_the_sdm_chains_filters_on_an_sdm_output", () => {
  sdm();
  assert.deepEqual(keys("resampling"), ["sdm_filter_1x", "sdm_filter_nx"]);
});

test("test_shaping_holds_the_dither_on_a_pcm_output", () => {
  assert.deepEqual(keys("shaping"), ["pcm_dither"]);
});

test("test_shaping_holds_the_modulator_on_an_sdm_output", () => {
  sdm();
  assert.deepEqual(keys("shaping"), ["sdm_modulator"]);
});

// --- what each field reads ---------------------------------------------------------------

test("test_the_1x_filter_reads_the_engine_name_at_the_index_the_engine_reports", () => {
  assert.equal(fieldOf("resampling", "1x")?.value, "poly-sinc-long");
});

test("test_the_shaper_reads_the_engine_name_at_the_index_the_engine_reports", () => {
  wire({ shaper: "2" });
  assert.equal(fieldOf("shaping", "sh")?.value, "LNS15");
});

test("test_a_filter_carries_the_prose_of_the_option_it_runs", () => {
  assert.equal(fieldOf("resampling", "nx")?.prose, "fixture-prose-mx");
});

test("test_a_shaper_carries_the_prose_of_the_option_it_runs", () => {
  assert.equal(fieldOf("shaping", "sh")?.prose, "fixture-prose-ns9");
});

test("test_a_field_carries_the_plain_family_of_the_option_it_runs", () => {
  plainNames.value = true;
  assert.equal(fieldOf("resampling", "1x")?.fam, "fixture-family");
});

test("test_a_field_carries_the_plain_variant_of_the_option_it_runs", () => {
  plainNames.value = true;
  assert.equal(fieldOf("resampling", "1x")?.variant, "fixture-variant");
});

test("test_simplified_option_style_names_the_option_by_its_plain_leaf", () => {
  plainNames.value = true;
  assert.equal(fieldOf("resampling", "1x")?.leaf, "fixture-leaf");
});

test("test_standard_option_style_names_the_option_by_its_engine_name", () => {
  assert.equal(fieldOf("resampling", "1x")?.leaf, "poly-sinc-long");
});

// --- idle ------------------------------------------------------------------------------------

test("test_a_base_rate_source_runs_the_1x_filter_and_the_shaper", () => {
  assert.deepEqual(idles(), [false, true, false]);
});

test("test_a_high_rate_source_runs_the_nx_filter_and_the_shaper", () => {
  wire({ source: HIRES });
  assert.deepEqual(idles(), [true, false, false]);
});

test("test_nothing_playing_runs_no_field", () => {
  wire({ playing: false });
  assert.deepEqual(idles(), [true, true, true]);
});

test("test_a_remodulated_dsd_source_runs_the_shaper_alone", () => {
  wire({ source: DSD64, output: DSD256, chain: "sdm" });
  assert.deepEqual(idles(), [true, true, false]);
});

// --- which field is open -----------------------------------------------------------------

test("test_a_base_rate_source_opens_the_1x_filter", () => {
  assert.deepEqual(conversionSections().resampling.open, ["1x"]);
});

test("test_a_high_rate_source_opens_the_nx_filter", () => {
  wire({ source: HIRES });
  assert.deepEqual(conversionSections().resampling.open, ["nx"]);
});

test("test_a_dsd_source_to_pcm_opens_the_nx_filter", () => {
  wire({ source: DSD64 });
  assert.deepEqual(conversionSections().resampling.open, ["nx"]);
});

test("test_shaping_opens_its_shaper", () => {
  assert.deepEqual(conversionSections().shaping.open, ["sh"]);
});

test("test_opening_a_folded_field_opens_it", () => {
  openField("resampling", "nx");
  assert.deepEqual(conversionSections().resampling.open, ["nx"]);
});

test("test_a_new_output_reopens_on_the_running_filter", () => {
  openField("resampling", "nx");
  sdm();
  assert.deepEqual(conversionSections().resampling.open, ["1x"]);
});

test("test_a_plate_tall_enough_opens_both_filters", () => {
  viewport.value = { w: 1366, h: 1024 };
  assert.deepEqual(conversionSections().resampling.open, ["1x", "nx"]);
});

// --- a pick -----------------------------------------------------------------------------------

test("test_picking_a_filter_writes_its_enum_id_live", async () => {
  const posts = liveWire();
  await pickOption("pcm_filter_1x", "sinc-Mx");
  assert.deepEqual(posts, [{ fields: { filter1x: "102" } }]);
});

test("test_picking_a_modulator_writes_its_enum_id_live", async () => {
  sdm();
  const posts = liveWire();
  await pickOption("sdm_modulator", "TPDF");
  assert.deepEqual(posts, [{ fields: { modulator: "100" } }]);
});

test("test_picking_the_running_option_writes_nothing", async () => {
  const posts = liveWire();
  await pickOption("pcm_filter_1x", FILTERS[1]);
  assert.deepEqual(posts, []);
});

test("test_picking_the_running_option_while_a_pick_is_unsettled_writes_it", async () => {
  /** @type {() => void} */
  let release = () => {};
  const posts = liveWire(
    new Promise((resolve) => {
      release = () => resolve();
    }),
  );
  const first = pickOption("pcm_filter_1x", FILTERS[2]);
  await settle();
  const second = pickOption("pcm_filter_1x", FILTERS[1]);
  await settle();
  release();
  await Promise.all([first, second]);
  assert.deepEqual(posts, [{ fields: { filter1x: "102" } }, { fields: { filter1x: "101" } }]);
});
