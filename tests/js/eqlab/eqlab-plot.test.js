// Behavioral suite for the eqlab `plot` job kind, written blind from a spec
// block: no eqlab plot source was read. Exercises the public subprocess
// surface only — `node scripts/eqlab/eqlab.js` fed one JSON job on stdin,
// answering JSON on stdout, a human table on stderr, exit 0 on success.
//
// Fully offline: literal band chains and inline targets, temp dirs per call.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/eqlab-plot.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const eqlabPath = fileURLToPath(new URL("../../../scripts/eqlab/eqlab.js", import.meta.url));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "eqlab-plot-"));
const outPath = () => path.join(tmp(), "out.svg");

const CHAIN = { bands: [{ type: "peak", f: 1000, q: 1, g: 3 }] };
const AGAINST = { bands: [{ type: "peak", f: 2000, q: 2, g: -2 }] };
const FLAT = { from: "flat", align: "none" };

// Runs one plot job through the real subprocess surface. `jobSpec` fills the
// job object (kind fixed to "plot"); `top` overrides top-level keys — pass
// `{ target: undefined }` to drop the target (JSON.stringify omits undefined).
/**
 * @param {Record<string, unknown>} jobSpec
 * @param {Record<string, unknown>} [top]
 */
function runPlot(jobSpec, top = {}) {
  const job = { fs: 44100, chain: CHAIN, target: FLAT, ...top, job: { kind: "plot", ...jobSpec } };
  const res = spawnSync("node", [eqlabPath], { input: JSON.stringify(job), encoding: "utf8" });
  let out = null;
  try {
    out = JSON.parse(res.stdout);
  } catch {
    out = null;
  }
  return { status: res.status, out, stderr: res.stderr, rawOut: res.stdout };
}

/**
 * @param {string} p
 * @returns {string}
 */
const svgAt = (p) => fs.readFileSync(p, "utf8");

/**
 * @param {string} s
 * @returns {string}
 */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param {string} name
 * @returns {RegExp}
 */
const seriesElementRe = (name) => new RegExp(`<(?:polyline|path)\\b[^>]*data-series="${escapeRe(name)}"`);

/**
 * @param {string} name
 * @returns {RegExp}
 */
const legendTextRe = (name) => new RegExp(`<text\\b[^>]*>${escapeRe(name)}</text>`);

/**
 * @param {string} text
 * @param {RegExp} re
 * @returns {number}
 */
const countOf = (text, re) => (text.match(re) || []).length;

/**
 * [ok, message] for spreading into ONE assert.ok — house idiom.
 *
 * @param {unknown} text
 * @param {string[]} parts
 * @returns {[boolean, string]}
 */
const containsAll = (text, parts) => {
  const missing = parts.filter((s) => !String(text).includes(s));
  return [missing.length === 0, `expected all of ${JSON.stringify(parts)} in: ${text}`];
};

// --- 1. success shape -------------------------------------------------------------

test("test_a_successful_plot_writes_a_file_at_path", () => {
  const p = outPath();
  runPlot({ path: p });
  assert.ok(fs.existsSync(p), `expected ${p} to exist`);
});

test("test_a_successful_plot_exits_zero", () => {
  const { status } = runPlot({ path: outPath() });
  assert.equal(status, 0);
});

test("test_the_answer_echoes_the_path_written", () => {
  const p = outPath();
  const { out } = runPlot({ path: p });
  assert.equal(out.path, p);
});

test("test_the_answers_limits_carry_a_numeric_grid_point_count", () => {
  // Every eqlab answer's limits object carries a grid; its points count is the
  // named contract fact anchored here.
  const { out } = runPlot({ path: outPath() });
  assert.equal(typeof out.limits.grid.points, "number");
});

// --- 2. path required, overwrite gate ---------------------------------------------

test("test_a_plot_job_without_a_path_errors", () => {
  const { status } = runPlot({});
  assert.notEqual(status, 0);
});

test("test_plotting_onto_an_existing_file_without_overwrite_exits_nonzero", () => {
  const p = outPath();
  fs.writeFileSync(p, "precious");
  const { status } = runPlot({ path: p });
  assert.notEqual(status, 0);
});

test("test_the_exists_error_names_the_path_and_the_overwrite_remedy", () => {
  const p = outPath();
  fs.writeFileSync(p, "precious");
  const { out } = runPlot({ path: p });
  assert.ok(...containsAll(out.error, [p, '"overwrite": true']));
});

test("test_the_exists_error_leaves_the_existing_file_byte_identical", () => {
  const p = outPath();
  fs.writeFileSync(p, "precious");
  runPlot({ path: p });
  assert.equal(svgAt(p), "precious");
});

test("test_overwrite_true_replaces_the_existing_file_with_svg", () => {
  const p = outPath();
  fs.writeFileSync(p, "precious");
  runPlot({ path: p, overwrite: true });
  assert.match(svgAt(p), /<svg[\s>]/);
});

// --- 3. show set, defaults, target gate -------------------------------------------

test("test_show_omitted_defaults_to_residual_only", () => {
  const { out } = runPlot({ path: outPath() });
  assert.deepEqual(out.series, ["residual"]);
});

for (const name of ["response", "target", "residual", "terrain"]) {
  test(`test_show_${name}_draws_exactly_that_series`, () => {
    const { out } = runPlot({ path: outPath(), show: [name] });
    assert.deepEqual(out.series, [name]);
  });
}

test("test_an_unknown_series_name_exits_nonzero", () => {
  const { status } = runPlot({ path: outPath(), show: ["bogus"] });
  assert.notEqual(status, 0);
});

test("test_the_unknown_series_error_lists_the_valid_names", () => {
  const { out } = runPlot({ path: outPath(), show: ["bogus"] });
  assert.ok(...containsAll(out.error, ["response", "target", "residual", "terrain"]));
});

for (const name of ["target", "residual", "terrain"]) {
  test(`test_show_${name}_without_a_declared_target_exits_nonzero`, () => {
    const { status } = runPlot({ path: outPath(), show: [name] }, { target: undefined });
    assert.notEqual(status, 0);
  });
}

test("test_the_missing_target_error_says_needs_a_target_declare_job_target", () => {
  const { out } = runPlot({ path: outPath(), show: ["residual"] }, { target: undefined });
  assert.ok(
    String(out.error).includes("needs a target — declare job.target"),
    `expected the exact phrase in: ${out && out.error}`,
  );
});

test("test_show_response_without_a_target_succeeds", () => {
  const { status } = runPlot({ path: outPath(), show: ["response"] }, { target: undefined });
  assert.equal(status, 0);
});

// --- 4. against chain -------------------------------------------------------------

test("test_default_show_with_against_yields_residual_then_residual_against", () => {
  const { out } = runPlot({ path: outPath(), against: AGAINST });
  assert.deepEqual(out.series, ["residual", "residual (against)"]);
});

test("test_show_response_with_against_yields_response_then_response_against", () => {
  const { out } = runPlot({ path: outPath(), show: ["response"], against: AGAINST }, { target: undefined });
  assert.deepEqual(out.series, ["response", "response (against)"]);
});

test("test_target_is_never_duplicated_by_against", () => {
  const { out } = runPlot({ path: outPath(), show: ["target"], against: AGAINST });
  assert.deepEqual(out.series, ["target"]);
});

test("test_terrain_is_never_duplicated_by_against", () => {
  const { out } = runPlot({ path: outPath(), show: ["terrain"], against: AGAINST });
  assert.deepEqual(out.series, ["terrain"]);
});

test("test_all_base_series_come_before_all_against_series", () => {
  // Adjudicated as spec: the against block mirrors the show set's order, so
  // the full four-name ordering below is licensed, not incidental.
  const { out } = runPlot({ path: outPath(), show: ["response", "residual"], against: AGAINST });
  assert.deepEqual(out.series, ["response", "residual", "response (against)", "residual (against)"]);
});

test("test_an_against_series_element_carries_the_suffixed_data_series_name", () => {
  const p = outPath();
  runPlot({ path: p, against: AGAINST });
  assert.match(svgAt(p), seriesElementRe("residual (against)"));
});

test("test_the_legend_names_the_against_series", () => {
  const p = outPath();
  runPlot({ path: p, against: AGAINST });
  assert.match(svgAt(p), legendTextRe("residual (against)"));
});

// --- 5. SVG content contract ------------------------------------------------------

test("test_the_files_root_element_is_svg", () => {
  const p = outPath();
  runPlot({ path: p });
  assert.match(svgAt(p), /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/);
});

test("test_the_svg_carries_no_external_reference_beyond_root_xmlns_declarations", () => {
  const p = outPath();
  runPlot({ path: p });
  // Contract: the file is self-contained. xmlns/xmlns:* declarations on the
  // root <svg> tag are namespace names, not references, and are the only
  // tolerated http(s) occurrences; anywhere else they are external references.
  const stripped = svgAt(p).replace(/<svg\b[^>]*>/, (tag) => tag.replace(/xmlns(?::[\w-]+)?="[^"]*"/g, ""));
  assert.doesNotMatch(stripped, /https?:\/\//);
});

test("test_the_svg_carries_no_script_element", () => {
  const p = outPath();
  runPlot({ path: p });
  assert.doesNotMatch(svgAt(p), /<script/i);
});

for (const name of ["response", "target", "residual", "terrain"]) {
  test(`test_the_${name}_series_is_a_polyline_or_path_tagged_data_series_${name}`, () => {
    const p = outPath();
    runPlot({ path: p, show: [name] });
    assert.match(svgAt(p), seriesElementRe(name));
  });
}

for (const name of ["response", "target", "residual", "terrain"]) {
  test(`test_the_legend_names_the_${name}_series_in_a_text_element`, () => {
    const p = outPath();
    runPlot({ path: p, show: [name] });
    assert.match(svgAt(p), legendTextRe(name));
  });
}

test("test_default_range_frequency_labels_include_100", () => {
  const p = outPath();
  runPlot({ path: p });
  assert.match(svgAt(p), legendTextRe("100"));
});

test("test_default_range_frequency_labels_include_1k", () => {
  const p = outPath();
  runPlot({ path: p });
  assert.match(svgAt(p), legendTextRe("1k"));
});

test("test_db_labels_include_zero", () => {
  const p = outPath();
  runPlot({ path: p });
  assert.match(svgAt(p), legendTextRe("0"));
});

test("test_exactly_one_line_element_carries_class_zero_under_auto_y", () => {
  const p = outPath();
  runPlot({ path: p });
  assert.equal(countOf(svgAt(p), /<line\b[^>]*class="zero"/g), 1);
});

test("test_auto_y_keeps_the_zero_line_when_all_data_sits_above_zero_db", () => {
  // The auto y range always includes 0 dB even when the plotted data does not
  // straddle it. Fixture: a low shelf plus a high shelf, both +6 dB at the
  // same corner, sum to roughly +6 dB across the whole 20-20000 Hz grid — a
  // lone peak band would not do (its tails return to ~0 dB), so only this
  // shape makes the clause bite.
  const p = outPath();
  const shelves = [
    { type: "lshelf", f: 1000, q: 0.7, g: 6 },
    { type: "hshelf", f: 1000, q: 0.7, g: 6 },
  ];
  runPlot({ path: p, show: ["response"] }, { chain: { bands: shelves }, target: undefined });
  assert.equal(countOf(svgAt(p), /<line\b[^>]*class="zero"/g), 1);
});

// --- 6. y clipping ----------------------------------------------------------------

test("test_data_outside_an_explicit_y_range_is_clipped_not_dropped", () => {
  const p = outPath();
  runPlot(
    { path: p, show: ["response"], y: [-1, 1] },
    { chain: { bands: [{ type: "peak", f: 1000, q: 1, g: 6 }] }, target: undefined },
  );
  assert.match(svgAt(p), seriesElementRe("response"));
});

// --- 7. error surface -------------------------------------------------------------

test("test_a_failed_plot_answers_json_with_an_error_message_on_stdout", () => {
  const { out } = runPlot({ path: outPath(), show: ["bogus"] });
  assert.equal(typeof out.error, "string");
});

test("test_a_failed_plots_stderr_begins_with_eqlab_prefix", () => {
  const { stderr } = runPlot({ path: outPath(), show: ["bogus"] });
  assert.ok(stderr.startsWith("eqlab: "), `expected stderr to begin with "eqlab: ", got: ${stderr}`);
});

test("test_a_failed_plot_creates_no_file_at_path", () => {
  const p = outPath();
  runPlot({ path: p, show: ["bogus"] });
  assert.equal(fs.existsSync(p), false);
});
