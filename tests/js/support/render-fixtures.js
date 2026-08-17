// Shared fixtures and readers for the eqlab render suites (render*.test.js).
// No test() and no assert lives here: this file builds report objects and the
// [ok, message] pairs a suite spreads into ONE assert.ok at its own call site.
//
// The suites are characterization tests written blind from a spec block, so
// nothing here knows the report's copy. Readers pull values, rows, cells and
// line counts out of the rendered text; fixture strings carry a "zz" prefix so
// a needle cannot collide with a heading, a process string or a number.
//
// Deliberately NOT named *.test.js — `make test-js` globs tests/js/*/*.test.js,
// and a fixtures module has nothing for the runner to run.

import { render } from "../../../scripts/eqlab/render.js";

/**
 * Render a hand-built report. `render` declares one parameter covering every
 * job's shape; these fixtures are a header spread over a body, which no single
 * arm of that union describes on its own, so the cast lives here once.
 *
 * @param {Record<string, unknown>} out
 * @returns {string}
 */
export const show = (out) => render(/** @type {any} */ (out));

/** @param {string} text @returns {string[]} */
export const lines = (text) => text.split("\n");

/** @param {string} text @returns {string[]} */
const filled = (text) => lines(text).filter((l) => l.trim() !== "");

/** @param {string} text @returns {number} */
export const count = (text) => filled(text).length;

/** @param {string} text @returns {string} */
export const firstLine = (text) => filled(text)[0] ?? "";

/** @param {string} line @returns {string[]} */
export const tokens = (line) =>
  line
    .trim()
    .split(/\s+/)
    .filter((t) => t !== "");

/** @param {string} text @param {string} needle @returns {string} */
export const lineWith = (text, needle) => lines(text).find((l) => l.includes(needle)) ?? "";

/** @param {string} text @param {string} needle @returns {number} */
export const rowsWith = (text, needle) => lines(text).filter((l) => l.includes(needle)).length;

/**
 * The renderings a number may plausibly print as: its own literal form, one or
 * two decimal places, and the kilo forms a frequency column may use.
 *
 * @param {number} n
 * @returns {string[]}
 */
const numberForms = (n) => {
  const k = n / 1000;
  return [String(n), n.toFixed(1), n.toFixed(2), `${k}k`, `${k.toFixed(1)}k`, `${k.toFixed(2)}k`];
};

/**
 * [ok, message] for spreading into ONE assert.ok — house idiom.
 *
 * @param {string} text
 * @param {number[]} ns
 * @returns {[boolean, string]}
 */
export const mentionsAll = (text, ns) => [
  ns.every((n) => numberForms(n).some((f) => text.includes(f))),
  `expected every one of ${ns.join(", ")} in:\n${text}`,
];

/**
 * @param {string} text
 * @param {string[]} needles
 * @returns {[boolean, string]}
 */
export const includesAll = (text, needles) => [
  needles.every((n) => text.includes(n)),
  `expected every one of ${JSON.stringify(needles)} in:\n${text}`,
];

/**
 * A value the report names when its data is there and does not name when it is
 * not — the shape for a fragment that lives inline on a line printed either
 * way, where a line or token count would assert nothing.
 *
 * @param {string} present
 * @param {string} absent
 * @param {string} needle
 * @returns {[boolean, string]}
 */
export const onlyWhenPresent = (present, absent, needle) => [
  present.includes(needle) && !absent.includes(needle),
  `expected ${needle} in the first rendering only, got ${present.includes(needle)} / ${absent.includes(needle)}`,
];

/**
 * @param {string} shorter
 * @param {string} longer
 * @returns {[boolean, string]}
 */
export const isShorter = (shorter, longer) => [
  count(shorter) < count(longer),
  `expected fewer lines than ${count(longer)}, got ${count(shorter)}`,
];

/**
 * A section is gone, not merely empty: the first entry costs more lines than
 * the second, which is only true if the scaffolding arrived with it.
 *
 * @param {string} none
 * @param {string} one
 * @param {string} two
 * @returns {[boolean, string]}
 */
export const sectionOmitted = (none, one, two) => [
  count(one) - count(none) > count(two) - count(one),
  `first entry cost ${count(one) - count(none)} lines, second cost ${count(two) - count(one)}`,
];

/**
 * @param {string} a
 * @param {string} b
 * @returns {[boolean, string]}
 */
export const differ = (a, b) => [a !== b, `expected the two renderings to differ, both were:\n${a}`];

/**
 * The cell under a named column of a fixed-width table: locate the header row
 * by the column name, the body row by its leading label, and read the same
 * whitespace-separated index out of each.
 *
 * @param {string} text
 * @param {string} label
 * @param {string} column
 * @returns {string}
 */
export const cellUnder = (text, label, column) => {
  const head = lines(text).find((l) => tokens(l).includes(column)) ?? "";
  const row = lines(text).find((l) => tokens(l)[0] === label) ?? "";
  return tokens(row)[tokens(head).indexOf(column)] ?? "";
};

// --- fixture values -----------------------------------------------------------

export const FS = 48000;
export const STAGES = 17;
export const DAEMON_URL = "http://opal.example:8088/api/matrix";
export const XML_PATH = "/srv/fixtures/eqlab-chain.xml";
export const PEQ_PATH = "/srv/fixtures/room-eq.txt";
export const SNAP_PATH = "/srv/fixtures/zzchain.snap";
export const SNAP_NAME = "zzsnapname";
export const SAVED_AT = "2026-08-16T12:34:56Z";
export const PROCESS_A = "iir:type=peak;f=777;q=1;g=6";
const PROCESS_B = "iir:type=lp1;f=666";
const CHANGES = { amend: [{ select: 1234, g: 9.5 }] };
// The objective expression deliberately names no metric that appears in a
// table: a needle looking for a metric row must not land on the objective line.
export const OBJECTIVE = { direction: "maximize", expr: "zzobja - zzobjb" };
export const FIT = { rmse: 0.4, maxdev: 1.5, hz: 2500, range: [25, 19000] };
export const NOTE_DB = { midi: 69, name: "A4", hz: 440, harmonics: [{ n: 1, hz: 440, db: 6.5 }] };
export const NOTE_DELTA = {
  midi: 69,
  name: "A4",
  hz: 440,
  harmonics: [{ n: 1, hz: 440, before: 1.5, after: 6.5, delta: 5.0 }],
};

/** @param {Record<string, unknown>} [over] */
export const daemonSrc = (over = {}) => ({
  kind: "daemon",
  row: 13,
  eq_only: false,
  url: DAEMON_URL,
  stage_count: STAGES,
  ...over,
});

/** @param {Record<string, unknown>} [over] */
export const xmlSrc = (over = {}) => ({
  kind: "xml",
  row: 13,
  eq_only: false,
  path: XML_PATH,
  stage_count: STAGES,
  ...over,
});

/** @param {Record<string, unknown>} [over] */
export const peqSrc = (over = {}) => ({
  kind: "parametric_eq",
  path: PEQ_PATH,
  skipped: [],
  stage_count: STAGES,
  ...over,
});

export const snapSrc = () => ({
  kind: "snapshot",
  name: SNAP_NAME,
  saved_at: SAVED_AT,
  path: SNAP_PATH,
  stage_count: STAGES,
});

export const noneSrc = () => ({ kind: "none", stage_count: STAGES });

/** @param {Record<string, unknown>} [over] */
const panel = (over = {}) => ({
  process: PROCESS_A,
  band_count: 2,
  preamp_db: -3.5,
  preamp_db_full: -11.5,
  partial: false,
  metrics: { zzalpha: { value: 2.5, hz: 2500 } },
  ...over,
});

/** @param {Record<string, unknown>} [over] */
export const survivor = (over = {}) => ({
  changes: CHANGES,
  score: 8.5,
  metrics: { zzalpha: 2.5 },
  preamp_db: -3.5,
  preamp_db_full: -11.5,
  fit: null,
  binding: null,
  process: PROCESS_A,
  partial: false,
  flags: [],
  ...over,
});

/** @param {Record<string, unknown>} [over] */
export const probeBody = (over = {}) => ({ ...panel(), extrema: [], notes: null, ...over });

/** @param {Record<string, unknown>} [over] */
export const evalBody = (over = {}) => ({
  before: panel({ metrics: { zzalpha: { value: 2.5 } }, process: PROCESS_B }),
  after: panel({ preamp_db: -8.5, preamp_db_full: -13.5, metrics: { zzalpha: { value: 7.5 } } }),
  metric_deltas: { zzalpha: 5.5 },
  fit: null,
  flags: [],
  note_deltas: null,
  ...over,
});

/** @param {Record<string, unknown>} [over] */
export const searchBody = (over = {}) => ({
  considered: 210,
  survived: 55,
  returned: 3,
  rejected_by: {},
  objective: OBJECTIVE,
  top: [survivor()],
  margin: null,
  ...over,
});

/** @param {Record<string, unknown>} [over] */
export const diffBody = (over = {}) => ({
  a: panel({ metrics: { zzalpha: { value: 2.5 } }, process: PROCESS_B }),
  b: panel({ preamp_db: -8.5, metrics: { zzalpha: { value: 7.5 } } }),
  against_source: snapSrc(),
  metric_deltas: { zzalpha: 5.5 },
  response_delta: { rmse: 0.4, maxdev: 1.5, hz: 2500 },
  bands: { matched: [], only_a: [], only_b: [] },
  note_deltas: null,
  ...over,
});

/**
 * The header block every report carries, with a job body spread in alongside.
 *
 * @param {string} job
 * @param {Record<string, unknown>} jobBody
 * @param {Record<string, unknown>} [over]
 * @returns {Record<string, unknown>}
 */
export const rep = (job, jobBody, over = {}) => ({
  job,
  fs: FS,
  source: noneSrc(),
  tail_consistency: null,
  ...jobBody,
  ...over,
});
