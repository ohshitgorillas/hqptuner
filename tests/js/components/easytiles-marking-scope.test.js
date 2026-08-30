// The clauses of the two-marking contract that its first suite left unguarded.
//
// Each preset tile carries two independent markings, `data-selected` and
// `data-active`, both `"1"`/`"0"` on every tile. SELECTED is what the grid has
// PICKED — the staged preset, or the running one when nothing is staged —
// derived through the effective (staged-or-baseline) values. ACTIVE is what the
// engine is RUNNING, derived through the running values ALONE: the pending
// buffer is excluded from it, and so is any preset preview.
//
// tests/js/components/easytiles-selected.test.js pins the pair once they have
// come apart, on the Output tab, with a preset staged. The four cases here pin
// the rest of the same sentence:
//
//   * the LIVE lane, where nothing stages and the two markings must coincide,
//     so SELECTED lands where the engine's own filters do;
//   * the Output tab with NOTHING staged, where SELECTED falls back to the
//     running preset rather than to no preset at all;
//   * the two OTHER things "running values only" excludes — a preset preview,
//     and a staged output MODE. The mode matters on its own because a preset is
//     matched against a chain, so a match run against the STAGED mode reads the
//     wrong chain's fields and lands elsewhere or nowhere.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The lanes arrive through the exported store signals carrying the
// /api/config, /api/state and /api/enumerations shapes; the staged mode rides
// the real REST staging path through `edit`; the preview arrives as the two
// preview signals a preset click leaves behind, the shape
// tests/js/store/shaperfit-mode-gate.test.js drives. No store function is
// stubbed, and no user-facing word is asserted or selected on (rule 9) — a tile
// is found by its `data-preset`.
//
// Every filter name comes from the shipped table through `running`; none is
// typed out here.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-marking-scope.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const {
  TILE,
  SECOND_TILE,
  resetTab,
  resetLive,
  running,
  oneLit,
  tabs,
  liveCard,
  seedPcmPair,
  activeMap,
  selectedMap,
  liveExpected,
  flush,
} = await import("../support/easytiles.js");
const { previewConfig, pendingPreset } = await import("../../../hqptuner/static/store/signals.js");
const { edit } = await import("../../../hqptuner/static/store/actions.js");

/**
 * A previewed preset, as one click in the presets pane leaves the store: that
 * preset's own field values, keyed by the daemon's form-field names and valued
 * by the engine's enum ids, with the preset pending. Same two signals and same
 * shape tests/js/store/shaperfit-mode-gate.test.js drives; the values come from
 * the shipped table through `liveExpected`, never from a name typed out here.
 *
 * @param {string} presetId
 * @returns {void}
 */
function previewPreset(presetId) {
  previewConfig.value = { mode: "pcm", ...liveExpected(presetId) };
  pendingPreset.value = presetId;
}

/**
 * The Output tab with `TILE`'s filters in the daemon's form and nothing staged
 * over them — the engine running one preset, the grid holding no edit.
 *
 * @returns {Promise<import("../support/wire.js").StagingWire>}
 */
async function runningTile() {
  const set = running(TILE);
  return resetTab({ mode: "pcm", names: seedPcmPair(set.oneX, set.nX) });
}

// ============================================================================
// the LIVE lane: nothing stages, so the two markings coincide
// ============================================================================

test("test_the_live_lane_marks_the_tile_whose_write_set_the_engines_own_filters_match_as_selected", async () => {
  await resetLive({ ...running(TILE) });
  assert.deepEqual(selectedMap(liveCard()), oneLit(TILE));
});

// ============================================================================
// the Output tab with nothing staged: selected falls back to the running preset
// ============================================================================

test("test_with_nothing_staged_the_selected_marking_is_on_the_tile_the_running_filters_match", async () => {
  await runningTile();
  assert.deepEqual(selectedMap(tabs()), oneLit(TILE));
});

// ============================================================================
// what the ACTIVE marking must ignore
// ============================================================================
//
// A preview is not a write: nothing has reached the engine and nothing has been
// staged, so the running preset is still the one running. A card deriving
// ACTIVE through the effective values would follow the preview to the other
// tile.

test("test_a_preset_preview_leaves_the_active_marking_on_the_running_preset", async () => {
  await runningTile();
  previewPreset(SECOND_TILE);
  assert.deepEqual(activeMap(tabs()), oneLit(TILE));
});

// A staged output MODE moves which chain a preset would be matched against. The
// engine is running the PCM chain with `TILE`'s two filters in it and the SDM
// fields on "none", so a match run against the staged SDM mode lights nothing —
// while the engine has not moved and is still running `TILE`.

test("test_a_staged_output_mode_leaves_the_active_marking_on_the_running_preset", async () => {
  const w = await runningTile();
  await edit("output_mode", "sdm");
  await flush(w);
  assert.deepEqual(activeMap(tabs()), oneLit(TILE));
});
