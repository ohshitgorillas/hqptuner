// The signal path map's data and its decision: every node, group frame and edge of the map, what each path lights, and
// signalMap, which reads the running picture into the map's readout, its lit and engaged sets and its lamps.

// Signal path (Settings → Signal path): every path HQPlayer can take, one map, drawn in the faceplate's grammar, with the
// path playing now lit. The chain rail shows the running path one stage at a time; this is the whole map behind it.
//   Lit (playing now)   wire and lettering in ink; the rest stays dim (ink-2 lettering, line-2 wire). No accent: this is
//                       running state, not a setting (accent marks what you set and where you are).
//   PCM / SDM tag       runs only in that output mode (the Output drawer's band-tag grammar). `PCM · SDM` = both modes, each
//                       its own list (the 1x / Nx filters).
//   Hatched             on the path but bypassed (gate off, filter none): hatch is for what doesn't run.
//   Rate zones          source rate | output rate, tinted bands; the seam runs through Resampling (it converts).
//   Dashed              position not confirmed by a source (DAC correction, Volume: output rate, before Shaping).
// Sources: manual 6 §2.8 (HF filter: 2x and higher sources), §5 (Speakers at target rate), §7.2 (pipelines at source
// rate), §2.15 (volume before dither); Jussi (Audiophile Style, as Miska): convolution "at the source rate … after
// conversion to PCM" for DSD → PCM; "DAC correction runs at the output rate"; DAC correction needs the matrix enabled.

import { railStages } from "../chain.js";
import { pathLamps } from "../../../model/gauges/wire.js";

/**
 * @typedef {import("../chain.js").Running} Running
 * @typedef {object} SgPoint  a node's place and lettering
 * @property {number} x
 * @property {number} y
 * @property {string} label
 * @property {string} [sub]
 * @property {string} [tag]
 * @property {boolean} [unv]
 * @property {boolean} [src]
 * @property {string} [rail]
 * @typedef {SgPoint & { id: string }} SgNode  a node with its id
 * @typedef {object} SgEdge  an edge between two node ids
 * @property {string} a
 * @property {string} b
 * @property {boolean} [direct]
 * @property {boolean} [vertical]
 * @typedef {object} SignalMap  the map as the running picture lights it
 * @property {string} name  the readout
 * @property {Set<string>} lit  the ids on the path playing
 * @property {Set<string>} engaged  the chain rail stages whose lamps are lit
 * @property {boolean} direct  Direct SDM plays
 * @property {Record<string, {lit: boolean, off: boolean}>} nodes
 * @property {boolean[]} edges  one per entry of EDGES, in order
 */

// Column centres: sources | DSD front end · HF | matrix | resampling | DAC correction ↓ Volume | shaping | Speakers ↓ Output.
const X = [66, 214, 366, 518, 668, 816, 962];

/**
 * Nodes: id → {x, y, label, sub?, tag?, unv?, src?, rail?} (rail: the chain stage whose lamp says engaged).
 * @type {Record<string, SgPoint>}
 */
const N = {
  p1: { x: X[0], y: 77, label: "PCM source", sub: "1x · ≤ 50 kHz", src: true },
  pn: { x: X[0], y: 187, label: "PCM source", sub: "Nx · > 50 kHz", src: true },
  ds: { x: X[0], y: 385, label: "DSD source", src: true },
  hf: { x: X[1], y: 187, label: "HF filter", rail: "hf" },
  nf: { x: X[1], y: 341, label: "Noise filter", tag: "PCM" },
  de: { x: X[1], y: 429, label: "Decimation", tag: "PCM" },
  rm: { x: X[1], y: 528, label: "Remodulator", tag: "SDM" },
  pl: { x: X[2], y: 132, label: "DSP pipelines", rail: "pipelines" },
  xf: { x: X[2], y: 231, label: "Crossfeed", rail: "crossfeed" },
  ld: { x: X[2], y: 330, label: "Loudness", rail: "loudness" },
  f1: { x: X[3], y: 132, label: "1x filter", sub: "1x sources", tag: "PCM · SDM" },
  fn: { x: X[3], y: 231, label: "Nx filter", sub: "Nx · DSD → PCM", tag: "PCM · SDM" },
  rc: { x: X[3], y: 330, label: "Rate conversion", sub: "DSD → SDM", tag: "SDM" },
  dc: { x: X[4], y: 182, label: "DAC correction", unv: true, rail: "correction" },
  vo: { x: X[4], y: 281, label: "Volume", unv: true },
  di: { x: X[5], y: 231, label: "Dither", tag: "PCM" },
  mo: { x: X[5], y: 330, label: "Modulator", tag: "SDM" },
  sp: { x: X[6], y: 281, label: "Speakers", rail: "speakers" },
  out: { x: X[6], y: 402, label: "Output", src: true },
};

/** @type {SgNode[]} */
export const NODES = Object.entries(N).map(([id, n]) => ({ id, ...n }));

/**
 * Edges: [from, to, label?]. Vertical ones (inside a group) join bottom → top.
 * @type {[string, string, (string | null)?, 'v'?][]}
 */
const E = [
  ["p1", "pl"],
  ["pn", "hf"],
  ["hf", "pl"],
  ["ds", "nf"],
  ["nf", "de", null, "v"],
  ["de", "pl"],
  ["ds", "rm"],
  ["rm", "pl"],
  ["pl", "xf", null, "v"],
  ["xf", "ld", null, "v"],
  ["ld", "f1"],
  ["ld", "fn"],
  ["ld", "rc"],
  ["f1", "dc"],
  ["fn", "dc"],
  ["rc", "dc"],
  ["dc", "vo", null, "v"],
  ["vo", "di"],
  ["vo", "mo"],
  ["di", "sp"],
  ["mo", "sp"],
  ["sp", "out", null, "v"],
];

/** @type {SgEdge[]} */
export const EDGES = [
  { a: "ds", b: "sp", direct: true },
  ...E.map(([a, b, , v]) => (v === "v" ? { a, b, vertical: true } : { a, b })),
];

/**
 * What each path runs (stage = the source's 1x | nx).
 *
 * @param {string} p
 * @param {string} stage
 * @returns {string[]}
 */
export function litOf(p, stage) {
  /** @param {string} sh */
  const tail = (sh) => ["dc", "vo", sh, "sp", "out"];
  const mx = ["pl", "xf", "ld"];
  const src = stage === "nx" ? ["pn", "hf", "fn"] : ["p1", "f1"];
  switch (p) {
    case "pcm-pcm":
      return [...src, ...mx, ...tail("di")];
    case "pcm-sdm":
      return [...src, ...mx, ...tail("mo")];
    case "dsd-pcm":
      return ["ds", "nf", "de", ...mx, "fn", ...tail("di")];
    case "sdm-sdm":
      return ["ds", "rm", ...mx, "rc", ...tail("mo")];
    case "direct":
      return ["ds", "sp", "out"];
    default:
      return [];
  }
}

/** @type {Record<string, string>} */
export const PATH_NAME = {
  // DRAFT (agent): the Settings rail readout
  idle: "Not playing",
  "pcm-pcm": "PCM → PCM",
  "pcm-sdm": "PCM → SDM",
  "dsd-pcm": "DSD → PCM",
  "sdm-sdm": "DSD → SDM",
  direct: "DSD → Direct SDM",
};

// Bypassed on the path: the matrix gate takes its parts and DAC correction with it (DAC correction needs the matrix).
export const MATRIX_PARTS = ["pl", "xf", "ld", "dc"];

/**
 * The map for what runs: the path's readout, what it lights, the rail stages engaged and the lamps they decide.
 *
 * @param {Running} running
 * @returns {SignalMap}
 */
export function signalMap(running) {
  const lit = new Set(litOf(running.path, running.stage));
  const engaged = new Set(
    railStages(running)
      .filter((s) => s.on)
      .map((s) => s.id),
  );
  const direct = running.path === "direct";
  const lamps = pathLamps({ lit, engaged, nodes: NODES, edges: EDGES, matrix: MATRIX_PARTS, direct });
  return { name: PATH_NAME[running.path], lit, engaged, direct, nodes: lamps.nodes, edges: lamps.edges };
}
