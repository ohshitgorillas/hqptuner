// What the smoothness suites measure of a replay: for each read of a stream (the wall window one track is heard in, and the
// stamp its music sits at), the lag between what is heard and the playhead on screen, and the move each paint makes against
// the music heard over the paint's wall time, and the columns the spectrogram's picture scrolls over each paint against the
// columns that music is worth. No test() and no assert lives here.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { W, scrolledBy, signatures } from "./picture.js";
import { replay } from "./world.js";

/** @typedef {import("./world.js").Paint} Paint */
/** @typedef {import("./world.js").World} World */
/** @typedef {import("./streams.js").Read} Read */
/** @typedef {import("./streams.js").Stream} Stream */
/**
 * A finding: how many paints it happened at, and the first of them with what it saw. Empty when it never happened.
 *
 * @typedef {{ count: number, first: string }} Finding
 */
/**
 * What one read saw: how many paints fell in its window, how far the lag moved across them, and the lag's median. The
 * lag is the stamp heard at the paint's wall time less the playhead, playback ms; a paint with no playhead makes it NaN.
 *
 * @typedef {{ n: number, spread: number, level: number }} Lag
 */

/**
 * The lag of every read, collected over a replay.
 *
 * @param {Read[]} reads
 * @returns {{ see: (paint: Paint) => void, done: () => Lag[] }}
 */
export function lagProbe(reads) {
  /** @type {number[][]} */
  const series = reads.map(() => []);
  return {
    see: ({ t, head }) =>
      reads.forEach((r, k) => {
        if (t >= r.from && t <= r.to) series[k].push(head === null ? NaN : r.heard(t) - head);
      }),
    done: () =>
      series.map((lags) => {
        const sorted = [...lags].sort((a, b) => a - b);
        const spread = lags.some(Number.isNaN) ? NaN : sorted[sorted.length - 1] - sorted[0];
        return { n: lags.length, spread, level: sorted[Math.floor(sorted.length / 2)] };
      }),
  };
}

//: The most a float sum may differ from the whole, ms.
const EPS = 1e-6;
//: How far a paint's move may stray from the music's over the paint's wall time, as a share of the music's move.
const SLACK = 0.25;
//: How long after Status shows playing again the feed store may still mark the break that follows a stop, ms: the app's
//: reader rejoins 0 to 2.0 s after it.
const BREAK_MS = 2000;
const SHOWN_DIGITS = 1;
//: How far a paint's scroll may stray from the music's, columns, beside the share SLACK allows: the scroll moves whole columns.
const COLUMN_ROOM = 1;

/**
 * A finding that starts out unseen.
 *
 * @returns {Finding}
 */
const finding = () => ({ count: 0, first: "" });

/**
 * Note that `found` happened at `paint`, seeing `what`.
 *
 * @param {Finding} found
 * @param {number} paint
 * @param {string} what
 */
function note(found, paint, what) {
  if (!found.count++) found.first = `paint ${paint}: ${what}`;
}

/**
 * Replay each stream once, on the first ask for it, through the probe `make` builds for it, and keep what the probe says
 * when the replay is over.
 *
 * @template T
 * @param {(stream: Stream) => { see: (paint: Paint, world: World) => void, done: () => T }} make
 * @returns {(stream: Stream) => T}
 */
export function seenOnce(make) {
  /** @type {Map<string, T>} */
  const looked = new Map();
  return (stream) => {
    if (!looked.has(stream.name)) {
      const probe = make(stream);
      replay(stream.schedule, probe.see);
      looked.set(stream.name, probe.done());
    }
    return /** @type {T} */ (looked.get(stream.name));
  };
}

/**
 * Hand `reading` every pair of paints that fall in one read's window, with the playback ms the read's heard clock moved from
 * the first to the second. A paint that starts a window pairs with none before it.
 *
 * @param {Read[]} reads
 * @param {(k: number, paint: Paint, before: Paint, music: number) => void} reading
 * @returns {{ see: (paint: Paint) => void }}
 */
function paired(reads, reading) {
  /** @type {Paint | null} */
  let before = null;
  return {
    see: (paint) => {
      const prior = before;
      if (prior) {
        reads.forEach((r, k) => {
          if (prior.t >= r.from && paint.t <= r.to) reading(k, paint, prior, r.heard(paint.t) - r.heard(prior.t));
        });
      }
      before = paint;
    },
  };
}

/**
 * Whether each paint falls in a real break: from a Status sample that shows State 0 until the paint the feed store restarts
 * at (that paint included), or until BREAK_MS after Status shows playing again when the feed store marks none. Called with
 * every paint, in order.
 *
 * @param {Array<{ t: number, fields: Record<string, string> }>} status
 * @returns {(paint: Paint) => boolean}
 */
function breaks(status) {
  let next = 0;
  let down = false;
  let resumed = NaN;
  return ({ t, heard }) => {
    for (; next < status.length; next++) {
      const { t: sampled, fields } = status[next];
      if (sampled > t) break;
      if (fields.state === "0") [down, resumed] = [true, NaN];
      else if (down && Number.isNaN(resumed)) resumed = sampled;
    }
    if (down && t - resumed > BREAK_MS) down = false;
    const inside = down;
    if (heard?.restart) down = false;
    return inside;
  };
}

/**
 * The move each paint makes against the music heard over the paint's wall time, outside a real break: the paints that left
 * the playhead standing or short of the music's move (`froze`), past it (`jumped`) or behind where the paint before it left
 * it (`back`), and how many paints were read.
 *
 * @param {Read[]} reads
 * @param {Array<{ t: number, fields: Record<string, string> }>} status  the stream's Status samples
 * @returns {{ see: (paint: Paint, world: World) => void, done: () => Array<{ read: number, froze: Finding,
 *   jumped: Finding, back: Finding }> }}
 */
export function motionProbe(reads, status) {
  const found = reads.map(() => ({ read: 0, froze: finding(), jumped: finding(), back: finding() }));
  const inBreak = breaks(status);
  let broken = false;
  const walk = paired(reads, (k, paint, before, music) => {
    if (broken || paint.head === null || before.head === null) return;
    const move = paint.head - before.head;
    const what = `moved ${move.toFixed(SHOWN_DIGITS)} ms while the music moved ${music.toFixed(SHOWN_DIGITS)} ms`;
    found[k].read++;
    if (move < -EPS) note(found[k].back, paint.i, what);
    else if (move < music * (1 - SLACK)) note(found[k].froze, paint.i, what);
    if (move > music * (1 + SLACK)) note(found[k].jumped, paint.i, what);
  });
  return {
    see: (paint) => {
      broken = inBreak(paint);
      walk.see(paint);
    },
    done: () => found,
  };
}

/**
 * The columns the spectrogram's picture scrolls over each paint, read off its pixels, against the columns the music heard over
 * the paint's wall time is worth, outside a real break: the paints whose picture scrolled short of them (`stalled`), past
 * them (`burst`) or could no longer be read although the music moves (`unread`), and how many paints were read. A paint is
 * read from the first one of a window whose picture can be read, since a picture that has just been cleared holds too few
 * columns to match until the music has filled them.
 *
 * @param {Read[]} reads
 * @param {Array<{ t: number, fields: Record<string, string> }>} status  the stream's Status samples
 * @returns {{ see: (paint: Paint, world: World) => void, done: () => Array<{ read: number, stalled: Finding,
 *   burst: Finding, unread: Finding }> }}
 */
export function scrollStepProbe(reads, status) {
  const found = reads.map(() => ({ read: 0, stalled: finding(), burst: finding(), unread: finding() }));
  const readable = reads.map(() => false);
  const inBreak = breaks(status);
  let broken = false;
  let before = new Int32Array(W);
  let after = new Int32Array(W);
  /** @type {number | null | undefined} */
  let scrolled;
  let span = 1;
  const walk = paired(reads, (k, paint, prior, music) => {
    if (broken || paint.head === null || prior.head === null) return;
    scrolled ??= scrolledBy(before, after);
    const owed = (music * W) / span;
    const room = COLUMN_ROOM + SLACK * owed;
    const what = `scrolled ${scrolled} columns while the music moved ${owed.toFixed(SHOWN_DIGITS)}`;
    if (scrolled === null && !readable[k]) return;
    readable[k] = true;
    found[k].read++;
    if (scrolled === null)
      note(found[k].unread, paint.i, `could not be read while the music moved ${owed.toFixed(SHOWN_DIGITS)} columns`);
    else if (scrolled < owed - room) note(found[k].stalled, paint.i, what);
    else if (scrolled > owed + room) note(found[k].burst, paint.i, what);
  });
  return {
    see: (paint, world) => {
      broken = inBreak(paint);
      span = world.span;
      signatures(world.canvas, after);
      scrolled = undefined;
      walk.see(paint);
      [before, after] = [after, before];
    },
    done: () => found,
  };
}
