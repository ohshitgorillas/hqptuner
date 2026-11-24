// What the playhead, trace and meter contract suites measure of a replay: for each paint, the interval of playback it
// ran over (from where the playhead stood after the paint before it to where it stands after this one) read against the
// frames the replay delivered, and what the paint handed the meters and the spectrum read against that interval. No test()
// and no assert lives here.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { endOf, startOf } from "../../../hqptuner/static/lib/timebase.js";

/** @typedef {import("./world.js").Paint} Paint */
/** @typedef {import("./world.js").World} World */
/** @typedef {import("./world.js").Frame} Frame */
/** @typedef {import("./world.js").Heard} Heard */
/**
 * A finding: how many paints it happened at, and the first of them with what it saw. Empty when it never happened.
 *
 * @typedef {{ count: number, first: string }} Finding
 */

const DB_PER_DECADE = 10;

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
 * How much of the interval `[from, to)` frame `f` covers, playback ms.
 *
 * @param {Frame} f
 * @param {number} from
 * @param {number} to
 */
const covers = (f, from, to) => Math.max(0, Math.min(endOf(f), to) - Math.max(startOf(f), from));

/** Where `frames` end, playback ms: NaN while none has been delivered. @param {Frame[]} frames */
const newestEnd = (frames) => (frames.length ? endOf(frames[frames.length - 1]) : NaN);

/**
 * The playhead against the frames: each paint after the first that stood the playhead somewhere left it never past the
 * newest frame's end and never backward.
 *
 * @returns {{ see: (paint: Paint, world: World) => void, done: () => { read: number, past: Finding,
 *   backward: Finding } }}
 */
export function wallProbe() {
  /** @type {number | null} */
  let before = null;
  let read = 0;
  const found = { past: finding(), backward: finding() };
  return {
    see: ({ i, head }, { frames }) => {
      const newest = newestEnd(frames);
      if (head !== null && before !== null) {
        read++;
        if (head > newest) note(found.past, i, `${head - newest} ms past the newest end`);
        if (head < before) note(found.backward, i, `moved ${head - before}`);
      }
      before = head;
    },
    done: () => ({ read, ...found }),
  };
}

/**
 * The frames an interval covers: the one covering most of it, the earlier of two covering it equally, the loudest peak
 * and the RMS power mean of them all.
 *
 * @param {Frame[]} frames
 * @param {{ first: number }} cursor  the oldest frame that may still be covered, moved on as intervals move on
 * @param {number} from  playback, ms
 * @param {number} to  playback, ms
 * @returns {{ lead: Frame, peak: number, rms: number, count: number }}
 */
function coveredBy(frames, cursor, from, to) {
  while (cursor.first < frames.length - 1 && endOf(frames[cursor.first]) <= from) cursor.first++;
  let lead = frames[cursor.first];
  let peak = -Infinity;
  let power = 0;
  let count = 0;
  for (let j = cursor.first; j < frames.length && startOf(frames[j]) < to; j++) {
    const share = covers(frames[j], from, to);
    if (share <= 0) continue;
    if (share > covers(lead, from, to)) lead = frames[j];
    peak = Math.max(peak, frames[j].peak);
    power += DB_PER_DECADE ** (frames[j].rms / DB_PER_DECADE);
    count++;
  }
  return { lead, peak, rms: DB_PER_DECADE * Math.log10(power / count), count };
}

/**
 * What each paint handed the meters and the spectrum against the interval the paint ran over: the trace covers as much of
 * the interval as the one frame covering most of it does; the peak is the loudest of the frames the interval covers and
 * the RMS their power mean; an empty interval hands what the paint before it handed. Then the order the frames show in, and
 * the frames skipped.
 *
 * @returns {{ see: (paint: Paint, world: World) => void, done: (frames: Frame[]) => { read: number, lead: Finding,
 *   held: Finding, peak: Finding, rms: Finding, order: Finding, skipped: Finding, counted: { shown: number,
 *   unreached: number, passed: number } } }}
 */
export function traceProbe() {
  const st = {
    /** @type {number | null} */
    before: null,
    /** @type {Heard | null} */
    last: null,
    read: 0,
    cursor: { first: 0 },
    found: {
      lead: finding(),
      held: finding(),
      peak: finding(),
      rms: finding(),
      order: finding(),
      skipped: finding(),
    },
    shown: new Set(),
    leads: new Set(),
    /** @type {Array<[number, number]>} */
    intervals: [],
  };
  return {
    see: (paint, { frames }) => {
      const { heard, head } = paint;
      if (heard && heard.id >= 0) followOrder(st, paint.i, heard.id);
      if (head !== null && st.before !== null && heard && st.last && !heard.restart)
        judgePaint(st, { i: paint.i, head, heard }, frames);
      st.before = head;
      st.last = heard ?? st.last;
    },
    done: (frames) => {
      const { intervals, found, shown, leads } = st;
      const start = intervals.length ? intervals[0][0] : NaN;
      const end = intervals.length ? intervals[intervals.length - 1][1] : NaN;
      const passed = frames.filter((f) => startOf(f) >= start && endOf(f) <= end);
      for (const f of passed) {
        const long = intervals.some(([from, to]) => covers(f, from, to) > 0 && to - from > f.ms);
        if (!shown.has(f.id) && !long)
          note(found.skipped, f.id, "passed unshown, and no paint over it was longer than it");
      }
      const unreached = passed.filter((f) => !leads.has(f.id)).length;
      return {
        read: st.read,
        ...found,
        counted: { shown: passed.filter((f) => shown.has(f.id)).length, unreached, passed: passed.length },
      };
    },
  };
}

/**
 * A frame shown: note it, and that it came after a newer one if it did.
 *
 * @param {any} st  the probe's state
 * @param {number} paint
 * @param {number} id
 */
function followOrder(st, paint, id) {
  if (st.last && id < st.last.id) note(st.found.order, paint, `frame ${id} after ${st.last.id}`);
  st.shown.add(id);
}

/**
 * One paint with an interval to judge: the covering frames against what it handed, or against what the paint before it
 * handed when the interval is empty.
 *
 * @param {any} st  the probe's state
 * @param {{ i: number, head: number, heard: Heard }} paint
 * @param {Frame[]} frames
 */
function judgePaint(st, { i, head, heard }, frames) {
  st.read++;
  const before = st.before;
  const cover = head > before ? coveredBy(frames, st.cursor, before, head) : null;
  if (cover?.count) {
    st.intervals.push([before, head]);
    st.leads.add(cover.lead.id);
    judgeCovered(st.found, i, { heard, cover, frames }, [before, head]);
  } else if (heard.id !== st.last.id || heard.peak !== st.last.peak || heard.rms !== st.last.rms) {
    note(st.found.held, i, "an empty interval changed what the scene shows");
  }
}

/**
 * What a paint handed against the frames its interval covers: the trace, the peak and the RMS.
 *
 * @param {Record<string, Finding>} found
 * @param {number} paint
 * @param {{ heard: Heard, cover: ReturnType<typeof coveredBy>, frames: Frame[] }} seen
 * @param {[number, number]} interval  playback, ms
 */
function judgeCovered(found, paint, { heard, cover, frames }, [from, to]) {
  const share = (/** @type {Frame | undefined} */ f) => (f ? covers(f, from, to) : -Infinity);
  if (share(frames[heard.id]) < share(cover.lead)) {
    note(found.lead, paint, `showed frame ${heard.id}, the covering one is ${cover.lead.id}`);
  }
  if (heard.peak !== cover.peak) {
    note(found.peak, paint, `peak ${heard.peak}, the loudest of ${cover.count} frames is ${cover.peak}`);
  }
  if (heard.rms !== cover.rms) {
    note(found.rms, paint, `rms ${heard.rms}, the mean of ${cover.count} is ${cover.rms}`);
  }
}
