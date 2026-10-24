import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { drawerSession } from "../../../../hqptuner/static/store/faceplate/drawer/control.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";

afterEach(() => {
  openStage.value = null;
});

// Break: leaving a stage preserves per-opening state into its next opening.
test("test_changing_open_stage_resets_drawer_session", () => {
  openStage.value = "output";
  const session = drawerSession("output");
  session.get("family", "44100");
  openStage.value = "volume";
  openStage.value = "output";
  assert.equal(session.get("family", "96000")?.value, "96000");
});
