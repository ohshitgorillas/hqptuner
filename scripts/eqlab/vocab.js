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
 * Every name an entry answers to: its key field plus its aliases.
 *
 * @param {Entry} entry
 * @param {string} key
 * @returns {string[]}
 */
function namesOf(entry, key) {
  const head = typeof entry[key] === "string" ? [entry[key]] : [];
  const aliases = Array.isArray(entry.aliases) ? entry.aliases.filter((a) => typeof a === "string") : [];
  return [...head, ...aliases];
}

/**
 * Case- and space-insensitive comparison key for a lookup name.
 *
 * @param {string} s
 * @returns {string}
 */
const fold = (s) => s.trim().toLowerCase();

/**
 * The terms a conflict row names, accepting both shapes the data uses: a row
 * object carrying `terms`, or a bare array of terms.
 *
 * @param {any} row
 * @returns {string[]}
 */
function rowTerms(row) {
  if (Array.isArray(row)) return row.filter((t) => typeof t === "string");
  if (row && Array.isArray(row.terms)) return row.terms.filter((/** @type {any} */ t) => typeof t === "string");
  return [];
}

/**
 * Answer the vocabulary entries for a list of words.
 *
 * @param {{ terms?: unknown, path?: unknown }} spec
 * @param {any} _ctx
 * @returns {Promise<Record<string, any>>}
 */
export async function vocabJob(spec, _ctx) {
  const terms = Array.isArray(spec.terms) ? spec.terms.filter((t) => typeof t === "string") : [];
  if (!terms.length) throw new Error("vocab: job.terms must be a non-empty array of strings");
  const path = typeof spec.path === "string" && spec.path ? spec.path : DEFAULT_PATH;

  let data;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new Error(`vocab: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const wanted = new Set(terms.map(fold));
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

  const meta = data._meta || {};
  const hitNames = new Set(matched.flatMap((m) => namesOf(m.entry, m.group === "consistency" ? "symptom" : "term")).map(fold));
  const conflicts = (Array.isArray(meta.conflict_pairs) ? meta.conflict_pairs : []).filter((row) =>
    rowTerms(row).some((t) => hitNames.has(fold(t))),
  );
  const polysemous = matched.some((m) => Array.isArray(m.entry.senses) && m.entry.senses.length > 1);

  return {
    terms,
    path,
    matched,
    // A hit needs no index; a miss is the only turn where the caller would
    // otherwise have to read the file to find out what it could have asked.
    index: matched.length ? [] : index,
    conflicts,
    rules: {
      ...(meta.direction_convention ? { direction_convention: meta.direction_convention } : {}),
      ...(meta.named_quality_field ? { named_quality_field: meta.named_quality_field } : {}),
      ...(polysemous && meta.polysemy ? { polysemy: meta.polysemy } : {}),
    },
  };
}
