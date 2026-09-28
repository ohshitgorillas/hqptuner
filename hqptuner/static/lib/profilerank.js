// Search ranking for the AutoEq profile library.

/**
 * @param {string} s a measurement source
 * @returns {number}
 */
const sourceRank = (s) => (s === "oratory1990" ? 0 : 1);

// All tokens must appear as substrings; rank by where they land
// (start of model < word boundary < mid-word), then by source preference.
/**
 * @param {string} model
 * @param {string[]} tokens
 * @returns {number} the rank, or -1 when a token is missing
 */
function score(model, tokens) {
  const m = model.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    const i = m.indexOf(t);
    if (i === -1) return -1;
    s += (i === 0 ? 0 : m[i - 1] === " " ? 1 : 2) + i / 1000;
  }
  return s;
}

/**
 * Ranks the profiles whose model name contains every whitespace-separated token
 * of the query, best match first, and keeps the first `limit` of them.
 *
 * @template {{ model: string, source: string }} P
 * @param {P[] | null | undefined} profiles the library's profiles, absent until it loads
 * @param {string} query the search box text
 * @param {number} limit how many hits to return
 * @returns {{ hits: P[], more: number }} the kept hits and how many matches were cut
 */
export function rankProfiles(profiles, query, limit) {
  const q = query.trim().toLowerCase();
  if (!profiles || !q) return { hits: [], more: 0 };
  const tokens = q.split(/\s+/);
  /** @type {[number, P][]} */
  const scored = [];
  for (const p of profiles) {
    const s = score(p.model, tokens);
    if (s >= 0) scored.push([s, p]);
  }
  scored.sort(
    (a, b) =>
      a[0] - b[0] ||
      sourceRank(a[1].source) - sourceRank(b[1].source) ||
      a[1].model.localeCompare(b[1].model) ||
      a[1].source.localeCompare(b[1].source),
  );
  return { hits: scored.slice(0, limit).map((h) => h[1]), more: Math.max(0, scored.length - limit) };
}
