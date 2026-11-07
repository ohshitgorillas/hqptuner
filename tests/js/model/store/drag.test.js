// Behavioral suite for hqptuner/static/model/store/drag.js: what a drag does at a move and at its drop, for each of the
// four named drag modes. Each test reads one member of the step across the drag's two events, a move then the drop, so
// a step that is right at one event and wrong at the other fails it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/store/drag.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { dragStep } from "../../../../hqptuner/static/model/store/drag.js";

/** @typedef {import("../../../../hqptuner/static/model/store/drag.js").DragStep} DragStep */
/** @typedef {import("../../../../hqptuner/static/model/store/drag.js").DragMode} DragMode */

/**
 * One mode and what it writes at a move, then at the drop.
 *
 * @type {{ mode: DragMode, writes: [DragStep["write"], DragStep["write"]], name: string }[]}
 */
const WRITES = [
  { mode: "stage", writes: ["none", "stage"], name: "writes_nothing_while_moving_and_stages_on_drop" },
  { mode: "stage-each", writes: ["stage", "stage"], name: "stages_on_every_move_and_again_on_drop" },
  { mode: "preview", writes: ["none", "live"], name: "writes_nothing_while_moving_and_writes_live_on_drop" },
  {
    mode: "throttle",
    writes: ["live-throttled", "live"],
    name: "writes_live_throttled_while_moving_and_live_on_drop",
  },
];

for (const row of WRITES) {
  test(`test_a_${row.mode}_drag_${row.name}`, () => {
    assert.deepEqual([dragStep(row.mode, "move").write, dragStep(row.mode, "drop").write], row.writes);
  });
}

/**
 * One mode and whether the page holds the value at a move, then at the drop. A drag that stages clears at its drop,
 * because the staged value carries it from there; a drag that writes live holds past its drop, because nothing else
 * carries the value until the readback.
 *
 * @type {{ mode: DragMode, locals: [DragStep["local"], DragStep["local"]], name: string }[]}
 */
const LOCALS = [
  { mode: "stage", locals: ["hold", "clear"], name: "holds_its_value_while_moving_and_lets_go_on_drop" },
  { mode: "stage-each", locals: ["hold", "clear"], name: "holds_its_value_while_moving_and_lets_go_on_drop" },
  { mode: "preview", locals: ["hold", "hold"], name: "holds_its_value_while_moving_and_past_the_drop" },
  { mode: "throttle", locals: ["hold", "hold"], name: "holds_its_value_while_moving_and_past_the_drop" },
];

for (const row of LOCALS) {
  test(`test_a_${row.mode}_drag_${row.name}`, () => {
    assert.deepEqual([dragStep(row.mode, "move").local, dragStep(row.mode, "drop").local], row.locals);
  });
}
