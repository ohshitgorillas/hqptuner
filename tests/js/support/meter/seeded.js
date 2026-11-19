// The seeded number stream the generated meter schedules draw from: the same sequence for the same seed, every run. No
// test() and no assert lives here. Not a *.test.js file on purpose: the runner glob would execute it.

/**
 * A deterministic stream of numbers in [0, 1) from `seed`.
 *
 * @param {number} seed
 * @returns {() => number}
 */
export function seeded(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
