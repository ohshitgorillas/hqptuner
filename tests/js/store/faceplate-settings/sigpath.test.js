// Behavioral suite for hqptuner/static/store/faceplate/settings/sigpath.js: the signal path map's nodes, groups and
// edges, what each path lights, and signalMap, which decides the map's readout, lit and engaged sets and lamps from a
// plain running picture.
//
// Node ids and path ids are identifiers the map joins on, so they may be asserted verbatim; the readout names and the
// key's lines are copy and are compared only against the module's own exports.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-settings/sigpath.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NODES,
  EDGES,
  MATRIX_PARTS,
  PATH_NAME,
  litOf,
  signalMap,
} from "../../../../hqptuner/static/store/faceplate/settings/sigpath.js";
import { railStages } from "../../../../hqptuner/static/store/faceplate/chain.js";
import { pathLamps } from "../../../../hqptuner/static/model/gauges/wire.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/chain.js").Running} Running */

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
 * A running picture: a CD source playing to a PCM rate with the matrix engine on and nothing else engaged.
 *
 * @param {Partial<Running>} [over]
 * @returns {Running}
 */
function running(over = {}) {
  return {
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
  };
}

/**
 * A running picture on one path at one source stage, its chain and Direct SDM flag set the way that path runs them.
 *
 * @param {Running["path"]} path
 * @param {Running["stage"]} stage
 * @returns {Running}
 */
const onPath = (path, stage) =>
  running({
    path,
    stage,
    chain: ["pcm-sdm", "sdm-sdm", "direct"].includes(path) ? "sdm" : "pcm",
    direct: path === "direct",
  });

/**
 * A set or list of ids, sorted, so two of them compare by membership.
 *
 * @param {Iterable<string>} ids
 * @returns {string[]}
 */
const sorted = (ids) => [...ids].sort();

const NODE_IDS = NODES.map((n) => n.id);

/** @type {Running["path"][]} */
const PATHS = ["idle", "pcm-pcm", "pcm-sdm", "dsd-pcm", "sdm-sdm", "direct"];

/** @type {Running["stage"][]} */
const STAGES = ["1x", "nx"];

const MATRIX = ["pl", "xf", "ld"];
/** @param {string} shaper */
const tail = (shaper) => ["dc", "vo", shaper, "sp", "out"];

/** @type {[Running["path"], Running["stage"], string[]][]} */
const LIT = [
  ["idle", "1x", []],
  ["idle", "nx", []],
  ["pcm-pcm", "1x", ["p1", "f1", ...MATRIX, ...tail("di")]],
  ["pcm-pcm", "nx", ["pn", "hf", "fn", ...MATRIX, ...tail("di")]],
  ["pcm-sdm", "1x", ["p1", "f1", ...MATRIX, ...tail("mo")]],
  ["pcm-sdm", "nx", ["pn", "hf", "fn", ...MATRIX, ...tail("mo")]],
  ["dsd-pcm", "1x", ["ds", "nf", "de", ...MATRIX, "fn", ...tail("di")]],
  ["dsd-pcm", "nx", ["ds", "nf", "de", ...MATRIX, "fn", ...tail("di")]],
  ["sdm-sdm", "1x", ["ds", "rm", ...MATRIX, "rc", ...tail("mo")]],
  ["sdm-sdm", "nx", ["ds", "rm", ...MATRIX, "rc", ...tail("mo")]],
  ["direct", "1x", ["ds", "sp", "out"]],
  ["direct", "nx", ["ds", "sp", "out"]],
];

for (const [path, stage, ids] of LIT) {
  test(`test_a_${path}_path_at_${stage}_lights_its_nodes`, () => {
    assert.deepEqual(sorted(litOf(path, stage)), sorted(ids));
  });
}

for (const [path, stage] of LIT) {
  test(`test_the_map_on_a_${path}_path_at_${stage}_lights_what_the_path_lights`, () => {
    assert.deepEqual(sorted(signalMap(onPath(path, stage)).lit), sorted(litOf(path, stage)));
  });
}

test("test_an_unknown_path_lights_nothing", () => {
  assert.deepEqual(sorted(litOf("pcm-dsd", "1x")), []);
});

test("test_every_id_a_path_lights_is_a_node", () => {
  const strays = PATHS.flatMap((p) => STAGES.flatMap((s) => [...litOf(p, s)])).filter((id) => !NODE_IDS.includes(id));
  assert.deepEqual(strays, []);
});

test("test_node_ids_are_unique", () => {
  assert.equal(new Set(NODE_IDS).size, NODE_IDS.length);
});

test("test_every_edge_joins_two_nodes", () => {
  const strays = EDGES.flatMap((e) => [e.a, e.b]).filter((id) => !NODE_IDS.includes(id));
  assert.deepEqual(strays, []);
});

test("test_the_direct_sdm_bypass_is_the_first_edge", () => {
  assert.deepEqual(EDGES[0], { a: "ds", b: "sp", direct: true });
});

test("test_the_direct_sdm_bypass_is_the_only_direct_edge", () => {
  assert.equal(EDGES.filter((e) => e.direct).length, 1);
});

test("test_every_path_has_a_readout_name", () => {
  assert.deepEqual(
    PATHS.filter((p) => !(p in PATH_NAME)),
    [],
  );
});

test("test_every_path_reads_out_under_its_own_name", () => {
  assert.equal(new Set(PATHS.map((p) => PATH_NAME[p])).size, PATHS.length);
});

for (const path of PATHS) {
  test(`test_the_map_on_a_${path}_path_reads_out_that_paths_name`, () => {
    assert.equal(signalMap(onPath(path, "1x")).name, PATH_NAME[path]);
  });
}

test("test_the_map_counts_engaged_the_rail_stages_whose_lamps_are_lit", () => {
  const r = running({ crossfeed: "bauer", hf: "20k" });
  const lamps = railStages(r)
    .filter((s) => s.on)
    .map((s) => s.id);
  assert.deepEqual(sorted(signalMap(r).engaged), sorted(lamps));
});

test("test_an_engaged_crossfeed_under_a_running_matrix_reads_engaged", () => {
  assert.equal(signalMap(running({ crossfeed: "bauer" })).engaged.has("crossfeed"), true);
});

test("test_an_engaged_crossfeed_under_a_stopped_matrix_does_not_read_engaged", () => {
  assert.equal(signalMap(running({ crossfeed: "bauer", matrix: false })).engaged.has("crossfeed"), false);
});

test("test_the_map_on_the_direct_path_reads_direct", () => {
  assert.equal(signalMap(onPath("direct", "1x")).direct, true);
});

test("test_the_map_on_a_remodulated_dsd_path_does_not_read_direct", () => {
  assert.equal(signalMap(onPath("sdm-sdm", "1x")).direct, false);
});

const DIRECT_EDGE = EDGES.findIndex((e) => e.direct);

test("test_the_direct_sdm_bypass_lights_on_the_direct_path", () => {
  assert.equal(signalMap(onPath("direct", "1x")).edges[DIRECT_EDGE], true);
});

test("test_the_direct_sdm_bypass_stays_dark_on_a_remodulated_dsd_path", () => {
  assert.equal(signalMap(onPath("sdm-sdm", "1x")).edges[DIRECT_EDGE], false);
});

test("test_the_direct_sdm_bypass_stays_dark_on_a_pcm_path", () => {
  assert.equal(signalMap(onPath("pcm-pcm", "1x")).edges[DIRECT_EDGE], false);
});

/**
 * What pathLamps answers for a map decided from a running picture.
 *
 * @param {ReturnType<typeof signalMap>} m
 */
const lampsFor = (m) =>
  pathLamps({ lit: m.lit, engaged: m.engaged, nodes: NODES, edges: EDGES, matrix: MATRIX_PARTS, direct: m.direct });

test("test_the_map_node_lamps_are_what_path_lamps_answers", () => {
  const m = signalMap(running({ path: "dsd-pcm", matrix: false }));
  assert.deepEqual(m.nodes, lampsFor(m).nodes);
});

test("test_the_map_edge_lamps_are_what_path_lamps_answers", () => {
  const m = signalMap(onPath("pcm-sdm", "nx"));
  assert.deepEqual(m.edges, lampsFor(m).edges);
});
