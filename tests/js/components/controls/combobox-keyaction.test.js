// Unit suite for the open combobox's arrow-key decision (controls/Combobox.js
// `keyAction`): an arrow move past the last visible row in either direction
// stays on the row it started from.
//
// Run: node --test --import ./tests/js/support/vendor-resolve.js tests/js/components/controls/combobox-keyaction.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { keyAction } from "../../../../hqptuner/static/components/controls/Combobox.js";

const ROWS = [
  { o: { value: "a", label: "A" }, oi: 0 },
  { o: { value: "b", label: "B" }, oi: 1 },
  { o: { value: "c", label: "C" }, oi: 2 },
];
const VISIBLE = (/** @type {unknown} */ row) => row !== ROWS[1];

test("arrow moves clamp at the first and last visible rows", () => {
  assert.deepEqual(
    [
      keyAction("ArrowDown", { open: true, hl: 2, rows: ROWS, visible: VISIBLE }),
      keyAction("ArrowUp", { open: true, hl: 0, rows: ROWS, visible: VISIBLE }),
    ],
    [
      { kind: "move", index: 2 },
      { kind: "move", index: 0 },
    ],
  );
});

test("each key decides its action closed and open, moves skipping the hidden row", () => {
  /** @type {[string, boolean][]} */
  const KEYS = [
    ["ArrowDown", false],
    ["x", false],
    ["ArrowDown", true],
    ["Home", true],
    ["End", true],
    ["Enter", true],
    ["Escape", true],
    ["Tab", true],
    ["x", true],
  ];
  assert.deepEqual(
    KEYS.map(([key, open]) => keyAction(key, { open, hl: 0, rows: ROWS, visible: VISIBLE })),
    [
      { kind: "show", index: -1 },
      { kind: "none", index: -1 },
      { kind: "move", index: 2 },
      { kind: "move", index: 0 },
      { kind: "move", index: 2 },
      { kind: "commit", index: 0 },
      { kind: "close", index: -1 },
      { kind: "tab", index: -1 },
      { kind: "none", index: -1 },
    ],
  );
});
