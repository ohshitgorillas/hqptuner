// Behavioral suite for the eqlab vocab job: term, alias and symptom lookup
// against a vocabulary file the caller names. Written blind from a spec block;
// no eqlab source was read.
//
// The vocabulary is a fixture this file writes into a temp dir and hands over
// as spec.path, so no assertion here comes from the shipped
// docs/eq-assistant/vocabulary.json (docs/testing.md rule 9). Nothing touches
// the daemon or the network.
//
// Known gap: the answer's `rules` field (direction_convention,
// named_quality_field, polysemy) is pinned by no test here, because the spec
// block states no contract a caller branches on. A line naming one would close
// it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/eqlab-vocab.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { vocabJob } from "../../../scripts/eqlab/vocab.js";

/** @typedef {{ term?: string, symptom?: string, senses?: string[] }} Entry */
/** @typedef {{ group?: string, name?: string, matched_as?: string, entry?: Entry }} Match */
/** @typedef {{ matched?: Match[], index?: string[], conflicts?: string[][] }} Answer */

// --- fixture --------------------------------------------------------------------

// Declared lookup names: the terms aaa, bbb, ddd, the alias zzz, the symptom
// sss. ccc and eee appear only inside conflict_pairs and are declared nowhere.
const VOCAB = {
  _meta: {
    conflict_pairs: [
      ["aaa", "ccc"],
      ["ddd", "eee"],
    ],
  },
  tonal: [
    { term: "aaa", aliases: ["zzz"], senses: ["s1", "s2"] },
    { term: "bbb", senses: ["s3"] },
    { term: "ddd", senses: ["s4"] },
  ],
  spatial: [],
  consistency: [{ symptom: "sss", senses: ["s5"] }],
};

const DECLARED = ["aaa", "bbb", "ddd", "sss", "zzz"];

const FIXTURE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "eqlab-vocab-")), "vocabulary.json");
fs.writeFileSync(FIXTURE, JSON.stringify(VOCAB));

// The job answers off one file and resolves no chain, so the context carries
// nothing this kind reads.
const CTX = /** @type {Parameters<typeof vocabJob>[1]} */ (/** @type {unknown} */ ({}));

/**
 * @param {string[]} terms
 * @returns {Promise<Answer>}
 */
const look = async (terms) =>
  /** @type {Answer} */ (/** @type {unknown} */ (await vocabJob({ kind: "vocab", terms, path: FIXTURE }, CTX)));

/**
 * The sense ids the answer carries, keyed by the matched entry's name.
 *
 * @param {Answer} answer
 * @returns {Record<string, string[] | undefined>}
 */
const sensesByName = (answer) =>
  Object.fromEntries((answer.matched || []).map((m) => [String(m.name), (m.entry || {}).senses]));

// --- lookup ---------------------------------------------------------------------

test("a term naming an alias answers the entry whose canonical term carries it", async () => {
  const answer = await look(["zzz"]);
  assert.equal((((answer.matched || [])[0] || {}).entry || {}).term, "aaa");
});

test("a term naming a consistency symptom answers that row", async () => {
  const answer = await look(["sss"]);
  assert.equal((((answer.matched || [])[0] || {}).entry || {}).symptom, "sss");
});

test("every sense the fixture gives a term is answered under that term", async () => {
  const answer = await look(["aaa", "bbb"]);
  assert.deepEqual(sensesByName(answer), { aaa: ["s1", "s2"], bbb: ["s3"] });
});

// --- index and conflicts --------------------------------------------------------

/** @type {[string[], string[]][]} */
const INDEX_CASES = [
  [["qqq"], DECLARED],
  [["aaa"], []],
];

for (const [terms, expected] of INDEX_CASES) {
  test(`index over ${JSON.stringify(terms)} answers ${expected.length} names`, async () => {
    const answer = await look(terms);
    assert.deepEqual([...(answer.index || [])].sort(), expected);
  });
}

/** @type {[string[], string[][]][]} */
const CONFLICT_CASES = [
  [["aaa"], [["aaa", "ccc"]]],
  [["ddd"], [["ddd", "eee"]]],
];

for (const [terms, expected] of CONFLICT_CASES) {
  test(`conflicts over ${JSON.stringify(terms)} answer the rows naming it`, async () => {
    const answer = await look(terms);
    assert.deepEqual(answer.conflicts, expected);
  });
}
