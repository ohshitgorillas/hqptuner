// Source suite for the faceplate's layout effects: every `useLayoutEffect(` call
// in the files that place, measure or fit an element closes on a dependency
// array, so the effect runs when what it positions changes and not on every
// render. Read as text, because what is pinned is the call's shape: a missing
// array is legal Preact and renders the same, only more often.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/layout-effect-deps.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../../../hqptuner/static/components/faceplate/", import.meta.url);

const FILES = [
  "page/Conversion.js",
  "lists/OptionList.js",
  "settings/LogTail.js",
  "ConnPanel.js",
  "lists/Tip.js",
  "builders/SnapshotRail.js",
];

const CALL = "useLayoutEffect(";

/**
 * Whether a call's argument text closes on `, [ … ]`, an optional trailing comma after it.
 *
 * @param {string} args
 */
function closesOnDeps(args) {
  let tail = args.trimEnd();
  if (tail.endsWith(",")) tail = tail.slice(0, -1).trimEnd();
  if (!tail.endsWith("]")) return false;
  return tail.slice(0, tail.lastIndexOf("[")).trimEnd().endsWith(",");
}

/**
 * The argument text of the call opening at `start`, up to its matching `)`.
 *
 * @param {string} src
 * @param {number} start  the index just past the call's `(`
 */
function argsOf(src, start) {
  let depth = 1;
  let i = start;
  while (i < src.length && depth > 0) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") depth -= 1;
    i += 1;
  }
  return src.slice(start, i - 1);
}

/**
 * Whether any layout effect in `src` closes without a deps array.
 *
 * @param {string} src
 */
function lacksDeps(src) {
  let at = src.indexOf(CALL);
  while (at !== -1) {
    if (!closesOnDeps(argsOf(src, at + CALL.length))) return true;
    at = src.indexOf(CALL, at + CALL.length);
  }
  return false;
}

test("test_every_faceplate_layout_effect_names_its_deps", () => {
  const bare = FILES.filter((f) => lacksDeps(readFileSync(new URL(f, ROOT), "utf8")));
  assert.deepEqual(bare, []);
});
