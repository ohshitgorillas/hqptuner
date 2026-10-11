// Suite for the drawer families of hqptuner/static/store/faceplate/drawer.js against the drawers the app draws: each
// family the store names holds exactly the catalog keys its member drawers hold. The members are every rail stage's
// drawer (components/faceplate/drawers/index.js) and every Settings category's (components/faceplate/settings/
// index.js) that declares the family. A key a member gains or drops without its family following, or a drawer declaring
// a family the store does not name, turns it red.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawer-family-keys.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { stageDrawer } from "../../../../hqptuner/static/components/faceplate/drawers/index.js";
import { CATEGORIES } from "../../../../hqptuner/static/components/faceplate/settings/index.js";
import { railNow, railStages } from "../../../../hqptuner/static/store/faceplate/chain.js";
import { FAMILY_KEYS } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { tabKeys } from "../../../../hqptuner/static/store/faceplate/drawer/grammar.js";

/**
 * Each family's keys, unique and sorted.
 *
 * @param {Readonly<Record<string, readonly string[]>>} byFamily
 * @returns {Record<string, string[]>}
 */
const normal = (byFamily) =>
  Object.fromEntries(Object.entries(byFamily).map(([family, keys]) => [family, [...new Set(keys)].sort()]));

/**
 * The keys the drawn drawers hold, by the family each declares.
 *
 * @returns {Record<string, string[]>}
 */
function drawnFamilies() {
  const schemas = [...railStages(railNow()).map((st) => stageDrawer(st).schema), ...CATEGORIES.map((c) => c.schema)];
  /** @type {Record<string, string[]>} */
  const byFamily = {};
  for (const s of schemas) {
    if (s.family) byFamily[s.family] = [...(byFamily[s.family] ?? []), ...s.tabs.flatMap(tabKeys)];
  }
  return normal(byFamily);
}

test("test_every_family_holds_exactly_the_keys_its_member_drawers_hold", () => {
  assert.deepEqual(drawnFamilies(), normal(FAMILY_KEYS));
});
