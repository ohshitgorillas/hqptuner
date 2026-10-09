// The apodizing strip's right edge, paced on the spectrogram's frame time. The strip's bins are on the daemon's track
// position, which reaches the page only with each Status poll, so the edge is an anchor carried forward on the frame
// time the spectrogram closes: between polls it runs past the newest bin into playback no Status has observed yet. Each
// new bin says where the edge should stand; the edge moves SLEW of the way there, so a poll that nearly agrees never
// jumps it, or all the way where the two disagree by more than SNAP_MS (a seek, or playback starting before the pacing
// does).
//
// Pure: the caller owns the anchor and hands in the frame time.

/**
 * @typedef {{ at: number, end: number }} StripAnchor
 *   The track position, ms, the strip's right edge shows when the spectrogram has closed `end` ms of frame time.
 */

// How far, ms, a new bin may disagree with the carried edge and still move it only SLEW of the way.
const SNAP_MS = 250;
const SLEW = 0.25;

/**
 * The track position, ms, the edge anchored at `anchor` shows once the spectrogram has closed `end` ms of frame time.
 *
 * @param {StripAnchor} anchor
 * @param {number} end  ms
 * @returns {number}
 */
export const stripEdge = (anchor, end) => anchor.at + end - anchor.end;

/**
 * The anchor once a new bin says the edge should stand at `seen`: SLEW of the way from where `was` carried it, or
 * `seen` itself where there was no anchor or the two are more than SNAP_MS apart.
 *
 * @param {StripAnchor | null} was
 * @param {StripAnchor} seen
 * @returns {StripAnchor}
 */
export function alignStrip(was, seen) {
  if (!was) return seen;
  const off = seen.at - stripEdge(was, seen.end);
  return Math.abs(off) > SNAP_MS ? seen : { at: seen.at - off * (1 - SLEW), end: seen.end };
}
