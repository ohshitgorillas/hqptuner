// Behavioral suite for lib/profilerank.js, the AutoEq profile search ranking.

import test from "node:test";
import assert from "node:assert/strict";

import { rankProfiles } from "../../../hqptuner/static/lib/profilerank.js";

const START = "HD 600";
const BOUNDARY = "Sennheiser HD 650";
const MID = "AKG K371HD";

// Listed in neither rank order nor its reverse. The mid-word match carries the
// preferred source and lands nearer the start of its name than the
// word-boundary match does.
const PROFILES = [
  { model: BOUNDARY, source: "Rtings" },
  { model: MID, source: "oratory1990" },
  { model: START, source: "crinacle" },
];

test("a match at the start of the model ranks first", () => {
  const { hits } = rankProfiles(PROFILES, "hd", 10);
  assert.equal(hits.map((p) => p.model)[0], START);
});

test("a match after a space ranks below the start match and above the mid-word match", () => {
  const { hits } = rankProfiles(PROFILES, "hd", 10);
  assert.equal(hits.map((p) => p.model)[1], BOUNDARY);
});

test("a mid-word match ranks last", () => {
  const { hits } = rankProfiles(PROFILES, "hd", 10);
  assert.equal(hits.map((p) => p.model)[2], MID);
});
