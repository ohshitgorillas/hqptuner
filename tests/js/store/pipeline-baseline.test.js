// Behavioral suite for the pipeline BASELINE — which of the two sources grounds
// `effectivePipelines` when nothing is staged.
//
// Two sources can ground it: the config file's row set
// (`config.file.matrix_pipelines`, a canonical JSON string) and the daemon's own
// rows (`matrixConfig.rows`, what the engine is running right now). They diverge
// whenever a matrix profile has been switched live — the switch rides 4321
// `MatrixSetProfile`, which is memory-only and never rewrites the config file
// (docs/matrix-spec.md, "4321 MatrixSetProfile — clean live lane"), so the
// engine runs the profile's rows while the file still holds its own.
//
// The wire is faked, not the store: `stagingWire` holds the pending buffer the
// way the backend does, so `stagePipelines` / `discardAll` ride the real REST
// paths (docs/testing.md rule 4).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test \
//        tests/js/store/pipeline-baseline.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { config, matrixConfig, engineState } from "../../../hqptuner/static/store/signals.js";
import { effectivePipelines, stagedCount, canonPipelines } from "../../../hqptuner/static/store/resolve.js";
import { stagePipelines, discardAll } from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire } from "../support/wire.js";

// The daemon's shape: `gain` is a NUMBER and every row carries an `index` the
// file rows do not have.
const DAEMON_ROWS = [
  { index: 0, source: "0", gain: -3, gainunit: "dB", mixdown: "0", process: "iir:type=peak;f=353.8;q=1;gain=-3" },
  { index: 1, source: "1", gain: 0, gainunit: "dB", mixdown: "1", process: "" },
];

// The file's shape, written out by hand the way the backend serializes it:
// alphabetical keys, compact, every value a string, no `index`. A different
// filter frequency from the daemon's, which is exactly how the two read on a
// daemon with a profile switched live.
const FILE_ROWS =
  '[{"gain":"0","gainunit":"dB","mixdown":"0","process":"iir:type=peak;f=3340.8738;q=1;gain=-3","source":"0"}]';

// The daemon's rows in the file shape — what staging the running matrix
// unchanged sends.
const DAEMON_ROWS_AS_STAGED = [
  { gain: "-3", gainunit: "dB", mixdown: "0", process: "iir:type=peak;f=353.8;q=1;gain=-3", source: "0" },
  { gain: "0", gainunit: "dB", mixdown: "1", process: "", source: "1" },
];

// Full reset of every source signal this read model touches — module-level
// signals outlive a test, and `staged` is private, so it clears via discardAll.
async function trees({ rows = [], liveActive = "", file = {} } = {}) {
  engineState.value = {};
  config.value = { fields: [], file, active: "" };
  matrixConfig.value = {
    fields: [],
    rows,
    live_active: liveActive,
    live_profiles: [],
    file_profiles: {},
  };
  stagingWire({
    routes: (path) => {
      if (path === "/api/config") return ok({ data: config.value });
      if (path === "/api/matrix") return ok({ data: matrixConfig.value });
      if (path === "/api/enumerations") return ok({ data: null });
      return undefined;
    },
  });
  await discardAll();
}

// --- which source grounds the baseline --------------------------------------

test("test_a_live_active_profile_makes_the_daemon_rows_the_baseline", async () => {
  await trees({ rows: DAEMON_ROWS, liveActive: "ZMF Ori 3.0", file: { matrix_pipelines: FILE_ROWS } });
  assert.equal(canonPipelines(effectivePipelines.value), canonPipelines(DAEMON_ROWS));
});

test("test_an_empty_live_active_leaves_the_config_file_as_the_baseline", async () => {
  await trees({ rows: DAEMON_ROWS, liveActive: "", file: { matrix_pipelines: FILE_ROWS } });
  assert.equal(canonPipelines(effectivePipelines.value), FILE_ROWS);
});

test("test_a_default_live_active_leaves_the_config_file_as_the_baseline", async () => {
  await trees({ rows: DAEMON_ROWS, liveActive: "[Default]", file: { matrix_pipelines: FILE_ROWS } });
  assert.equal(canonPipelines(effectivePipelines.value), FILE_ROWS);
});

// A profile can be named live-active while the daemon reports no rows at all —
// the file row set is the only thing left to ground the baseline on.
test("test_a_live_active_profile_with_no_daemon_rows_falls_back_to_the_config_file", async () => {
  await trees({ rows: [], liveActive: "ZMF Ori 3.0", file: { matrix_pipelines: FILE_ROWS } });
  assert.equal(canonPipelines(effectivePipelines.value), FILE_ROWS);
});

// The daemon's rows carry an `index` the file shape has no notion of; a baseline
// grounded on them hands back rows in the file shape, not the raw daemon rows.
test("test_daemon_grounded_baseline_rows_carry_no_index_key", async () => {
  await trees({ rows: DAEMON_ROWS, liveActive: "ZMF Ori 3.0", file: { matrix_pipelines: FILE_ROWS } });
  assert.deepEqual(
    effectivePipelines.value.filter((row) => "index" in row),
    [],
  );
});

// --- following the running matrix is not an edit ----------------------------

// A guard against a self-staging resolver, not a discriminator between the two
// baseline sources: loading a profile must not leave a phantom pending change.
test("test_a_live_active_profile_with_nothing_staged_reads_clean", async () => {
  await trees({ rows: DAEMON_ROWS, liveActive: "ZMF Ori 3.0", file: { matrix_pipelines: FILE_ROWS } });
  assert.equal(stagedCount.value, 0);
});

// The daemon's rows arrive with a numeric `gain` and an `index` key; the
// baseline canonicalizes them into the file shape, so staging exactly what the
// engine is running is not a change.
test("test_staging_the_daemon_rows_of_a_live_active_profile_reads_clean", async () => {
  await trees({ rows: DAEMON_ROWS, liveActive: "ZMF Ori 3.0", file: { matrix_pipelines: FILE_ROWS } });
  await stagePipelines(DAEMON_ROWS_AS_STAGED);
  assert.equal(stagedCount.value, 0);
});

// Staging the FILE's rows while a profile is live-active is an edit, because the
// baseline is the daemon's rows, not the file's — this reads clean on any
// implementation that ignores `live_active`.
test("test_staging_the_config_file_rows_over_a_live_active_profile_reads_dirty", async () => {
  await trees({ rows: DAEMON_ROWS, liveActive: "ZMF Ori 3.0", file: { matrix_pipelines: FILE_ROWS } });
  await stagePipelines(JSON.parse(FILE_ROWS));
  assert.equal(stagedCount.value, 1);
});
