// Per-track apodizing-event history — the data behind the Engine Health card's
// density strip. The daemon reports `apod` as a cumulative counter, so the
// strip's shape comes from per-poll increases: one bin per distinct Status frame
// while PLAYING, cleared when the track changes. Distinct is the operative word
// — a frame repeating the last one is a poll that outran the daemon, not an
// interval, and see accumulate() for what recording it did to the strip.
//
// A bin carries the poll cadence in force when it was appended rather than a
// timestamp. The daemon's own clock cannot stand in: `position` is seconds of
// elapsed playback, so it says nothing about a paused or restarted poll, and a
// wall clock in the store would be the only one in the module graph. Cadence per
// bin is enough — a window of W seconds is the newest run of bins whose recorded
// cadences sum to no more than W — and it degrades honestly, since a page that
// polls slower simply records coarser bins.
//
// Visibility is stateful, not a threshold on the current reading: the strip
// appears on the first event of a track and stays up for as long as playback
// continues, so a burst in an opening section does not vanish from the card the
// moment the burst ends. It comes back down only when playback stops, or when a
// track ends having produced no events at all.
//
// "Ends" is the track change itself, not a remaining-time reading. The daemon's
// `remain_min` / `remain_sec` are `length - position`, and `length` is 0 on any
// stream that does not carry one, so on a Roon source they report negative
// elapsed time and never reach zero.
//
// Nor is the track change always a change of `track_serial` — see isNewTrack()
// for the two shapes it takes and how each was measured.
import { signal, computed, effect } from "@preact/signals";
import { engineStatus } from "./signals.js";
import { fastPollMs } from "./ui.js";
import { apodWindow } from "./prefs.js";

const PLAYING = 2;

// An hour of bins at the 1 s cadence, two at 2 s. Past this the oldest go: the
// strip is a monitor, not a record, and an unbounded array on a track that never
// ends (a radio stream carries one serial indefinitely) is a leak.
const MAX_BINS = 3600;

/**
 * @typedef {{ ms: number, n: number }} Bin
 *   One poll's worth of history: `ms` the poll cadence recorded at append,
 *   `n` the apodizing events counted in that interval.
 *
 * @typedef {object} TrackState
 * @property {string | undefined | null} serial
 *   The track this history belongs to, as the daemon reported it.
 * @property {number | null} apodPrev
 *   Last observed cumulative counter, or null before the baseline poll.
 * @property {string | undefined} posPrev
 *   Playback position as the previous frame reported it, verbatim. Only ever
 *   compared for equality, so the daemon's own formatting is what it is.
 * @property {boolean} sawEvent
 *   Whether this track has produced any event at all.
 */

const bins = signal(/** @type {Bin[]} */ ([]));
// A monotonic count of bins ever recorded, which the array's own length stops
// being once MAX_BINS starts sliding the window. The header indicator restarts
// its flash on every change of this, so a length that goes flat after an hour of
// playback would leave the lamp lit at the last value and never fire again.
const seq = signal(0);
const track = signal(/** @type {TrackState} */ ({ serial: null, apodPrev: null, posPrev: undefined, sawEvent: false }));
const visible = signal(false);

/** This track's bins, oldest first. */
export const apodBins = computed(() => bins.value);

/** Whether the density strip shows at all. */
export const apodStripVisible = computed(() => visible.value);

/** How many bins have ever been recorded, counting past the window's slide. */
export const apodBinSeq = computed(() => seq.value);

const num = (/** @type {string | number | undefined | null} */ v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * @typedef {object} StatusFrame
 * @property {string} [state]
 * @property {string} [track_serial]
 * @property {string} [apod]
 * @property {string} [position]
 */

// A track that produced nothing retires the strip when it ends. Skipping out of
// a quiet track counts the same as playing through one: the daemon reports no
// difference between the two on a source without a length, and the strip has
// nothing to keep showing either way.
/**
 * @param {TrackState} t
 * @returns {boolean}
 */
const endedClean = (t) => t.serial != null && !t.sawEvent;

/** @type {(() => void) | null} */
let dispose = null;

/**
 * Register the bin-accumulation effect once, and hand back its disposer.
 *
 * Idempotent for the same reason `initHealth` is: the effects would share this
 * module's signals, so a second registration would append two bins per poll and
 * halve the strip's time base.
 *
 * @returns {() => void}
 */
export function initApodHistory() {
  if (dispose) return dispose;
  const registered = effect(() => {
    const st = (engineStatus.value || {}).status;
    if (!st) return;
    rollTrack(st);
    if (Number(st.state) !== PLAYING) {
      if (visible.peek()) visible.value = false;
      return;
    }
    accumulate(st);
  });
  dispose = registered;
  return registered;
}

// Whether this frame belongs to a different track than the last one.
//
// A new `track_serial` is the obvious answer and the only one the daemon states
// outright, but it is not the only kind of track change. Measured live on a Roon
// source: skipping tracks by hand starts a new stream and a new serial, while a
// track ending on its own hands the next one to the SAME serial and simply
// restarts the readings. Both of the per-track readings run backwards when that
// happens — `position` returns to the top of the track, and the apodizing
// counter, which counts this track and not the session, returns to near zero —
// and neither ever runs backwards inside one track. So a reading that went
// backwards is a track boundary the serial did not report.
//
// Position is compared as a number here, unlike the repeated-frame test in
// accumulate(), which compares it as a string: this asks which reading is
// earlier, and that one asks whether two frames are the same frame.
/**
 * @param {StatusFrame} st
 * @param {TrackState} t
 * @returns {boolean}
 */
function isNewTrack(st, t) {
  if (st.track_serial !== t.serial) return true;
  const apod = num(st.apod);
  if (apod !== null && t.apodPrev !== null && apod < t.apodPrev) return true;
  const pos = num(st.position);
  const prev = num(t.posPrev);
  return pos !== null && prev !== null && pos < prev;
}

// Start a new track's history, settling the outgoing track's visibility first.
// Everything else about the strip survives the change — a run of playback keeps
// one continuous strip, per the visibility rule above.
/**
 * @param {StatusFrame} st
 * @returns {void}
 */
function rollTrack(st) {
  const t = track.peek();
  if (!isNewTrack(st, t)) return;
  if (endedClean(t)) visible.value = false;
  track.value = { serial: st.track_serial, apodPrev: null, posPrev: undefined, sawEvent: false };
  bins.value = [];
}

// One poll's step. The first poll of a track only takes the baseline: the
// counter's absolute value carries the whole session's events, so a bin built
// against no previous reading would put every event since the daemon started
// into this track's first interval.
//
// A frame that repeats the one before it — same counter AND same position — is
// not an interval that observed nothing, it is the same observation handed over
// twice. The page's poll clock and the daemon's own update clock both run near
// 2 s and drift against each other, so a poll lands on an unmoved frame every
// so often; recording it as a bin wrote a false zero into a stretch of
// continuous playback, which the strip then painted at the floor of the scale.
// Position moving with the counter still is a genuine quiet interval and is
// recorded as the zero it is.
/**
 * @param {StatusFrame} st
 * @returns {void}
 */
function accumulate(st) {
  const apod = num(st.apod) || 0;
  const t = track.peek();
  if (t.apodPrev === null) {
    track.value = { ...t, apodPrev: apod, posPrev: st.position };
    return;
  }
  if (apod === t.apodPrev && st.position === t.posPrev) return;
  const n = Math.max(0, apod - t.apodPrev);
  const next = bins.peek().concat([{ ms: fastPollMs.peek(), n }]);
  bins.value = next.length > MAX_BINS ? next.slice(next.length - MAX_BINS) : next;
  seq.value = seq.peek() + 1;
  track.value = { ...t, apodPrev: apod, posPrev: st.position, sawEvent: t.sawEvent || n > 0 };
  if (n > 0 && !visible.peek()) visible.value = true;
}

// The slice the strip draws: the newest bins that fit the chosen window, walked
// back from the right edge (now) until the next bin would overflow it. A window
// shorter than a single bin's cadence therefore shows nothing, which is the
// truthful answer — that window holds no complete observation.
export const apodVisibleBins = computed(() => {
  const all = apodBins.value;
  const w = apodWindow.value;
  if (w === "all") return all;
  const budget = (num(w) || 0) * 1000;
  let used = 0;
  let i = all.length;
  while (i > 0 && used + all[i - 1].ms <= budget) {
    used += all[i - 1].ms;
    i--;
  }
  return all.slice(i);
});
