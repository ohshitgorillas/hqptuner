// The PCM and SDM filter lists hold each family's entries once: a side's list is the shared entries with that side's
// differing fields applied.

/**
 * What one side changes on a shared entry: the fields that differ, `null` where the side lacks the entry, nothing where
 * it matches.
 *
 * @template T
 * @typedef {(entry: T) => Partial<T> | null | undefined} Delta
 */

/**
 * One side's list: every shared entry with its differing fields applied in place (a field the entry lacks lands last),
 * the entries the side lacks dropped.
 *
 * @template {object} T
 * @param {readonly T[]} entries
 * @param {Delta<T>} delta
 * @returns {T[]}
 */
export function derive(entries, delta) {
  return entries.flatMap((entry) => {
    const diff = delta(entry);
    return diff === null ? [] : [{ ...entry, ...diff }];
  });
}

/** The delta of a side that lists the shared entries as they are. */
export const same = () => undefined;

/** The sentence the SDM prose of a filter run in two stages at a 16x intermediate rate adds. */
const AT_16X = "Processing is two stages with a minimum 16x intermediate rate.";
const CAVEAT = " Only suitable for highest technical quality source materials.";

/** The filters whose SDM prose adds the 16x two-stage sentence. */
export const AT_16X_FILTERS = new Set([
  "poly-sinc-ext2",
  "poly-sinc-ext2-short",
  "poly-sinc-ext2-medium",
  "poly-sinc-ext2-long",
  "poly-sinc-ext2-xl",
  "poly-sinc-ext2-xla",
  "poly-sinc-gauss-short",
  "poly-sinc-gauss-medium",
  "poly-sinc-gauss-long",
  "poly-sinc-gauss-xl",
  "poly-sinc-gauss-xla",
  "sinc-short",
  "sinc-medium",
  "sinc-long",
  "sinc-long-h",
]);

/**
 * Prose with the 16x two-stage sentence added: ahead of a closing "Only suitable" caveat, else at the end.
 *
 * @param {string} text
 */
export const at16x = (text) =>
  text.endsWith(CAVEAT) ? `${text.slice(0, -CAVEAT.length)} ${AT_16X}${CAVEAT}` : `${text} ${AT_16X}`;
