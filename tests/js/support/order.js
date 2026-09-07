// An order chain (`a < b && b < c`) pinned by one comparison: the sequence
// against its own ascending copy (docs/testing.md rule 2). `placed` is the
// same for rendered positions, where a `-1` means an anchor never rendered:
// it is dropped from the copy, so a missing anchor fails the order instead of
// sorting first and passing it.

/**
 * @param {number[]} seq
 * @returns {number[]}
 */
export const ascending = (seq) => [...seq].sort((a, b) => a - b);

/**
 * @param {number[]} positions
 * @returns {number[]}
 */
export const placed = (positions) => ascending(positions.filter((p) => p >= 0));
