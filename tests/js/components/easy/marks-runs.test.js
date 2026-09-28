import test from "node:test";
import assert from "node:assert/strict";

import { markRuns } from "../../../../hqptuner/static/components/easy/marks.js";

test("markRuns splits a paragraph into mark, text and stressed runs", () => {
  assert.deepEqual(
    [markRuns("(A) *x*"), markRuns("(A) x")],
    [
      [{ kind: "full" }, { text: " " }, { em: "x" }],
      [{ kind: "full" }, { text: " x" }],
    ],
  );
});
