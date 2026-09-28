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

test("a match at the start of the model ranks above one after a space, which ranks above one mid-word", () => {
  const { hits } = rankProfiles(PROFILES, "hd", 10);
  assert.deepEqual(
    hits.map((p) => p.model),
    [START, BOUNDARY, MID],
  );
});
