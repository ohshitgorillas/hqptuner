// Vocabulary lookup: the words a listener uses, resolved to the entries that
// describe them. Reads one JSON file and answers; no chain, no daemon.
//
// The whole point is that a caller asks for the two words it heard instead of
// reading the vocabulary file, so a miss answers the index of every name the
// file can be looked up by — otherwise a miss sends the caller back to the file.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** The shipped vocabulary, used when the job names no path. */
const DEFAULT_PATH = fileURLToPath(new URL("../../docs/eq-assistant/vocabulary.json", import.meta.url));

/**
 * The three entry arrays and the field each is keyed by. `consistency` rows are
 * keyed by `symptom`, not `term`, so a lookup reading `term` alone reaches none
 * of them.
 */
const GROUPS = [
  ["tonal", "term"],
  ["spatial", "term"],
  ["consistency", "symptom"],
];

/** @typedef {Record<string, any>} Entry */
/** @typedef {{ group: string, name: string, matched_as: string, entry: Entry }} Match */

/**
 * Case- and space-insensitive comparison key for a lookup name.
 *
 * @param {string} s
 * @returns {string}
 */
const fold = (s) => s.trim().toLowerCase();

/**
 * Every name an entry answers to: its key field plus its aliases.
 *
 * @param {Entry} entry
 * @param {string} key
 * @returns {string[]}
 */
function namesOf(entry, key) {
  const head = typeof entry[key] === "string" ? [entry[key]] : [];
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
  return [...head, ...aliases].filter((n) => typeof n === "string");
}

/**
 * The terms a conflict row names, accepting both shapes the data uses: a row
 * object carrying `terms`, or a bare array of terms.
 *
 * @param {any} row
 * @returns {string[]}
 */
function rowTerms(row) {
  const terms = Array.isArray(row) ? row : row?.terms;
  return Array.isArray(terms) ? terms.filter((/** @type {any} */ t) => typeof t === "string") : [];
}

/**
 * The words the job asked for, rejected early rather than answered emptily.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
function askedFor(raw) {
  const terms = Array.isArray(raw) ? raw.filter((t) => typeof t === "string") : [];
  if (!terms.length) throw new Error("vocab: job.terms must be a non-empty array of strings");
  return terms;
}

/**
 * Parse the vocabulary file, naming the path when it cannot be read.
 *
 * @param {string} path
 * @returns {Promise<Record<string, any>>}
 */
async function readVocabulary(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new Error(`vocab: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Walk the three arrays once, collecting hits and every declared lookup name.
 *
 * @param {Record<string, any>} data
 * @param {Set<string>} wanted
 * @returns {{ matched: Match[], index: string[] }}
 */
function collect(data, wanted) {
  /** @type {Match[]} */
  const matched = [];
  /** @type {string[]} */
  const index = [];
  for (const [group, key] of GROUPS) {
    const rows = Array.isArray(data[group]) ? data[group] : [];
    for (const entry of rows) {
      const names = namesOf(entry, key);
      index.push(...names);
      const hit = names.find((n) => wanted.has(fold(n)));
      if (hit) matched.push({ group, name: String(entry[key]), matched_as: hit, entry });
    }
  }
  return { matched, index };
}

/**
 * The `_meta` rules a caller needs to read the entries it just got back:
 * the direction convention, the wanted/unwanted polarity rule, and the
 * sense ruling where a matched term carries more than one sense.
 *
 * @param {Record<string, any>} meta
 * @param {Match[]} matched
 * @returns {Record<string, any>}
 */
function rulesOf(meta, matched) {
  const polysemous = matched.some((m) => Array.isArray(m.entry.senses) && m.entry.senses.length > 1);
  /** @type {Record<string, any>} */
  const rules = {};
  if (meta.direction_convention) rules.direction_convention = meta.direction_convention;
  if (meta.named_quality_field) rules.named_quality_field = meta.named_quality_field;
  if (polysemous && meta.polysemy) rules.polysemy = meta.polysemy;
  return rules;
}

/**
 * The stderr report for a lookup. The kind renders its own answer: `render.js`
 * is at its length allowance, and a lookup's report shares nothing with the
 * chain reports there.
 *
 * @param {Awaited<ReturnType<typeof vocabJob>>} out
 * @returns {string}
 */
export function renderVocab(out) {
  if (!out.matched.length) return `no match for ${out.terms.join(", ")}\n${out.index.length} name(s) available`;
  const hits = out.matched.map((/** @type {Match} */ m) => {
    const senses = Array.isArray(m.entry.senses) ? m.entry.senses.length : 0;
    return `  ${m.matched_as} -> ${m.name} (${m.group}, ${senses} sense(s))`;
  });
  const rows = out.conflicts.map((/** @type {any} */ c) => `  ${rowTerms(c).join(" + ")}`);
  const conflicts = rows.length ? `\nconflicts:\n${rows.join("\n")}` : "";
  return `matched:\n${hits.join("\n")}${conflicts}`;
}

/**
 * Answer the vocabulary entries for a list of words.
 *
 * @param {{ kind?: string, terms?: unknown, path?: unknown }} spec
 * @param {any} _ctx
 * @returns {Promise<Record<string, any>>}
 */
export async function vocabJob(spec, _ctx) {
  const terms = askedFor(spec.terms);
  const path = typeof spec.path === "string" && spec.path ? spec.path : DEFAULT_PATH;
  const data = await readVocabulary(path);
  const { matched, index } = collect(data, new Set(terms.map(fold)));

  const meta = data._meta || {};
  const hitNames = new Set(
    matched.flatMap((m) => namesOf(m.entry, m.group === "consistency" ? "symptom" : "term")).map(fold),
  );
  const pairs = Array.isArray(meta.conflict_pairs) ? meta.conflict_pairs : [];

  return {
    terms,
    path,
    matched,
    // A hit needs no index; a miss is the only turn where the caller would
    // otherwise have to read the file to find out what it could have asked.
    index: matched.length ? [] : index,
    conflicts: pairs.filter((/** @type {any} */ row) => rowTerms(row).some((t) => hitNames.has(fold(t)))),
    rules: rulesOf(meta, matched),
  };
}
