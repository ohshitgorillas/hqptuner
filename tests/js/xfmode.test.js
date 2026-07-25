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

import { xfMode, activeMode, setXfMode, structuralBlock, removeStructural } from "../../hqptuner/static/lib/xfmode.js";
import { config, matrixConfig, effective, effectivePipelines, discardAll } from "../../hqptuner/static/store/state.js";
import { compileRows, HEAD_RADIUS } from "../../hqptuner/static/lib/binaural.js";
import { msCompile, fitComp, msRecognize, BAUER_PRESETS } from "../../hqptuner/static/lib/xfeed.js";

const DEF = BAUER_PRESETS.default;
const EQ = "iir:type=peak;f=1000;q=1;g=-3";

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

// A staging server, not a stub of our own store: it holds the pending buffer the
// way the backend does and echoes it back, so `edit` rides the real REST path.
let staged = { live: {}, http: {} };

function wire() {
  staged = { live: {}, http: {} };
  globalThis.fetch = async (path, opts = {}) => {
    if (path === "/api/config/stage") {
      const body = JSON.parse(opts.body);
      staged = { live: { ...staged.live, ...body.live }, http: { ...staged.http, ...body.http } };
      return ok(staged);
    }
    if (path === "/api/config/pending" && opts.method === "DELETE") {
      staged = { live: {}, http: {} };
      return ok(staged);
    }
    return ok(staged);
  };
}

const row = (source, mixdown) => ({ gain: "-3", gainunit: "dB", mixdown, process: EQ, source });
const pair = () => [row("0", "0"), row("1", "1")];

// The two installed shapes: sixteen structural rows, or eight compensation rows.
const structural = () =>
  compileRows({ lambda: 1, angle: 30, headRadius: HEAD_RADIUS, srcA: 0, srcB: 1, preampDb: -3, eqProcess: EQ });
const compensation = () => msCompile(EQ, -3, fitComp(DEF.fc, DEF.feed), 1, 0, 1);

// Full reset every time — the mode signal and the staging buffer both outlive a test.
async function reset({ rows = pair(), enabled = "0", selected = null } = {}) {
  wire();
  matrixConfig.value = {
    fields: [
      { name: "post_bauer_enabled", value: enabled },
      { name: "post_bauer_preset", value: "default" },
      { name: "post_bauer_frequency", value: String(DEF.fc) },
      { name: "post_bauer_level", value: String(DEF.feed) },
    ],
  };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify(rows) } };
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

// --- no stored choice: the installed rows answer ------------------------------

test("test_an_installed_block_opens_on_structural", async () => {
  await reset({ rows: structural(), selected: null });
  assert.equal(activeMode(live()), "structural");
});
