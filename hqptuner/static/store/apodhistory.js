// Per-track apodizing-event history — the data behind the Engine Health card's
// density strip. The daemon reports `apod` as a cumulative counter, so the
// strip's shape comes from per-poll increases: one bin per distinct Status frame
// while PLAYING, cleared when the track changes. Distinct is the operative word
// — a frame repeating the last one is a poll that outran the daemon, not an
// interval, and see accumulate() for what recording it did to the strip.
//
// A bin carries the playback it observed, in milliseconds: how far the daemon's
// position moved since the frame before it (playedMs in lib/apodscale.js). The
// page's poll cadence is not that width. The daemon publishes Status on its own
// clock, near 2 s, and the browser delays or holds back the page's timer. A
// window of W seconds is the newest run of bins whose widths sum to no more
// than W.
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
import { playedMs } from "../lib/apodscale.js";
import { engineStatus } from "./signals.js";
import { apodWindow } from "./ui/prefs.js";

const PLAYING = 2;

// About two hours of bins at the daemon's 2 s Status clock. Past this the oldest
// go: the strip is a monitor, not a record, and an unbounded array on a track
// that never ends (a radio stream carries one serial indefinitely) is a leak.
const MAX_BINS = 3600;

/**
 * @typedef {{ ms: number, n: number, at: number }} Bin
 *   One frame's worth of history: `ms` the playback observed since the frame
 *   before it, `n` the apodizing events counted in that interval, `at` the
 *   track position in ms where the interval ended.
 *
 * @typedef {object} TrackState
 * @property {string | undefined | null} serial
 *   The track this history belongs to, as the daemon reported it.
 * @property {number | null} apodPrev
 *   Last observed cumulative counter, or null before the baseline poll.
 * @property {string | undefined} posPrev
 *   Playback position as the previous recorded frame reported it, verbatim.
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
// A frame whose position has not moved since the last recorded one observed no
// playback, whatever its counter says. The page's poll clock and the daemon's
// own Status clock both run near 2 s and drift against each other, so a poll
// lands on an unmoved frame every so often. Such a frame records no bin and
// leaves the baseline where it was, so any events it counted land in the next
// bin. A position that moved while the counter held is a genuine quiet interval
// and is recorded as the zero it is.
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
  const pos = num(st.position);
  const ms = playedMs(num(t.posPrev), pos);
  if (ms <= 0 || pos === null) return;
  const n = Math.max(0, apod - t.apodPrev);
  const next = bins.peek().concat([{ ms, n, at: pos * 1000 }]);
  bins.value = next.length > MAX_BINS ? next.slice(next.length - MAX_BINS) : next;
  seq.value = seq.peek() + 1;
  track.value = { ...t, apodPrev: apod, posPrev: st.position, sawEvent: t.sawEvent || n > 0 };
  if (n > 0 && !visible.peek()) visible.value = true;
}

// The slice the strip draws: the newest bins that fit the chosen window, walked
// back from the right edge (now) until the next bin would overflow it. A window
// narrower than its newest bin therefore shows nothing, which is the truthful
// answer — that window holds no complete observation.
export const apodVisibleBins = computed(() => {
  const all = apodBins.value;
  const budget = (num(apodWindow.value) || 0) * 1000;
  let used = 0;
  let i = all.length;
  while (i > 0 && used + all[i - 1].ms <= budget) {
    used += all[i - 1].ms;
    i--;
  }
  return all.slice(i);
});
