// Behavioral suite for the crossfeed MODE segment (lib/xfmode.js): which of the
// two implementations the user is looking at, and what selecting one does to the
// other.
//
// One rule covers every case here: selecting a mode disables the one being left
// and enables nothing. Arriving at a view is a request to see its controls, never
// to have its processing switched on; leaving one is the opposite reading of the
// same click, and it is what keeps the matrix block and the post-process from
// running in series. Turning either implementation ON is a button the user
// presses, and no test here may find one on by itself.
//
// The mode signal is public (`xfMode`) because the segment writes it and the tab
// reads it; `activeMode(rows)` is the view actually on screen. Both are driven
// here rather than through a rendered click, which SSR cannot do.
//
// Blocks are built with the real compilers — an installed block is the daemon's
// serialization, not a fixture.

import test from "node:test";
import assert from "node:assert/strict";

import {
  xfMode,
  activeMode,
  setXfMode,
  structuralBlock,
  removeStructural,
  stageStructural,
  pipelinesDirty,
} from "../../hqptuner/static/lib/xfmode.js";
import { config, matrixConfig } from "../../hqptuner/static/store/signals.js";
import { effective, effectivePipelines, isDirty } from "../../hqptuner/static/store/resolve.js";
import { stagePipelines, discardAll, edit } from "../../hqptuner/static/store/actions.js";
import { compileRows, HEAD_RADIUS, SPEAKER_ANGLE } from "../../hqptuner/static/lib/binaural.js";
import { msCompile, fitComp, msRecognize, BAUER_PRESETS } from "../../hqptuner/static/lib/xfeed.js";
import { ok, stagingWire } from "./wire.js";

const DEF = BAUER_PRESETS.default;
const EQ = "iir:type=peak;f=1000;q=1;g=-3";

function wire() {
  stagingWire({ fallback: (w) => ok(w.staged) });
}

const row = (source, mixdown) => ({ gain: "-3", gainunit: "dB", mixdown, process: EQ, source });
const pair = () => [row("0", "0"), row("1", "1")];

// The two installed shapes: sixteen structural rows, or eight compensation rows.
const structural = (eqProcess = EQ, srcA = 0, srcB = 1) =>
  compileRows({ lambda: 1, angle: 30, headRadius: HEAD_RADIUS, srcA, srcB, preampDb: -3, eqProcess });
const compensation = () => msCompile(EQ, -3, fitComp(DEF.fc, DEF.feed), 1, 0, 1);

// Full reset every time — the mode signal and the staging buffer both outlive a test.
async function reset({ rows = pair(), enabled = "0", selected = null, fields = [] } = {}) {
  wire();
  matrixConfig.value = {
    fields: [
      { name: "post_bauer_enabled", value: enabled },
      { name: "post_bauer_preset", value: "default" },
      { name: "post_bauer_frequency", value: String(DEF.fc) },
      { name: "post_bauer_level", value: String(DEF.feed) },
    ],
  };
  config.value = { fields, file: { matrix_pipelines: JSON.stringify(rows) } };
  await discardAll();
  xfMode.value = selected;
}

const live = () => effectivePipelines.value;

// --- leaving a mode disables it ----------------------------------------------

test("test_selecting_bauer_removes_the_structural_block", async () => {
  await reset({ rows: structural(), selected: "structural" });
  setXfMode("bauer", live());
  assert.equal(structuralBlock(live()), null);
});

test("test_selecting_structural_removes_the_compensation_block", async () => {
  await reset({ rows: compensation(), enabled: "1", selected: "bauer" });
  setXfMode("structural", live());
  assert.equal(msRecognize(live(), 0, DEF.fc, DEF.feed), null);
});

test("test_selecting_structural_stages_crossfeed_off", async () => {
  await reset({ rows: pair(), enabled: "1", selected: "bauer" });
  setXfMode("structural", live());
  assert.equal(effective("crossfeed_enabled"), "0");
});

// --- arriving at a mode enables nothing ---------------------------------------

test("test_selecting_bauer_leaves_crossfeed_off", async () => {
  await reset({ rows: structural(), enabled: "0", selected: "structural" });
  setXfMode("bauer", live());
  assert.equal(effective("crossfeed_enabled"), "0");
});

test("test_selecting_structural_installs_no_block", async () => {
  await reset({ rows: pair(), selected: "bauer" });
  setXfMode("structural", live());
  assert.equal(structuralBlock(live()), null);
});

// --- turning a mode off is not a mode switch ----------------------------------

test("test_turning_structural_off_keeps_the_structural_view", async () => {
  await reset({ rows: structural(), selected: "structural" });
  removeStructural(live(), structuralBlock(live()));
  assert.equal(activeMode(live()), "structural");
});

// --- turning off hands back the EQ the block is carrying ----------------------
//
// Crossfeed is a transform layered over the EQ, so taking it off subtracts the
// transform and nothing else. The EQ the block is carrying NOW is what comes
// back — not the EQ that happened to be on rows 1+2 when it was installed.

const LOADED = "iir:type=peak;f=4000;q=2;g=-5";

test("test_eq_loaded_while_the_block_is_installed_comes_back_when_it_is_turned_off", async () => {
  await reset({ rows: pair(), selected: "structural" });
  stageStructural(live(), { lambda: 1, angle: 30, headRadius: HEAD_RADIUS });
  // The supported way to load a profile onto an installed block: recompile it.
  stagePipelines(structural(LOADED));
  removeStructural(live(), structuralBlock(live()));
  assert.equal(live()[0].process, LOADED);
});

test("test_a_block_built_on_in_3_returns_its_pair_on_in_3", async () => {
  await reset({ rows: structural(EQ, 2, 3), selected: "structural" });
  removeStructural(live(), structuralBlock(live()));
  assert.equal(live()[0].source, "2");
});

// --- no stored choice: the installed rows answer ------------------------------

test("test_an_installed_block_opens_on_structural", async () => {
  await reset({ rows: structural(), selected: null });
  assert.equal(activeMode(live()), "structural");
});

// --- the ENGAGE/BYPASS gate's pending state in the structural view ------------
//
// There is no config flag for structural crossfeed: "on" is a sixteen-row block
// installed at rows 0..15. So the gate is pending exactly when the staged rows
// disagree with the applied rows about WHETHER a block is installed — never
// about what the block is tuned to, and never about anything else staged.

const DEFAULTS = { lambda: 1, angle: SPEAKER_ANGLE, headRadius: HEAD_RADIUS };

// Sixteen rows the recognizer must not mistake for a block: a plain pass-through
// pair repeated, so the count matches an installed block and nothing else does.
const sixteenPlain = () => Array.from({ length: 8 }, () => pair()).flat();

test("test_nothing_staged_over_a_plain_pair_is_not_pending", async () => {
  await reset({ rows: pair(), selected: "structural" });
  assert.equal(pipelinesDirty(), false);
});

test("test_nothing_staged_over_an_installed_block_is_not_pending", async () => {
  await reset({ rows: structural(), selected: "structural" });
  assert.equal(pipelinesDirty(), false);
});

test("test_staging_a_block_where_there_was_none_is_pending", async () => {
  await reset({ rows: pair(), selected: "structural" });
  stageStructural(live(), DEFAULTS);
  assert.equal(pipelinesDirty(), true);
});

test("test_staging_the_removal_of_an_installed_block_is_pending", async () => {
  await reset({ rows: structural(), selected: "structural" });
  removeStructural(live(), structuralBlock(live()));
  assert.equal(pipelinesDirty(), true);
});

test("test_retuning_an_installed_block_is_not_pending", async () => {
  await reset({ rows: structural(), selected: "structural" });
  stageStructural(live(), { ...DEFAULTS, angle: 45 });
  assert.equal(pipelinesDirty(), false);
});

// The other half: the gate is clean because crossfeed is engaged either way, not
// because nothing was staged. The row edit is real and the pending bar counts it.
test("test_retuning_an_installed_block_stages_a_row_change", async () => {
  await reset({ rows: structural(), selected: "structural" });
  stageStructural(live(), { ...DEFAULTS, angle: 45 });
  assert.equal(isDirty("matrix_pipelines"), true);
});

test("test_staging_the_dsp_pipelines_row_count_is_not_pending", async () => {
  await reset({ rows: pair(), selected: "structural", fields: [{ name: "pipelines", value: "2" }] });
  await edit("pipelines", "4");
  assert.equal(pipelinesDirty(), false);
});

// The gate ignores an edit that genuinely registered, not one that went nowhere.
test("test_editing_the_dsp_pipelines_row_count_stages_that_field", async () => {
  await reset({ rows: pair(), selected: "structural", fields: [{ name: "pipelines", value: "2" }] });
  await edit("pipelines", "4");
  assert.equal(isDirty("pipelines"), true);
});

test("test_staging_extra_rows_past_an_installed_block_is_not_pending", async () => {
  await reset({ rows: structural(), selected: "structural" });
  await stagePipelines([...structural(), ...pair()]);
  assert.equal(pipelinesDirty(), false);
});

test("test_staging_extra_rows_past_an_installed_block_stages_a_row_change", async () => {
  await reset({ rows: structural(), selected: "structural" });
  await stagePipelines([...structural(), ...pair()]);
  assert.equal(isDirty("matrix_pipelines"), true);
});

test("test_staging_a_block_over_sixteen_unrecognized_rows_is_pending", async () => {
  await reset({ rows: sixteenPlain(), selected: "structural" });
  stageStructural(live(), DEFAULTS);
  assert.equal(pipelinesDirty(), true);
});

test("test_discarding_the_staged_block_is_not_pending", async () => {
  await reset({ rows: pair(), selected: "structural" });
  stageStructural(live(), DEFAULTS);
  await discardAll();
  assert.equal(pipelinesDirty(), false);
});
